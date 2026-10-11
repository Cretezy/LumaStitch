// SPDX-License-Identifier: GPL-3.0-or-later
import { useEffect, useRef, useState } from 'react';
import * as Comlink from 'comlink';
import type { DialogProps } from '../DialogHost';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { NumberField } from '@/components/inspector/NumberField';
import { useDoc, exec } from '@/store/documentStore';
import type { AppliqueCutOptions } from '@/model/types';
import type { appliqueCuttingArchive } from '@/applique/cutting';
import { saveFile } from '@/io/project/files';
type Package = ReturnType<typeof appliqueCuttingArchive>;
export default function AppliqueCutDialog({ open, onClose }: DialogProps) {
  const design = useDoc((s) => s.design),
    worker = useRef<Worker | null>(null);
  const [options, setOptions] = useState<AppliqueCutOptions>(
    () => design?.appliqueCut ?? { allowance: 0, mirror: false, sheetWidth: 210 },
  );
  const [result, setResult] = useState<Package | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => () => worker.current?.terminate(), []);
  const change = (v: Partial<AppliqueCutOptions>) => {
    setOptions((o) => ({ ...o, ...v }));
    setResult(null);
  };
  async function calculate() {
    if (!design) return;
    setBusy(true);
    setResult(null);
    setError('');
    worker.current?.terminate();
    const w = new Worker(new URL('../../worker/appliqueCut.worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    try {
      const api = Comlink.wrap<{ appliqueCuttingArchive: typeof appliqueCuttingArchive }>(w);
      const next = await api.appliqueCuttingArchive(structuredClone(design), options);
      if (worker.current !== w) return;
      setResult(next);
      exec('Set appliqué cutting options', (d) => {
        d.appliqueCut = options;
      });
    } catch (e) {
      setError(String(e));
    } finally {
      w.terminate();
      if (worker.current === w) {
        worker.current = null;
        setBusy(false);
      }
    }
  }
  async function download() {
    if (!result) return;
    try {
      await saveFile(
        new Blob([new Uint8Array(result.archive)], { type: 'application/zip' }),
        'applique-cutting.zip',
        { description: 'Appliqué cutting package', accept: { 'application/zip': ['.zip'] } },
      );
    } catch (e) {
      setError(String(e));
    }
  }
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Appliqué cutting export</DialogTitle>
          <DialogDescription>
            Numbered SVG and DXF fabric pieces follow the sewing sequence. Holes stay as cut contours.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4">
          <NumberField
            label="Cut allowance"
            ariaLabel="Cut allowance"
            unit="mm"
            value={options.allowance}
            min={-2}
            max={2}
            step={0.1}
            disabled={busy}
            onCommit={(allowance) => change({ allowance })}
          />
          <NumberField
            label="Sheet width"
            ariaLabel="Sheet width"
            unit="mm"
            value={options.sheetWidth}
            min={20}
            max={1000}
            step={10}
            disabled={busy}
            onCommit={(sheetWidth) => change({ sheetWidth })}
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={options.mirror}
            disabled={busy}
            onCheckedChange={(mirror) => change({ mirror })}
            aria-label="Mirror fabric pieces"
          />
          Mirror fabric pieces for backing-side cutting
        </label>
        <p className="text-xs text-muted-foreground">
          Zero allowance cuts along the placement line, halfway inside the satin cover. Positive allowance
          enlarges the patch. Enable Pre-cut fabric on each appliqué object to skip its trimming stop.
        </p>
        <Button onClick={() => void calculate()} disabled={busy || !design}>
          {busy ? 'Preparing pieces…' : 'Prepare cutting package'}
        </Button>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {result && (
          <>
            <p className="text-sm">
              {result.manifest.pieces.length} fabric pieces · {result.manifest.sheetSizeMm[0]} ×{' '}
              {result.manifest.sheetSizeMm[1]} mm sheet
            </p>
            <img
              src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(result.layout)}`}
              alt="Numbered appliqué cutting layout"
              className="max-h-72 w-full rounded border bg-white object-contain"
            />
            <p className="text-xs text-muted-foreground">
              The ZIP includes individual pieces, a sheet without labels, a numbered reference layout, a
              manifest and the source project. Check millimetre dimensions in your cutter software and disable
              automatic fit-to-page.
            </p>
          </>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button disabled={!result || busy} onClick={() => void download()}>
            Download cutting ZIP
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
