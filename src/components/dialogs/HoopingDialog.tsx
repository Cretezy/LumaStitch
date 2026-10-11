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
import type { MultiHoopOptions } from '@/model/types';
import type { hoopingArchive } from '@/hooping/archive';
import { saveFile } from '@/io/project/files';

type Package = ReturnType<typeof hoopingArchive>;
export default function HoopingDialog({ open, onClose }: DialogProps) {
  const design = useDoc((s) => s.design);
  const [options, setOptions] = useState<MultiHoopOptions>(
    () =>
      design?.multiHoop ?? {
        width: design?.hoop?.width ?? 100,
        height: design?.hoop?.height ?? 100,
        margin: Math.max(1, design?.hoop?.margin ?? 3),
        overlap: 12,
      },
  );
  const [format, setFormat] = useState('pes'),
    [result, setResult] = useState<Package | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const worker = useRef<Worker | null>(null);
  useEffect(() => () => worker.current?.terminate(), []);
  const change = (key: keyof MultiHoopOptions, value: number) => {
    setOptions((v) => ({ ...v, [key]: value }));
    setResult(null);
  };
  async function calculate() {
    if (!design) return;
    setBusy(true);
    setError('');
    setResult(null);
    worker.current?.terminate();
    const w = new Worker(new URL('../../worker/hooping.worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    try {
      const api = Comlink.wrap<{ hoopingArchive: typeof hoopingArchive }>(w);
      const next = await api.hoopingArchive(structuredClone(design), options, format);
      if (worker.current !== w) return;
      setResult(next);
      exec('Set multi-hooping layout', (d) => {
        d.multiHoop = options;
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
        'multi-hooping.zip',
        { description: 'Multi-hooping package', accept: { 'application/zip': ['.zip'] } },
      );
    } catch (e) {
      setError(String(e));
    }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Multi-hooping export</DialogTitle>
          <DialogDescription>
            Split the stitch plan into overlapping rectangular fields with shared registration marks.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(
            [
              ['width', 'Field width', 30, 1000],
              ['height', 'Field height', 30, 1000],
              ['margin', 'Field margin', 1, 20],
              ['overlap', 'Field overlap', 6, 100],
            ] as const
          ).map(([key, label, min, max]) => (
            <label className="grid gap-1 text-xs" key={key}>
              {label}
              <NumberField
                value={options[key]}
                min={min}
                max={max}
                step={1}
                digits={1}
                unit="mm"
                disabled={busy}
                ariaLabel={label}
                onCommit={(v) => change(key, v)}
              />
            </label>
          ))}
        </div>
        <label className="grid gap-1 text-xs">
          Machine format
          <select
            aria-label="Hooping machine format"
            className="rounded border bg-background p-2"
            disabled={busy}
            value={format}
            onChange={(e) => {
              setFormat(e.target.value);
              setResult(null);
            }}
          >
            {['pes', 'dst', 'jef', 'exp', 'vp3'].map((id) => (
              <option key={id} value={id}>
                {id.toUpperCase()}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs">
          <Switch
            aria-label="Join nearby seam endpoints"
            disabled={busy}
            checked={options.joinSeams !== false}
            onCheckedChange={(value) => {
              setOptions((o) => ({ ...o, joinSeams: value }));
              setResult(null);
            }}
          />
          Join nearby seam endpoints (up to 1 mm along the same seam)
        </label>
        <p className="text-xs text-muted-foreground">
          Each file begins with temporary basting and shared crosses, then stops before the design. Keep the
          basting frame to preserve file centering. The package includes the original project, editable stitch
          projects, a placement SVG and a manifest. Seam locks and extra penetrations are added; rehooping
          accuracy still needs a physical sample.
        </p>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {result && (
          <div className="grid gap-2">
            <p className="text-sm">
              {result.manifest.hoopings.length} hoopings · {result.manifest.sourceStitches.toLocaleString()}{' '}
              source penetrations retained
            </p>
            <img
              alt="Numbered hooping layout with shared registration marks"
              className="max-h-80 w-full rounded border bg-white object-contain"
              src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(result.layout)}`}
            />
            <p className="text-xs text-muted-foreground">
              Sew in numbered order. Red cross pairs are shared between neighboring fields. Empty fields are
              retained for registration continuity. Rectangular fields only; this is separate from a
              machine-specific multi-position hoop.
            </p>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button disabled={busy || !design} onClick={() => void calculate()}>
            {busy ? 'Calculating…' : 'Calculate hoopings'}
          </Button>
          <Button disabled={!result || busy} onClick={() => void download()}>
            Download hooping ZIP
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
