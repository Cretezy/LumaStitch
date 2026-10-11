// SPDX-License-Identifier: GPL-3.0-or-later
import { useId, useMemo, useState } from 'react';
import type { DialogProps } from '@/components/DialogHost';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { geomToD } from '@/canvas/pathD';
import { splitSatinGeometry } from '@/satin/split';
import { splitSelectedSatin } from '@/store/actions';
import { useDoc } from '@/store/documentStore';
import { useUi } from '@/store/uiStore';

export default function SatinSplitDialog({ open, onClose }: DialogProps) {
  const design = useDoc((s) => s.design),
    ids = useUi((s) => s.selection.shapeIds);
  const [percent, setPercent] = useState('50'),
    [error, setError] = useState('');
  const id = useId();
  const preview = useMemo(() => {
    try {
      if (!design || ids.length !== 1 || !design.shapes[ids[0]])
        throw new Error('Select one open satin outline or rail column.');
      const result = splitSatinGeometry(design.shapes[ids[0]], design, Number(percent) / 100);
      const points = result.sections.flatMap((s) => s.geom.subpaths.flatMap((p) => p.nodes.map((n) => n.p)));
      const xs = points.map((p) => p[0]),
        ys = points.map((p) => p[1]);
      const x = Math.min(...xs) - 2,
        y = Math.min(...ys) - 2;
      return {
        result,
        viewBox: `${x} ${y} ${Math.max(...xs) - x + 2} ${Math.max(...ys) - y + 2}`,
        error: '',
      };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, [design, ids, percent]);
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            try {
              splitSelectedSatin(Number(percent) / 100);
              onClose();
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>Split satin column</DialogTitle>
            <DialogDescription>
              Cut an open column into two editable rail sections. Each keeps its current stitch settings.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor={id}>Position along column (%)</Label>
            <Input
              id={id}
              type="number"
              min="1"
              max="99"
              step="1"
              value={percent}
              onChange={(e) => {
                setPercent(e.target.value);
                setError('');
              }}
            />
          </div>
          {preview.result && (
            <>
              <svg
                role="img"
                aria-label="Satin rails and split position"
                viewBox={preview.viewBox}
                className="h-52 w-full rounded border bg-muted/30"
              >
                <path
                  d={geomToD(preview.result.sections[0].geom)}
                  fill="none"
                  stroke="#277857"
                  strokeWidth=".3"
                />
                <path
                  d={geomToD(preview.result.sections[1].geom)}
                  fill="none"
                  stroke="#476baf"
                  strokeWidth=".3"
                />
                <path
                  d={`M${preview.result.cut[0].join(' ')}L${preview.result.cut[1].join(' ')}`}
                  stroke="#bf3546"
                  strokeWidth=".5"
                />
              </svg>
              <p className="text-xs text-muted-foreground">
                Column length: {preview.result.length.toFixed(1)} mm. Red marks the cut.
              </p>
            </>
          )}
          <p className="text-xs text-muted-foreground">
            Curves become sampled rails with direction guides. Entry/exit hints are cleared. Undo restores the
            original column.
          </p>
          {(preview.error || error) && (
            <p role="alert" className="text-sm text-destructive">
              {error || preview.error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!preview.result}>
              Split column
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
