// SPDX-License-Identifier: GPL-3.0-or-later
import { createDesign, shapeElements } from '@/model/factories';
import type { Design, LetteringOptions } from '@/model/types';
import { letteringBaseline } from './baseline';
import { IDENTITY } from '@/geom/matrix';
import { layoutLettering } from './layout';

/** Separate editable designs, in input order. No global document mutation. */
export function letteringBatch(names: string[], options: LetteringOptions, color: string): Design[] {
  if (!names.length || names.length > 100) throw new Error('Enter between 1 and 100 names.');
  return names.map((text) => {
    const o = { ...options, text };
    const d = createDesign({ name: text });
    d.threads.t = { id: 't', name: color, color };
    const shapes = layoutLettering(o, 't', color);
    const baseline = letteringBaseline(o, IDENTITY);
    if (baseline) shapes.push(baseline);
    for (const s of shapes) {
      d.shapes[s.id] = s;
      d.zOrder.push(s.id);
      for (const el of shapeElements(s)) d.sequence.push({ kind: 'element', elementId: el.id });
    }
    d.lettering = {
      text: {
        options: o,
        shapeIds: d.zOrder.slice(),
        matrix: [1, 0, 0, 1, 0, 0],
        ...(baseline ? { baselineShapeId: baseline.id } : {}),
      },
    };
    return d;
  });
}
