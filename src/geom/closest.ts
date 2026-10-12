// SPDX-License-Identifier: GPL-3.0-or-later
import type { Vec2 } from '@/model/types';

export interface BoundaryPath {
  pts: Float64Array;
  closed: boolean;
}

/** Closest pair on flattened boundaries, including edge interiors and crossings. No sampling. */
export function closestBoundaryPoints(
  a: BoundaryPath[],
  b: BoundaryPath[],
): { a: Vec2; b: Vec2; distance: number } | null {
  let best = Infinity;
  let pa: Vec2 = [0, 0],
    pb: Vec2 = [0, 0];
  const keep = (ax: number, ay: number, bx: number, by: number) => {
    const d = (ax - bx) ** 2 + (ay - by) ** 2;
    if (d < best) {
      best = d;
      pa = [ax, ay];
      pb = [bx, by];
    }
  };
  const project = (x: number, y: number, ax: number, ay: number, bx: number, by: number): Vec2 => {
    const dx = bx - ax,
      dy = by - ay;
    const l = dx * dx + dy * dy;
    const t = l ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l)) : 0;
    return [ax + t * dx, ay + t * dy];
  };
  for (const ap of a)
    for (const bp of b) {
      const x = ap.pts,
        y = bp.pts;
      const an = x.length,
        bn = y.length;
      if (an < 2 || bn < 2) continue;
      const ae = ap.closed || an === 2 ? an : an - 2;
      const be = bp.closed || bn === 2 ? bn : bn - 2;
      for (let i = 0; i < ae; i += 2)
        for (let j = 0; j < be; j += 2) {
          const ii = (i + 2) % an,
            jj = (j + 2) % bn;
          const ax = x[i],
            ay = x[i + 1],
            bx = x[ii],
            by = x[ii + 1];
          const cx = y[j],
            cy = y[j + 1],
            dx = y[jj],
            dy = y[jj + 1];
          const gx = Math.max(0, Math.min(ax, bx) - Math.max(cx, dx), Math.min(cx, dx) - Math.max(ax, bx));
          const gy = Math.max(0, Math.min(ay, by) - Math.max(cy, dy), Math.min(cy, dy) - Math.max(ay, by));
          if (gx * gx + gy * gy >= best) continue;
          const ux = bx - ax,
            uy = by - ay,
            vx = dx - cx,
            vy = dy - cy;
          const cross = ux * vy - uy * vx;
          if (cross !== 0) {
            const t = ((cx - ax) * vy - (cy - ay) * vx) / cross;
            const s = ((cx - ax) * uy - (cy - ay) * ux) / cross;
            if (t >= 0 && t <= 1 && s >= 0 && s <= 1) {
              const p: Vec2 = [ax + t * ux, ay + t * uy];
              return { a: p, b: [...p], distance: 0 };
            }
          }
          // Stable destination-corner preference when multiple joins have the same gap.
          let q = project(cx, cy, ax, ay, bx, by);
          keep(q[0], q[1], cx, cy);
          q = project(dx, dy, ax, ay, bx, by);
          keep(q[0], q[1], dx, dy);
          q = project(ax, ay, cx, cy, dx, dy);
          keep(ax, ay, q[0], q[1]);
          q = project(bx, by, cx, cy, dx, dy);
          keep(bx, by, q[0], q[1]);
        }
    }
  return Number.isFinite(best) ? { a: pa, b: pb, distance: Math.sqrt(best) } : null;
}

export const closestRings = (a: Float64Array, b: Float64Array) =>
  closestBoundaryPoints([{ pts: a, closed: true }], [{ pts: b, closed: true }]);
