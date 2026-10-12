// SPDX-License-Identifier: GPL-3.0-or-later
import { createDesign, createElement, createShape } from '@/model/factories';
import { compound, polylineGeom } from '@/geom/shapes';
import type { PathGeom } from '@/model/types';
export function branchExample(connected: boolean) {
  const design = createDesign({ name: `Satin fern — ${connected ? 'connected' : 'separate'} branches` });
  design.threads.green = { id: 'green', name: 'Fern green', color: '#427751' };
  const paths: PathGeom[] = [
    polylineGeom([
      [0, 0],
      [0, 64],
    ]),
  ];
  for (let i = 0; i < 5; i++)
    for (const sign of [-1, 1]) {
      const y = 14 + i * 10,
        w = 10 + i * 2;
      paths.push({
        fillRule: 'nonzero',
        subpaths: [
          {
            closed: false,
            nodes: [
              { p: [0, y], out: [sign * w * 0.45, -2] },
              { p: [sign * w, y - 11], in: [-sign * w * 0.2, 6] },
            ],
          },
        ],
      });
    }
  const shape = createShape('Connected fern centerlines', compound(paths), { strokeWidth: 2 });
  shape.id = 'fern';
  shape.outline = createElement('outline', 'satin', 'green', {
    width: 2,
    density: 0.4,
    underlay: 'edge',
    pullComp: 0.1,
    connectBranches: connected,
  });
  shape.outline.id = 'fern-satin';
  design.shapes[shape.id] = shape;
  design.zOrder.push(shape.id);
  design.sequence.push({ kind: 'element', elementId: shape.outline.id });
  return design;
}
export function stitchExamples() {
  return [false, true].map((c) => ({
    name: c ? 'after' : 'before',
    design: branchExample(c),
    optimize: false,
  }));
}
