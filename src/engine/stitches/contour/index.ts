// SPDX-License-Identifier: GPL-3.0-or-later
/** Contour fill (P1): concentric rings offset inward, sewn inner → outer (or outer → inner). */
import { offset } from '@/geom/clipper';
import { rotateClosedTo } from '@/geom/polyline';
import type { StitchTypeDef } from '../../def';
import { num, str } from '../../params/types';
import { RunBuilder, runningPoints } from '../common';
import { fillPolygon, makeRouter, travelTo } from '../tatami';
import type { InsideRouter } from '@/geom/visibility';

export interface ContourPrep {
  /** Rings grouped by level (0 = outermost). */
  levels: Float64Array[][];
  stitchLength: number;
  spacing: number;
  innerFirst: boolean;
  router: InsideRouter | null;
}

function closeRing(r: Float64Array): Float64Array {
  const c = new Float64Array(r.length + 2);
  c.set(r);
  c[r.length] = r[0];
  c[r.length + 1] = r[1];
  return c;
}

export const contourDef: StitchTypeDef<ContourPrep> = {
  id: 'contour',
  label: 'Contour',
  description: 'Rows that follow the outline inward, like ripples. Good for organic shapes.',
  role: 'fill',
  params: [
    {
      key: 'spacing',
      label: 'Spacing',
      help: 'Distance between rings.',
      kind: 'length',
      unit: 'mm',
      min: 0.2,
      max: 3,
      step: 0.05,
      group: 'basic',
    },
    {
      key: 'stitchLength',
      label: 'Stitch length',
      kind: 'length',
      unit: 'mm',
      min: 1,
      max: 6,
      step: 0.1,
      group: 'basic',
    },
    {
      key: 'order',
      label: 'Order',
      kind: 'enum',
      options: [
        { value: 'innerToOuter', label: 'Inner → outer' },
        { value: 'outerToInner', label: 'Outer → inner' },
      ],
      group: 'basic',
    },
    {
      key: 'pullComp',
      label: 'Pull compensation',
      kind: 'length',
      unit: 'mm',
      min: 0,
      max: 1,
      step: 0.05,
      group: 'compensation',
    },
  ],
  defaults: { spacing: 0.4, stitchLength: 3.0, order: 'innerToOuter', pullComp: 0 },
  appliesTo: (s) => s.hasClosed,
  prepare(geom, params, _el, ctx) {
    const base = fillPolygon(geom, params, ctx);
    const spacing = Math.max(0.1, num(params, 'spacing', 0.4));
    let cur = offset(base, num(params, 'pullComp', 0) - spacing / 2);
    const levels: Float64Array[][] = [];
    let guard = 0;
    while (cur.length && guard++ < 2000) {
      const rings: Float64Array[] = [];
      for (const p of cur) rings.push(p.outer, ...p.holes);
      levels.push(rings);
      cur = offset(cur, -spacing);
    }
    if (guard >= 2000) ctx.diag('contour-limit', 'Contour fill stopped after 2000 rings.');
    return {
      levels,
      spacing,
      stitchLength: Math.max(0.5, num(params, 'stitchLength', 3)),
      innerFirst: str(params, 'order', 'innerToOuter') === 'innerToOuter',
      router: makeRouter(base),
    };
  },
  route(prep, hints) {
    const b = new RunBuilder();
    const levels = prep.innerFirst ? prep.levels.slice().reverse() : prep.levels;
    const t = { router: prep.router, travelLen: Math.max(prep.spacing * 3, 1) };
    for (const rings of levels) {
      const remaining = rings.slice();
      while (remaining.length) {
        const cur = b.last() ?? hints.entry;
        let bi = 0,
          bd = Infinity;
        if (cur)
          remaining.forEach((r, i) => {
            for (let k = 0; k < r.length; k += 2) {
              const d = Math.hypot(r[k] - cur[0], r[k + 1] - cur[1]);
              if (d < bd) {
                bd = d;
                bi = i;
              }
            }
          });
        const ring = closeRing(remaining.splice(bi, 1)[0]);
        const rot = cur ? rotateClosedTo(ring, cur[0], cur[1]) : ring;
        const pts = runningPoints(rot, prep.stitchLength);
        travelTo(b, [pts[0], pts[1]], t);
        b.pushPolyline(pts, 0, true);
      }
    }
    return b.build();
  },
};
