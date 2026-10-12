// SPDX-License-Identifier: GPL-3.0-or-later
import { createDesign, createElement, createShape } from '@/model/factories';
import { compound, ellipseGeom } from '@/geom/shapes';
export function appliqueExample(partial = true) {
  const d = createDesign({
    name: partial ? 'Pre-cut overlapping appliqué' : 'Full-cover overlapping appliqué',
  });
  d.threads.green = { id: 'green', name: 'Green patch border', color: '#3d7564' };
  d.threads.gold = { id: 'gold', name: 'Gold patch border', color: '#c49635' };
  const shapes = [
    createShape('Lower patch with window', compound([ellipseGeom(0, 0, 20), ellipseGeom(-8, 0, 4)])),
    createShape('Upper patch', ellipseGeom(22, 0, 17, 20)),
  ];
  for (const [i, s] of shapes.entries()) {
    s.id = i ? 'upper' : 'lower';
    s.fill = createElement('fill', 'applique', i ? 'gold' : 'green', {
      width: 3,
      density: 0.45,
      precut: partial,
      partialCover: partial,
      pullComp: 0.15,
    });
    s.fill.id = `${s.id}-fill`;
    d.shapes[s.id] = s;
    d.zOrder.push(s.id);
    d.sequence.push({ kind: 'element', elementId: s.fill.id });
  }
  d.appliqueCut = { allowance: 0, mirror: false, sheetWidth: 120 };
  return d;
}
export function stitchExamples() {
  return [false, true].map((partial) => ({
    name: partial ? 'after' : 'before',
    design: appliqueExample(partial),
    optimize: false,
  }));
}
