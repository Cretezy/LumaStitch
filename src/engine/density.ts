// SPDX-License-Identifier: GPL-3.0-or-later
/** Exact local penetration counts; jumps and machine controls do not puncture fabric. */
import { COMMAND_MASK, type StitchPlan } from './types';

export interface DensityMap {
  counts: Uint32Array;
  maximum: number;
  radius: number;
  penetrations: number;
}
type Point = { x: number; y: number; indices: number[] };
type Cell = {
  points: Map<string, Point>;
  count: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

export function penetrationDensity(plan: Pick<StitchPlan, 'x' | 'y' | 'flags'>, radius = 1): DensityMap {
  if (!Number.isFinite(radius) || radius < 0.1 || radius > 10)
    throw new Error('Density radius must be 0.1–10 mm.');
  const cellSize = radius / 2,
    r2 = radius * radius;
  const cells = new Map<string, Cell>();
  let penetrations = 0;
  for (let i = 0; i < plan.flags.length; i++) {
    if (plan.flags[i] & COMMAND_MASK) continue;
    const x = plan.x[i],
      y = plan.y[i];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const key = `${Math.floor(x / cellSize)},${Math.floor(y / cellSize)}`;
    let c = cells.get(key);
    if (!c) {
      c = { points: new Map(), count: 0, minX: x, maxX: x, minY: y, maxY: y };
      cells.set(key, c);
    }
    c.count++;
    penetrations++;
    c.minX = Math.min(c.minX, x);
    c.maxX = Math.max(c.maxX, x);
    c.minY = Math.min(c.minY, y);
    c.maxY = Math.max(c.maxY, y);
    const pk = `${x},${y}`,
      p = c.points.get(pk);
    if (p) p.indices.push(i);
    else c.points.set(pk, { x, y, indices: [i] });
  }
  const counts = new Uint32Array(plan.flags.length);
  let maximum = 0;
  for (const cell of cells.values())
    for (const p of cell.points.values()) {
      let count = 0;
      const ix = Math.floor(p.x / cellSize),
        iy = Math.floor(p.y / cellSize);
      for (let dx = -2; dx <= 2; dx++)
        for (let dy = -2; dy <= 2; dy++) {
          const c = cells.get(`${ix + dx},${iy + dy}`);
          if (!c) continue;
          const fx = Math.max(Math.abs(c.minX - p.x), Math.abs(c.maxX - p.x));
          const fy = Math.max(Math.abs(c.minY - p.y), Math.abs(c.maxY - p.y));
          if (fx * fx + fy * fy <= r2) {
            count += c.count;
            continue;
          }
          for (const q of c.points.values())
            if ((q.x - p.x) ** 2 + (q.y - p.y) ** 2 <= r2) count += q.indices.length;
        }
      for (const i of p.indices) counts[i] = count;
      maximum = Math.max(maximum, count);
    }
  return { counts, maximum, radius, penetrations };
}
