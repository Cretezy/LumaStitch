// SPDX-License-Identifier: GPL-3.0-or-later
/** Uniform-grid spatial index of stitch segments → owning element (rebuilt per plan). */
import { F, NO_ELEMENT, type StitchPlan } from '@/engine/types';
import { segDist2 } from '@/geom/polygon';
import type { Id } from '@/model/types';

const CELL = 2; // mm

export class StitchHitIndex {
  private grid = new Map<number, number[]>();
  constructor(private plan: StitchPlan) {
    const { x, y, flags, element } = plan;
    for (let i = 1; i < flags.length; i++) {
      const f = flags[i];
      if (f & (F.JUMP | F.TRIM | F.COLOR_CHANGE | F.STOP | F.END)) continue;
      if (element[i] === NO_ELEMENT) continue;
      if (flags[i - 1] & (F.TRIM | F.COLOR_CHANGE | F.STOP)) continue;
      const x0 = Math.min(x[i - 1], x[i]),
        x1 = Math.max(x[i - 1], x[i]);
      const y0 = Math.min(y[i - 1], y[i]),
        y1 = Math.max(y[i - 1], y[i]);
      for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++)
        for (let cy = Math.floor(y0 / CELL); cy <= Math.floor(y1 / CELL); cy++) {
          const k = cx * 73856093 + cy;
          let l = this.grid.get(k);
          if (!l) this.grid.set(k, (l = []));
          l.push(i);
        }
    }
  }

  /** Element whose stitch is nearest (x, y) within `radius` mm (topmost = sewn last wins ties). */
  query(px: number, py: number, radius: number): { elementId: Id; index: number } | null {
    const { x, y, element, elementIds } = this.plan;
    let best = radius * radius,
      bi = -1;
    const r = Math.ceil(radius / CELL);
    const cx0 = Math.floor(px / CELL),
      cy0 = Math.floor(py / CELL);
    for (let cx = cx0 - r; cx <= cx0 + r; cx++)
      for (let cy = cy0 - r; cy <= cy0 + r; cy++) {
        const l = this.grid.get(cx * 73856093 + cy);
        if (!l) continue;
        for (const i of l) {
          const [d2] = segDist2(px, py, x[i - 1], y[i - 1], x[i], y[i]);
          if (d2 < best || (d2 <= best + 1e-9 && i > bi)) {
            best = d2;
            bi = i;
          }
        }
      }
    if (bi < 0) return null;
    return { elementId: elementIds[element[bi]], index: bi };
  }
}

const memo = new WeakMap<StitchPlan, StitchHitIndex>();
export function hitIndexFor(plan: StitchPlan): StitchHitIndex {
  let h = memo.get(plan);
  if (!h) memo.set(plan, (h = new StitchHitIndex(plan)));
  return h;
}
