// SPDX-License-Identifier: GPL-3.0-or-later
import { createDesign, createElement, createShape } from '@/model/factories';
import { compound, ellipseGeom, rectGeom } from '@/geom/shapes';
import { edgeTopology } from '@/applique/edges';
export function edgeExample(selective = true, open = false) {
  const d = createDesign({
    name: open
      ? 'Open appliqué pocket border'
      : selective
        ? 'Selective pocket cover'
        : 'Complete pocket cover',
  });
  d.threads.blue = { id: 'blue', name: 'Blue pocket border', color: '#357693' };
  const geom = open
    ? {
        fillRule: 'nonzero' as const,
        subpaths: [
          {
            closed: false,
            nodes: [
              { p: [0, 0] as [number, number] },
              { p: [0, 28] as [number, number], out: [0, 12] as [number, number] },
              { p: [50, 28] as [number, number], in: [0, 12] as [number, number] },
              { p: [50, 0] as [number, number] },
            ],
          },
        ],
      }
    : compound([rectGeom(0, 0, 50, 40), ellipseGeom(25, 22, 6)]);
  const s = createShape('Pocket', geom, { stroke: '#357693', strokeWidth: 0.3 });
  s.id = 'pocket';
  const el = createElement(open ? 'outline' : 'fill', open ? 'appliqueBorder' : 'applique', 'blue', {
    width: 3,
    pullComp: 0.15,
    density: 0.45,
  });
  el.id = 'pocket-border';
  if (selective && !open) el.appliqueEdges = { topology: edgeTopology(geom), omit: [[0, 0]] };
  if (open) s.outline = el;
  else s.fill = el;
  d.shapes[s.id] = s;
  d.zOrder = [s.id];
  d.sequence = [{ kind: 'element', elementId: el.id }];
  return d;
}
export function stitchExamples() {
  return [
    { name: 'before', design: edgeExample(false) },
    { name: 'after', design: edgeExample(true) },
    { name: 'open-border', design: edgeExample(false, true) },
  ].map((e) => ({ ...e, optimize: false }));
}
