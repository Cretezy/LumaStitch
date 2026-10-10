// SPDX-License-Identifier: GPL-3.0-or-later
/** Polyline helpers on interleaved Float64Arrays. */
import { segDist2 } from './polygon';
import type { Polyline } from './types';

export function polylineLength(pl: ArrayLike<number>): number {
  let l = 0;
  for (let i = 2; i < pl.length; i += 2) l += Math.hypot(pl[i] - pl[i - 2], pl[i + 1] - pl[i - 1]);
  return l;
}

/** Cumulative arc length at each vertex. */
export function cumulativeLengths(pl: ArrayLike<number>): Float64Array {
  const n = pl.length / 2;
  const out = new Float64Array(n);
  for (let i = 1; i < n; i++)
    out[i] = out[i - 1] + Math.hypot(pl[i * 2] - pl[i * 2 - 2], pl[i * 2 + 1] - pl[i * 2 - 1]);
  return out;
}

/** Point at arc length s (clamped). `cum` must be cumulativeLengths(pl). */
export function pointAtLength(pl: ArrayLike<number>, cum: ArrayLike<number>, s: number): [number, number] {
  const n = cum.length;
  if (n === 0) return [0, 0];
  if (s <= 0) return [pl[0], pl[1]];
  if (s >= cum[n - 1]) return [pl[(n - 1) * 2], pl[(n - 1) * 2 + 1]];
  let lo = 0,
    hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= s) lo = mid;
    else hi = mid;
  }
  const seg = cum[hi] - cum[lo];
  const t = seg > 0 ? (s - cum[lo]) / seg : 0;
  return [pl[lo * 2] + (pl[hi * 2] - pl[lo * 2]) * t, pl[lo * 2 + 1] + (pl[hi * 2 + 1] - pl[lo * 2 + 1]) * t];
}

/** Turn angle (degrees, 0 = straight) at interior vertex i. */
export function turnAngle(pl: ArrayLike<number>, i: number): number {
  const ax = pl[i * 2] - pl[i * 2 - 2],
    ay = pl[i * 2 + 1] - pl[i * 2 - 1];
  const bx = pl[i * 2 + 2] - pl[i * 2],
    by = pl[i * 2 + 3] - pl[i * 2 + 1];
  const la = Math.hypot(ax, ay),
    lb = Math.hypot(bx, by);
  if (la < 1e-12 || lb < 1e-12) return 0;
  const c = Math.max(-1, Math.min(1, (ax * bx + ay * by) / (la * lb)));
  return (Math.acos(c) * 180) / Math.PI;
}

/** Splits a polyline at corners sharper than `cornerDeg`. Returns vertex index ranges [start, end]. */
export function cornerIndices(pl: ArrayLike<number>, cornerDeg: number): number[] {
  const n = pl.length / 2;
  const out = [0];
  for (let i = 1; i < n - 1; i++) if (turnAngle(pl, i) > cornerDeg) out.push(i);
  out.push(n - 1);
  return out;
}

/**
 * Evenly resamples a polyline so no step exceeds `maxLen`, keeping corners (turn > cornerDeg)
 * as exact penetrations. Each corner-to-corner piece is split into ceil(len / maxLen) equal steps.
 */
export function resampleEven(pl: Polyline, maxLen: number, cornerDeg = 30): Polyline {
  const n = pl.length / 2;
  if (n < 2) return pl.slice();
  const corners = cornerIndices(pl, cornerDeg);
  const out: number[] = [pl[0], pl[1]];
  for (let c = 0; c < corners.length - 1; c++) {
    const a = corners[c],
      b = corners[c + 1];
    const piece = pl.subarray(a * 2, b * 2 + 2);
    const cum = cumulativeLengths(piece);
    const len = cum[cum.length - 1];
    if (len < 1e-9) continue;
    const steps = Math.max(1, Math.ceil(len / maxLen - 1e-9));
    for (let k = 1; k <= steps; k++) {
      const [x, y] = pointAtLength(piece, cum, (len * k) / steps);
      out.push(x, y);
    }
  }
  return Float64Array.from(out);
}

