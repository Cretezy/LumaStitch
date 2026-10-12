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
import { edgeTopology, sourceEdges } from '@/applique/edges';
import { appliqueDef, appliqueBorderDef } from '@/engine/stitches/applique';
import { resolveParams } from '@/engine/params/resolve';
import { geomBBox } from '@/model/geomOps';
import { geomToD } from '@/canvas/pathD';
import { useDoc } from '@/store/documentStore';
import { useUi } from '@/store/uiStore';
import { setElementProps } from '@/store/commands';

export default function AppliqueEdgesDialog({ open, onClose }: DialogProps) {
  const design = useDoc((s) => s.design),
    ids = useUi((s) => s.selection.shapeIds);
  const shape = ids.length === 1 ? design?.shapes[ids[0]] : undefined;
  const element =
    shape?.fill?.type === 'applique'
      ? shape.fill
      : shape?.outline?.type === 'appliqueBorder'
        ? shape.outline
        : undefined;
  const stale =
    shape && element?.appliqueEdges && element.appliqueEdges.topology !== edgeTopology(shape.geom);
  const [omitted, setOmitted] = useState<[number, number][]>(
    stale ? [] : (element?.appliqueEdges?.omit ?? []),
  );
  const preview = useMemo(() => {
    try {
      if (!design || !shape || !element || shape.locked)
        throw new Error('Select one unlocked appliqué fill or border.');
      const edges = sourceEdges(shape.geom);
      if (edges.length > 500) throw new Error('Simplify this path to at most 500 edges.');
      const el = { ...element, appliqueEdges: { topology: edgeTopology(shape.geom), omit: omitted } };
      const params = resolveParams(el, design.fabric, design.fabricProfile);
      const prep = (element.type === 'appliqueBorder' ? appliqueBorderDef : appliqueDef).prepare(
        shape.geom,
        params,
        el,
        {
          settings: design.settings,
          tolerance: 0.05,
          diag() {},
        },
      );
      const b = geomBBox(shape.geom),
        pad = Number(params.width) + 2;
      const covers = prep.covers ?? prep.paths ?? prep.rings.map((r) => ({ pts: r, closed: true }));
      return {
        edges,
        covers,
        width: Number(params.width),
        viewBox: `${b.minX - pad} ${b.minY - pad} ${b.maxX - b.minX + 2 * pad} ${b.maxY - b.minY + 2 * pad}`,
        error: '',
      };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, [design, shape, element, omitted]);
  const has = (p: number, s: number) => omitted.some(([a, b]) => a === p && b === s);
  const toggle = (p: number, s: number) =>
    setOmitted((old) => (has(p, s) ? old.filter(([a, b]) => a !== p || b !== s) : [...old, [p, s]]));
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Appliqué edge coverage</DialogTitle>
          <DialogDescription>
            Click a border edge or check it below to omit its satin cover. Placement and tack-down stay
            complete.
          </DialogDescription>
        </DialogHeader>
        {stale && (
          <p role="status" className="text-sm">
            The path's node count changed. Review a fresh edge selection before applying.
          </p>
        )}
        {preview.edges && (
          <>
            <svg
              role="group"
              aria-label="Applique edge coverage preview"
              viewBox={preview.viewBox}
              className="h-60 w-full rounded border bg-muted/30"
            >
              {preview.covers.map((p, i) => (
                <path
                  key={`cover-${i}`}
                  d={`M${Array.from(p.pts).reduce((s, v, i) => s + (i % 2 ? ',' : i ? 'L' : '') + v, '')}${p.closed ? 'Z' : ''}`}
                  fill="none"
                  stroke="#3b8a62"
                  strokeWidth={preview.width}
                  opacity={0.5}
                />
              ))}
              {preview.edges.map((edge) => (
                <g
                  key={`${edge.subpath}:${edge.segment}`}
                  role="button"
                  tabIndex={0}
                  aria-label={`Toggle contour ${edge.subpath + 1} edge ${edge.segment + 1}`}
                  aria-pressed={has(edge.subpath, edge.segment)}
                  onClick={() => toggle(edge.subpath, edge.segment)}
                  onKeyDown={(e) => {
                    if (e.key === ' ' || e.key === 'Enter') {
                      e.preventDefault();
                      toggle(edge.subpath, edge.segment);
                    }
                  }}
                  className="cursor-pointer"
                >
                  <path
                    d={geomToD(edge.geom)}
                    fill="none"
                    stroke={has(edge.subpath, edge.segment) ? '#bd3547' : '#245370'}
                    strokeDasharray={has(edge.subpath, edge.segment) ? '4 3' : undefined}
                    strokeWidth={2}
                    vectorEffect="non-scaling-stroke"
                  />
                  <path
                    d={geomToD(edge.geom)}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={12}
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              ))}
            </svg>
            <p className="text-xs text-muted-foreground">
              Green: retained satin. Red dashed edges: omitted. Click the drawn source border; automatic
              coverage by later patches is applied when stitches regenerate. Add nodes first for smaller
              selectable edges.
            </p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setOmitted([])}>
                Cover all edges
              </Button>
              <Button
                variant="outline"
                onClick={() => setOmitted(preview.edges.map((e) => [e.subpath, e.segment]))}
              >
                Omit all cover
              </Button>
            </div>
            <div className="grid max-h-44 grid-cols-2 gap-2 overflow-y-auto">
              {preview.edges.map((edge) => (
                <label className="flex gap-2 text-sm" key={`${edge.subpath}:${edge.segment}`}>
                  <input
                    type="checkbox"
                    checked={has(edge.subpath, edge.segment)}
                    onChange={() => toggle(edge.subpath, edge.segment)}
                  />
                  Omit contour {edge.subpath + 1}, edge {edge.segment + 1}
                </label>
              ))}
            </div>
          </>
        )}
        {preview.error && (
          <p role="alert" className="text-sm text-destructive">
            {preview.error}
          </p>
        )}
        {preview.error && element?.appliqueEdges && !shape?.locked && (
          <Button
            variant="outline"
            onClick={() => {
              setElementProps([element.id], { appliqueEdges: undefined }, 'Reset appliqué edge coverage');
              onClose();
            }}
          >
            Reset saved edge coverage
          </Button>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!preview.edges}
            onClick={() => {
              if (!element || !shape) return;
              setElementProps(
                [element.id],
                {
                  appliqueEdges: omitted.length
                    ? { topology: edgeTopology(shape.geom), omit: omitted }
                    : undefined,
                },
                'Set appliqué edge coverage',
              );
              onClose();
            }}
          >
            Apply edge coverage
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
