// SPDX-License-Identifier: GPL-3.0-or-later
import { createDesign, createElement, createShape } from '@/model/factories';
import { splitSatinShape } from '@/satin/split';
export function splitExample(split = false) {
  const d = createDesign({ name: split ? 'Split curved satin ribbon' : 'Curved satin ribbon' });
  d.threads.blue = { id: 'blue', name: 'Ribbon blue', color: '#356c9b' };
  const s = createShape(
    'Curved ribbon',
    {
      fillRule: 'nonzero',
      subpaths: [
        {
          closed: false,
          nodes: [
            { p: [0, 0], out: [-5, 14] },
            { p: [8, 40], in: [-14, -6], out: [14, 6] },
            { p: [28, 76], in: [7, -16] },
          ],
        },
        {
          closed: false,
          nodes: [
            { p: [4, 0], out: [-4, 12] },
            { p: [13, 34], in: [-13, -4], out: [16, 8] },
            { p: [32, 76], in: [9, -16] },
          ],
        },
        { closed: false, nodes: [{ p: [5, 42] }, { p: [15, 32] }] },
      ],
    },
    { stroke: '#356c9b', strokeWidth: 0.3 },
  );
  s.id = 'ribbon';
  s.outline = createElement('outline', 'satinColumn', 'blue', {
    density: 0.45,
    pullComp: 0.15,
    underlay: 'edgeZigzag',
    splitAbove: 7,
  });
  s.outline.id = 'ribbon-satin';
  const shapes = split ? splitSatinShape(s, d, 0.45) : [s];
  shapes.forEach((shape, i) => {
    shape.id = `ribbon-${i}`;
    shape.outline!.id = `ribbon-satin-${i}`;
    d.shapes[shape.id] = shape;
    d.zOrder.push(shape.id);
    d.sequence.push({ kind: 'element', elementId: shape.outline!.id });
  });
  return d;
}
export function stitchExamples() {
  return [false, true].map((split) => ({
    name: split ? 'after' : 'before',
    design: splitExample(split),
    optimize: false,
  }));
}
