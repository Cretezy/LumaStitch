// SPDX-License-Identifier: GPL-3.0-or-later
/** Shared helpers for stitch generators. */
import { F, type StitchRun } from '../types';
import { resampleEven } from '@/geom/polyline';
import type { Polyline } from '@/geom/types';
import type { Vec2 } from '@/model/types';

/** Accumulates needle points and per-point flags. */
export class RunBuilder {
  xy: number[] = [];
  flags: number[] = [];

  get length(): number {
    return this.flags.length;
  }

  last(): Vec2 | null {
    const n = this.flags.length;
    return n ? [this.xy[n * 2 - 2], this.xy[n * 2 - 1]] : null;
  }

  push(x: number, y: number, flag: number = F.STITCH): void {
    this.xy.push(x, y);
    this.flags.push(flag);
  }

  /** Appends a polyline's points; `skipFirst` omits its first point (when it equals the current point). */
  pushPolyline(pl: ArrayLike<number>, flag: number = F.STITCH, skipFirst = false): void {
    for (let i = skipFirst ? 2 : 0; i < pl.length; i += 2) this.push(pl[i], pl[i + 1], flag);
  }

  /** Marks the next point as reached by a jump (generator-internal; the sequencer decides trims). */
  jumpTo(x: number, y: number, flag = 0): void {
    this.push(x, y, F.JUMP | flag);
  }

  append(run: StitchRun): void {
    for (let i = 0; i < run.flags.length; i++) this.push(run.xy[i * 2], run.xy[i * 2 + 1], run.flags[i]);
  }

  build(): StitchRun {
    return { xy: Float64Array.from(this.xy), flags: Uint8Array.from(this.flags) };
  }
}

export function runFrom(points: ArrayLike<number>, flag: number = F.STITCH): StitchRun {
  const n = points.length / 2;
  return { xy: Float64Array.from(points), flags: new Uint8Array(n).fill(flag) };
}

/** Running stitch along a polyline: even spacing between corners, no stitch longer than `len`. */
export function runningPoints(pl: Polyline, len: number, cornerDeg = 30): Polyline {
  return resampleEven(pl, Math.max(0.1, len), cornerDeg);
}

/**
 * Expands a sequence of penetrations with bean (repeat) stitches: each stitch a→b becomes
 * a→b→a→b (bean = 1) or a→b→a→b→a→b (bean = 2).
 */
export function beanify(pts: Polyline, bean: number): Polyline {
  if (bean <= 0 || pts.length < 4) return pts;
  const out: number[] = [pts[0], pts[1]];
  for (let i = 2; i < pts.length; i += 2) {
    const ax = pts[i - 2],
      ay = pts[i - 1],
      bx = pts[i],
      by = pts[i + 1];
    out.push(bx, by);
    for (let k = 0; k < bean; k++) out.push(ax, ay, bx, by);
  }
  return Float64Array.from(out);
}

export function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(bx - ax, by - ay);
}

export function distV(a: Vec2, b: Vec2): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}