/** Resample at a fixed spacing (last step may be shorter). Used for fine centreline sampling. */
export function resampleFixed(pl: Polyline, step: number): Polyline {
  const cum = cumulativeLengths(pl);
  const len = cum[cum.length - 1] ?? 0;
  if (len < 1e-9) return pl.slice(0, 2);
  const steps = Math.max(1, Math.ceil(len / step));
  const out = new Float64Array((steps + 1) * 2);
  for (let k = 0; k <= steps; k++) {
    const [x, y] = pointAtLength(pl, cum, (len * k) / steps);
    out[k * 2] = x;
    out[k * 2 + 1] = y;
  }
  return out;
}

export interface NearestResult {
  /** Segment index (vertex i → i+1). */
  seg: number;
  t: number;
  x: number;
  y: number;
  dist: number;
  /** Arc length position. */
  s: number;
}

export function nearestOnPolyline(pl: ArrayLike<number>, x: number, y: number): NearestResult {
  const n = pl.length / 2;
  let best = Infinity,
    bs = 0,
    bt = 0;
  for (let i = 0; i < n - 1; i++) {
    const [d2, t] = segDist2(x, y, pl[i * 2], pl[i * 2 + 1], pl[i * 2 + 2], pl[i * 2 + 3]);
    if (d2 < best) {
      best = d2;
      bs = i;
      bt = t;
    }
  }
  if (n === 1) return { seg: 0, t: 0, x: pl[0], y: pl[1], dist: Math.hypot(pl[0] - x, pl[1] - y), s: 0 };
  const cum = cumulativeLengths(pl);
  const ax = pl[bs * 2],
    ay = pl[bs * 2 + 1],
    bx = pl[bs * 2 + 2],
    by = pl[bs * 2 + 3];
  return {
    seg: bs,
    t: bt,
    x: ax + (bx - ax) * bt,
    y: ay + (by - ay) * bt,
    dist: Math.sqrt(best),
    s: cum[bs] + (cum[bs + 1] - cum[bs]) * bt,
  };
}

export function reversePolyline(pl: Polyline): Polyline {
  const n = pl.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i += 2) {
    out[i] = pl[n - 2 - i];
    out[i + 1] = pl[n - 1 - i];
  }
  return out;
}

/**
 * Rotates a closed polyline (first point == last point) so it starts at the point nearest (x, y),
 * inserting that point as a vertex.
 */
export function rotateClosedTo(pl: Polyline, x: number, y: number): Polyline {
  const n = pl.length / 2;
  if (n < 3) return pl.slice();
  const near = nearestOnPolyline(pl, x, y);
  const out: number[] = [near.x, near.y];
  // Walk from seg+1 to end (skipping duplicate closing point), then 0..seg, then back to the start point.
  for (let i = near.seg + 1; i < n - 1; i++) out.push(pl[i * 2], pl[i * 2 + 1]);
  for (let i = 0; i <= near.seg; i++) out.push(pl[i * 2], pl[i * 2 + 1]);
  out.push(near.x, near.y);
  return dedupeConsecutive(Float64Array.from(out));
}

export function dedupeConsecutive(pl: Polyline, eps = 1e-9): Polyline {
  const out: number[] = [];
  for (let i = 0; i < pl.length; i += 2) {
    const k = out.length;
    if (k >= 2 && Math.abs(out[k - 2] - pl[i]) <= eps && Math.abs(out[k - 1] - pl[i + 1]) <= eps) continue;
    out.push(pl[i], pl[i + 1]);
  }
  return Float64Array.from(out);
}

