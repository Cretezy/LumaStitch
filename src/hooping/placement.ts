// SPDX-License-Identifier: GPL-3.0-or-later
/** Rotated field geometry and continuous coverage; all coordinates are design millimetres. */
import type { MultiHoopOptions, Vec2 } from '@/model/types';

export type Placement = NonNullable<MultiHoopOptions['placements']>[number];
export function toLocal(p: Vec2, field: Placement): Vec2 {
  const a = (field.angle * Math.PI) / 180,
    c = Math.cos(a),
    s = Math.sin(a),
    x = p[0] - field.center[0],
    y = p[1] - field.center[1];
  return [c * x + s * y, -s * x + c * y];
}
export function toWorld(p: Vec2, field: Placement): Vec2 {
  const a = (field.angle * Math.PI) / 180,
    c = Math.cos(a),
    s = Math.sin(a);
  return [field.center[0] + c * p[0] - s * p[1], field.center[1] + s * p[0] + c * p[1]];
}
export function fieldCorners(field: Placement, width: number, height: number): Vec2[] {
  return (
    [
      [-width / 2, -height / 2],
      [width / 2, -height / 2],
      [width / 2, height / 2],
      [-width / 2, height / 2],
    ] as Vec2[]
  ).map((p) => toWorld(p, field));
}
type Line = { x: number; y: number; c: number };
const value = (l: Line, p: Vec2) => l.x * p[0] + l.y * p[1] - l.c;
const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
function edges(field: Placement, w: number, h: number): Line[] {
  const a = (field.angle * Math.PI) / 180,
    c = Math.cos(a),
    s = Math.sin(a);
  return [
    [c, s, w / 2],
    [-c, -s, w / 2],
    [-s, c, h / 2],
    [s, -c, h / 2],
  ].map(([x, y, d]) => ({ x, y, c: x * field.center[0] + y * field.center[1] + d }));
}
function clip(points: Vec2[], lines: Line[]): Vec2[] {
  for (const line of lines) {
    const out: Vec2[] = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i],
        b = points[(i + 1) % points.length],
        va = value(line, a),
        vb = value(line, b);
      if (va <= 1e-9) out.push(a);
      if ((va < 0 && vb > 0) || (va > 0 && vb < 0)) out.push(lerp(a, b, va / (va - vb)));
    }
    points = out;
  }
  return points;
}

