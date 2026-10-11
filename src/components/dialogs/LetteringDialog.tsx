// SPDX-License-Identifier: GPL-3.0-or-later
import { useState } from 'react';
import * as Comlink from 'comlink';
import type { DialogProps } from '../DialogHost';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DEFAULT_LETTERING, validateLettering } from '@/lettering/layout';
import type { LetteringOptions } from '@/model/types';
import { useDoc } from '@/store/documentStore';
import { setLettering } from '@/store/commands/lettering';
import { downloadBlob } from '@/io/project/files';
import { fitSelection } from '@/canvas/CanvasView';

export default function LetteringDialog({ open, onClose, data }: DialogProps) {
  const groupId = data?.groupId as string | undefined;
  const baselineSourceId = data?.baselineShapeId as string | undefined;
  const sourceBaseline = useDoc.getState().design?.shapes[baselineSourceId ?? ''];
  const group = useDoc.getState().design?.lettering?.[groupId ?? ''];
  const [options, setOptions] = useState<LetteringOptions>(
    group?.options ??
      (sourceBaseline
        ? { ...DEFAULT_LETTERING, baseline: structuredClone(sourceBaseline.geom) }
        : DEFAULT_LETTERING),
  );
  const first = useDoc.getState().design?.shapes[group?.shapeIds[0] ?? ''];
  const threadId = first?.outline?.threadId;
  const [color, setColor] = useState(
    threadId ? (useDoc.getState().design?.threads[threadId]?.color ?? '#234a73') : '#234a73',
  );
  const [batch, setBatch] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const patch = (p: Partial<LetteringOptions>) => setOptions((o) => ({ ...o, ...p }));
  function apply() {
    try {
      validateLettering(options);
      setLettering(options, color, groupId, baselineSourceId);
      onClose();
      requestAnimationFrame(fitSelection);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  async function exportBatch() {
    setBusy(true);
    setError('');
    const worker = new Worker(new URL('../../worker/lettering.worker.ts', import.meta.url), {
      type: 'module',
    });
    try {
      const api = Comlink.wrap<{ letteringArchive: typeof import('@/lettering/archive').letteringArchive }>(
        worker,
      );
      const bytes = await api.letteringArchive(
        batch
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean),
        options,
        color,
      );
      downloadBlob(new Blob([new Uint8Array(bytes)], { type: 'application/zip' }), 'lettering-batch.zip');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      worker.terminate();
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{group ? 'Edit lettering' : 'Add lettering'}</DialogTitle>
          <DialogDescription>
            Geneva Simple Sans · digitized satin · capital height 10–20 mm. Latin letters, accents, numbers
            and punctuation.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Label htmlFor="lettering-text">Text</Label>
          <textarea
            id="lettering-text"
            className="min-h-20 rounded-md border bg-background p-2 text-sm"
            value={options.text}
            maxLength={1000}
            onChange={(e) => patch({ text: e.target.value })}
          />
          <div className="grid grid-cols-2 gap-3">
            {(
              [
                ['height', 'Capital height (mm)', 10, 20, 0.5],
                ['letterSpacing', 'Extra letter spacing (mm)', -5, 20, 0.1],
                ['wordSpacing', 'Extra word spacing (mm)', 0, 30, 0.1],
                ['lineSpacing', 'Line spacing multiplier', 1, 4, 0.1],
                ['arcAngle', 'Arc angle (°)', -300, 300, 5],
              ] as const
            ).map(([key, label, min, max, step]) => (
              <div key={key} className="grid gap-1">
                <Label htmlFor={`text-${key}`}>{label}</Label>
                <Input
                  id={`text-${key}`}
                  type="number"
                  min={min}
                  max={max}
                  step={step}
                  value={options[key]}
                  disabled={Boolean(options.baseline) && (key === 'arcAngle' || key === 'lineSpacing')}
                  onChange={(e) => patch({ [key]: e.target.valueAsNumber })}
                />
              </div>
            ))}
            <div className="grid gap-1">
              <Label htmlFor="text-color">Thread color</Label>
              <Input id="text-color" type="color" value={color} onChange={(e) => setColor(e.target.value)} />
            </div>
          </div>
          {options.baseline && (
            <fieldset className="grid gap-2 rounded border p-3">
              <legend className="px-1 text-sm">Path baseline</legend>
              <Label htmlFor="baseline-offset">Offset from baseline (mm)</Label>
              <Input
                id="baseline-offset"
                type="number"
                min={-100}
                max={100}
                step={0.5}
                value={options.baselineOffset ?? 0}
                onChange={(e) => patch({ baselineOffset: e.target.valueAsNumber })}
              />
              <label className="flex gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={options.baselineReverse ?? false}
                  onChange={(e) => patch({ baselineReverse: e.target.checked })}
                />
                Reverse baseline direction
              </label>
              <p className="text-xs text-muted-foreground">
                Letters keep their shape and follow the path tangent. Use Object → Edit lettering baseline to
                move its nodes. Baseline edits clear custom stitch entry/exit and direction hints. Alignment
                positions text along the available path; text must fit without shrinking below the font's
                supported size.
              </p>
            </fieldset>
          )}
          <Label htmlFor="text-align">Alignment</Label>
          <select
            id="text-align"
            className="rounded-md border bg-background p-2 text-sm"
            value={options.align}
            onChange={(e) => patch({ align: e.target.value as LetteringOptions['align'] })}
          >
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
          </select>
          <label className="flex gap-2 text-sm">
            <input
              type="checkbox"
              checked={options.monogram}
              onChange={(e) =>
                patch({
                  monogram: e.target.checked,
                  height: e.target.checked ? Math.max(14, options.height) : options.height,
                })
              }
            />
            Three-letter monogram (larger middle initial)
          </label>
          <p className="text-xs text-muted-foreground">
            Select any letter and choose Object → Edit lettering to edit the block. Moving the complete block
            keeps text editable. Editing individual paths detaches it.
          </p>
          <details>
            <summary className="cursor-pointer text-sm">Batch names</summary>
            <div className="mt-2 grid gap-2">
              <Label htmlFor="batch-names">One name per line (up to 100)</Label>
              <textarea
                id="batch-names"
                className="min-h-20 rounded-md border bg-background p-2 text-sm"
                value={batch}
                onChange={(e) => setBatch(e.target.value)}
              />
              <Button variant="outline" disabled={busy || !batch.trim()} onClick={() => void exportBatch()}>
                {busy ? 'Generating…' : 'Download batch projects + PES'}
              </Button>
            </div>
          </details>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={apply} disabled={busy}>
            {group ? 'Update lettering' : 'Add lettering'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