/** Per-vertex unit normals (left of travel direction in y-down screen terms is +normal = (−dy, dx)). */
export function vertexNormals(pl: ArrayLike<number>, closed: boolean): Float64Array {
  const n = pl.length / 2;
  const out = new Float64Array(n * 2);
  const segN = (i: number): [number, number] => {
    const j = i + 1;
    const dx = pl[j * 2] - pl[i * 2],
      dy = pl[j * 2 + 1] - pl[i * 2 + 1];
    const l = Math.hypot(dx, dy) || 1;
    return [-dy / l, dx / l];
  };
  for (let i = 0; i < n; i++) {
    let nx = 0,
      ny = 0;
    if (i > 0) {
      const [ax, ay] = segN(i - 1);
      nx += ax;
      ny += ay;
    } else if (closed && n > 2) {
      const [ax, ay] = segN(n - 2);
      nx += ax;
      ny += ay;
    }
    if (i < n - 1) {
      const [bx, by] = segN(i);
      nx += bx;
      ny += by;
    } else if (closed && n > 2) {
      const [bx, by] = segN(0);
      nx += bx;
      ny += by;
    }
    const l = Math.hypot(nx, ny);
    if (l < 1e-9) {
      const [bx, by] = i < n - 1 ? segN(i) : segN(i - 1);
      out[i * 2] = bx;
      out[i * 2 + 1] = by;
    } else {
      out[i * 2] = nx / l;
      out[i * 2 + 1] = ny / l;
    }
  }
  return out;
}

/** Smooths normals with a moving average over ±k vertices, then renormalises. */
export function smoothNormals(normals: Float64Array, k: number, closed: boolean): Float64Array {
  if (k <= 0) return normals;
  const n = normals.length / 2;
  const out = new Float64Array(normals.length);
  for (let i = 0; i < n; i++) {
    let sx = 0,
      sy = 0;
    for (let d = -k; d <= k; d++) {
      let j = i + d;
      if (closed) j = ((j % (n - 1)) + (n - 1)) % (n - 1);
      else j = Math.max(0, Math.min(n - 1, j));
      sx += normals[j * 2];
      sy += normals[j * 2 + 1];
    }
    const l = Math.hypot(sx, sy) || 1;
    out[i * 2] = sx / l;
    out[i * 2 + 1] = sy / l;
  }
  return out;
}

/** Douglas–Peucker simplification. */
export function simplifyDP(pl: Polyline, tol: number): Polyline {
  const n = pl.length / 2;
  if (n <= 2) return pl.slice();
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  const tol2 = tol * tol;
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let maxD = -1,
      idx = -1;
    for (let i = a + 1; i < b; i++) {
      const [d2] = segDist2(pl[i * 2], pl[i * 2 + 1], pl[a * 2], pl[a * 2 + 1], pl[b * 2], pl[b * 2 + 1]);
      if (d2 > maxD) {
        maxD = d2;
        idx = i;
      }
    }
    if (maxD > tol2 && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pl[i * 2], pl[i * 2 + 1]);
  return Float64Array.from(out);
}

/** Simplify a closed ring (no repeated start point). */
export function simplifyRing(r: Float64Array, tol: number): Float64Array {
  const n = r.length / 2;
  if (n <= 4) return r.slice();
  // Split at vertex 0 and the farthest vertex from it so DP keeps both.
  let far = 0,
    fd = -1;
  for (let i = 1; i < n; i++) {
    const d = Math.hypot(r[i * 2] - r[0], r[i * 2 + 1] - r[1]);
    if (d > fd) {
      fd = d;
      far = i;
    }
  }
  const a = simplifyDP(r.slice(0, far * 2 + 2), tol);
  const bArr = new Float64Array((n - far + 1) * 2);
  bArr.set(r.subarray(far * 2));
  bArr[bArr.length - 2] = r[0];
  bArr[bArr.length - 1] = r[1];
  const b = simplifyDP(bArr, tol);
  const out = new Float64Array(a.length + b.length - 4);
  out.set(a);
  out.set(b.subarray(2, b.length - 2), a.length);
  return out;
}