export function placedLayout(placements: Placement[], width: number, height: number) {
  // The frame is 0.5 mm inside the usable field. Keep all design stitches within it so
  // every machine writer retains the same symmetric center, including after quantization.
  const limits = placements.map((p) => edges(p, width - 1, height - 1));
  const contains = (i: number, p: Vec2) => limits[i].every((l) => value(l, p) <= 1e-7);
  const dist2 = (i: number, p: Vec2) =>
    (p[0] - placements[i].center[0]) ** 2 + (p[1] - placements[i].center[1]) ** 2;
  const bisectors: { a: number; b: number; line: Line }[] = [];
  const neighbors: { other: number; marks: Vec2[] }[][] = placements.map(() => []);
  for (let i = 0; i < placements.length; i++)
    for (let j = i + 1; j < placements.length; j++) {
      const a = placements[i],
        b = placements[j],
        dx = b.center[0] - a.center[0],
        dy = b.center[1] - a.center[1],
        len = Math.hypot(dx, dy);
      if (clip(fieldCorners(a, width - 1, height - 1), limits[j]).length >= 3 && len > 1e-8) {
        bisectors.push({
          a: i,
          b: j,
          line: {
            x: dx / len,
            y: dy / len,
            c: (dx * (a.center[0] + b.center[0]) + dy * (a.center[1] + b.center[1])) / (2 * len),
          },
        });
      }
      // 2 mm clearance contains either orientation of a 2 mm cross plus file rounding.
      const overlap = clip(fieldCorners(a, width - 4, height - 4), edges(b, width - 4, height - 4));
      if (overlap.length < 3) continue;
      const center: Vec2 = [
        overlap.reduce((n, p) => n + p[0], 0) / overlap.length,
        overlap.reduce((n, p) => n + p[1], 0) / overlap.length,
      ];
      let pair: Vec2[] = [],
        far = 0;
      for (const p of overlap)
        for (const q of overlap) {
          const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
          if (d > far) {
            far = d;
            pair = [lerp(p, center, 0.2), lerp(q, center, 0.2)];
          }
        }
      if (far * 0.8 < 5) continue;
      neighbors[i].push({ other: j, marks: pair });
      neighbors[j].push({ other: i, marks: pair });
    }
  // A spanning tree gives every new hoop a previously sewn pair, even for non-grid layouts.
  const order = [0],
    visited = new Set([0]),
    marks: Vec2[][] = placements.map(() => []),
    parents: (number | null)[] = placements.map(() => null);
  for (let k = 0; k < order.length; k++)
    for (const edge of neighbors[order[k]])
      if (!visited.has(edge.other)) {
        visited.add(edge.other);
        order.push(edge.other);
        parents[edge.other] = order[k];
        marks[order[k]].push(...edge.marks);
        marks[edge.other].push(...edge.marks);
      }
  if (order.length !== placements.length)
    throw new Error(
      'Hoop placements need connected overlaps with room for two registration crosses at least 5 mm apart. Move fields closer together.',
    );
  let comparisons = 0;
  const spend = (n: number) => {
    comparisons += n;
    if (comparisons > 30000000)
      throw new Error(
        'This custom layout exceeds the geometry work limit. Use fewer fields or split the design first.',
      );
  };
  const locate = (p: Vec2) => {
    spend(placements.length);
    let best = -1,
      distance = Infinity;
    for (let i = 0; i < placements.length; i++)
      if (contains(i, p)) {
        const d = dist2(i, p);
        if (d < distance - 1e-8) {
          best = i;
          distance = d;
        }
      }
    if (best < 0)
      throw new Error(
        `Stitches near (${p[0].toFixed(1)}, ${p[1].toFixed(1)}) mm are outside every hoop's basting frame. Move or add a field to cover them.`,
      );
    return best;
  };
  const cuts = (a: Vec2, b: Vec2) => {
    spend(placements.length * 4 + bisectors.length);
    const intervals = limits.map((lines) => {
      let lo = 0,
        hi = 1;
      for (const line of lines) {
        const va = value(line, a),
          vb = value(line, b),
          d = vb - va;
        if (Math.abs(d) < 1e-12) {
          if (va > 1e-7) return null;
        } else if (d > 0) hi = Math.min(hi, -va / d);
        else lo = Math.max(lo, -va / d);
      }
      return hi >= lo - 1e-9 ? [lo, hi] : null;
    });
    const result = [0, 1];
    for (const interval of intervals)
      if (interval) result.push(...interval.filter((t) => t > 1e-8 && t < 1 - 1e-8));
    for (const { a: i, b: j, line } of bisectors) {
      const x = intervals[i],
        y = intervals[j];
      if (!x || !y || Math.max(x[0], y[0]) > Math.min(x[1], y[1])) continue;
      const va = value(line, a),
        vb = value(line, b),
        t = va / (va - vb);
      if (t > 1e-8 && t < 1 - 1e-8 && t >= Math.max(x[0], y[0]) - 1e-8 && t <= Math.min(x[1], y[1]) + 1e-8)
        result.push(t);
    }
    return result.sort((a, b) => a - b).filter((v, i, all) => !i || v - all[i - 1] > 1e-8);
  };
  const canJoin = (index: number, a: Vec2, b: Vec2) => {
    const boundaries = [
      ...limits[index],
      ...bisectors.filter((v) => v.a === index || v.b === index).map((v) => v.line),
    ];
    if (!boundaries.some((l) => Math.abs(value(l, a)) < 1e-6 && Math.abs(value(l, b)) < 1e-6)) return false;
    const sorted = cuts(a, b);
    return sorted.slice(1).every((t, i) => {
      const p = lerp(a, b, (sorted[i] + t) / 2);
      spend(placements.length);
      return (
        contains(index, p) &&
        placements.every((_, j) => !contains(j, p) || dist2(index, p) <= dist2(j, p) + 1e-6)
      );
    });
  };
  return { order, marks, parents, locate, cuts, canJoin };
}
