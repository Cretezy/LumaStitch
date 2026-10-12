// SPDX-License-Identifier: GPL-3.0-or-later
import { useMemo, useState } from 'react';
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
import { geomToD } from '@/canvas/pathD';
import { recognitionCandidates } from '@/recognition/recognize';
import { recognizeSelectedStitches } from '@/store/actions';
import { useDoc } from '@/store/documentStore';
import { useUi } from '@/store/uiStore';

export default function RecognitionDialog({ open, onClose }: DialogProps) {
  const design = useDoc((s) => s.design),
    ids = useUi((s) => s.selection.shapeIds);
  const [excluded, setExcluded] = useState<string[]>([]),
    [error, setError] = useState('');
  const preview = useMemo(() => {
    try {
      if (!design) throw new Error('No design is open.');
      const candidates = recognitionCandidates(design, ids);
      let x = Infinity,
        y = Infinity,
        r = -Infinity,
        b = -Infinity;
      for (const id of ids)
        for (const sp of design.shapes[id].geom.subpaths)
          for (const n of sp.nodes) {
            x = Math.min(x, n.p[0]);
            y = Math.min(y, n.p[1]);
            r = Math.max(r, n.p[0]);
            b = Math.max(b, n.p[1]);
          }
      return {
        candidates,
        viewBox: Number.isFinite(x)
          ? `${x - 2} ${y - 2} ${Math.max(4, r - x + 4)} ${Math.max(4, b - y + 4)}`
          : '0 0 10 10',
        error: '',
      };
    } catch (e) {
      return { candidates: [], error: e instanceof Error ? e.message : String(e) };
    }
  }, [design, ids]);
  const selected = preview.candidates.filter((c) => !excluded.includes(c.key));
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Recognize stitches</DialogTitle>
          <DialogDescription>
            Infer editable satin rails and simple tatami fills from imported needle patterns. Review the
            candidates before converting.
          </DialogDescription>
        </DialogHeader>
        {preview.viewBox && (
          <svg
            role="img"
            aria-label="Imported stitches and inferred objects"
            viewBox={preview.viewBox}
            className="h-52 w-full rounded border bg-muted/30"
          >
            {ids.map((id) => (
              <path
                key={id}
                d={geomToD(design!.shapes[id].geom)}
                fill="none"
                stroke="#888"
                strokeWidth=".08"
                opacity=".5"
              />
            ))}
            {selected.map((c) => (
              <path
                key={c.key}
                d={geomToD(c.geom)}
                fill={c.type === 'tatami' ? '#477cab' : 'none'}
                fillOpacity=".18"
                stroke={c.type === 'tatami' ? '#477cab' : '#218358'}
                strokeWidth=".3"
              />
            ))}
          </svg>
        )}
        <div className="max-h-48 space-y-2 overflow-auto">
          {preview.candidates.map((c, i) => (
            <label key={c.key} className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={!excluded.includes(c.key)}
                onChange={(e) =>
                  setExcluded((old) => (e.target.checked ? old.filter((k) => k !== c.key) : [...old, c.key]))
                }
              />
              <span>
                {i + 1}. {c.type === 'tatami' ? 'Tatami fill' : 'Satin rails'} — {c.end - c.start} source
                needles, {Number(c.params.density).toFixed(2)} mm spacing
                <br />
                <span className="text-xs text-muted-foreground">{c.sourceName}</span>
              </span>
            </label>
          ))}
          {!preview.candidates.length && !preview.error && (
            <p className="text-sm">No supported pattern found. These stitches will stay manual.</p>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Gray: source stitches. Green: satin rails. Blue: fill boundary. Unselected stitches and source
          commands stay in manual blocks. New object boundaries may add trims and jumps.
        </p>
        <p className="text-xs text-muted-foreground">
          This estimates geometry and spacing; it cannot recover the original underlay, compensation or stitch
          effects. New objects start without underlay or pull compensation. Regeneration changes needle
          positions. Keep the original file and inspect the stitch preview after conversion. Undo restores the
          source blocks.
        </p>
        {(preview.error || error) && (
          <p role="alert" className="text-sm text-destructive">
            {error || preview.error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!selected.length}
            onClick={() => {
              try {
                recognizeSelectedStitches(selected.map((c) => c.key));
                onClose();
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              }
            }}
          >
            Convert {selected.length} {selected.length === 1 ? 'object' : 'objects'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
