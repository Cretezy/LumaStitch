// SPDX-License-Identifier: GPL-3.0-or-later
import type { Vec2 } from '@/model/types';
import { reversePolyline } from '@/geom/polyline';
import type { PathItem } from './index';

/**
 * Joint order/direction optimization for up to 12 open strokes. The end of an even-pass stroke
 * is its entry, not its far endpoint. Closed loops keep their continuous seam-selection router.
 * Optimal for endpoint jumps plus the existing half-weighted exit hint; no stitches are added.
 */
export function exactOpenOrder(
  paths: PathItem[],
  start: Vec2 | undefined,
  passes: number,
  exit: Vec2 | undefined,
): PathItem[] | null {
  const n = paths.length;
  if (!n || n > 12 || paths.some((p) => p.closed || p.pts.length < 4)) return null;
  const width = n * 2;
  const full = (1 << n) - 1;
  const cost = new Float64Array((full + 1) * width).fill(Infinity);
  const prev = new Int8Array(cost.length).fill(-1);
  const entries: Vec2[] = [],
    ends: Vec2[] = [];
  for (const { pts } of paths) {
    const a: Vec2 = [pts[0], pts[1]],
      b: Vec2 = [pts[pts.length - 2], pts[pts.length - 1]];
    entries.push(a, b);
    ends.push(...(passes % 2 ? [b, a] : [a, b]));
  }
  const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const gaps = Float64Array.from({ length: width * width }, (_, i) =>
    dist(ends[Math.floor(i / width)], entries[i % width]),
  );
  for (let s = 0; s < width; s++) cost[(1 << (s >> 1)) * width + s] = start ? dist(start, entries[s]) : 0;
  for (let mask = 1; mask <= full; mask++)
    for (let s = 0; s < width; s++) {
      const current = cost[mask * width + s];
      if (!Number.isFinite(current)) continue;
      for (let j = 0; j < n; j++) {
        if (mask & (1 << j)) continue;
        for (let dir = 0; dir < 2; dir++) {
          const next = j * 2 + dir;
          const at = (mask | (1 << j)) * width + next;
          const candidate = current + gaps[s * width + next];
          if (candidate < cost[at] - 1e-9) {
            cost[at] = candidate;
            prev[at] = s;
          }
        }
      }
    }
  let best = 0,
    bestCost = Infinity;
  for (let s = 0; s < width; s++) {
    const candidate = cost[full * width + s] + (exit ? 0.5 * dist(ends[s], exit) : 0);
    if (candidate < bestCost - 1e-9) {
      bestCost = candidate;
      best = s;
    }
  }
  const order: PathItem[] = [];
  let mask = full;
  for (let s = best; s >= 0;) {
    const p = paths[s >> 1];
    order.push({ closed: false, pts: s % 2 ? reversePolyline(p.pts) : p.pts });
    const previous = prev[mask * width + s];
    mask ^= 1 << (s >> 1);
    s = previous;
  }
  return order.reverse();
}
