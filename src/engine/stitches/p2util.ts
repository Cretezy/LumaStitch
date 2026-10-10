// SPDX-License-Identifier: GPL-3.0-or-later
/** Helpers shared by the P2 stitch types (motif run, blanket, meander, ripple, cross stitch, appliqué). */
import {
  cumulativeLengths,
  resampleFixed,
  reversePolyline,
  smoothNormals,
  vertexNormals,
} from '@/geom/polyline';
import type { Polyline, Ring } from '@/geom/types';
import type { Vec2 } from '@/model/types';
import { RunBuilder, dist } from './common';

/** Deterministic 32-bit PRNG (mulberry32). Returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = (Math.floor(seed) | 0) ^ 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Closes a ring (no repeated start point) into a polyline that ends where it starts. */
export function closeRing(r: Ring): Polyline {
  const c = new Float64Array(r.length + 2);
  c.set(r);
  c[r.length] = r[0];
  c[r.length + 1] = r[1];
  return c;
}

/** True if every sample along a→b (at most `step` apart) passes the point test. */
export function segmentInside(
  inside: (x: number, y: number) => boolean,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  step = 0.2,
): boolean {
  const n = Math.max(1, Math.ceil(dist(ax, ay, bx, by) / step));
  for (let k = 0; k <= n; k++) if (!inside(ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n)) return false;
  return true;
}

/** A path parameterised by arc length with smoothed unit normals (+normal = (−dy, dx)). */
export interface PathFrame {
  length: number;
  closed: boolean;
  /** Point and unit normal at arc length s (clamped, or wrapped for closed paths). */
  at(s: number): { x: number; y: number; nx: number; ny: number };
}

export function pathFrame(pl: Polyline, closed: boolean, step = 0.25): PathFrame {
  const c = resampleFixed(pl, step);
  const n = c.length / 2;
  const normals = n >= 2 ? smoothNormals(vertexNormals(c, closed), 2, closed) : new Float64Array(n * 2);
  const cum = cumulativeLengths(c);
  const length = cum[n - 1] ?? 0;
  return {
    length,
    closed,
    at(s) {
      if (n < 2) return { x: c[0] ?? 0, y: c[1] ?? 0, nx: 0, ny: 0 };
      if (closed && length > 0) s = ((s % length) + length) % length;
      s = Math.max(0, Math.min(length, s));
      let lo = 0,
        hi = n - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (cum[mid] <= s) lo = mid;
        else hi = mid;
      }
      const seg = cum[hi] - cum[lo];
      const t = seg > 0 ? (s - cum[lo]) / seg : 0;
      const nx = normals[lo * 2] + (normals[hi * 2] - normals[lo * 2]) * t;
      const ny = normals[lo * 2 + 1] + (normals[hi * 2 + 1] - normals[lo * 2 + 1]) * t;
      const l = Math.hypot(nx, ny) || 1;
      return {
        x: c[lo * 2] + (c[hi * 2] - c[lo * 2]) * t,
        y: c[lo * 2 + 1] + (c[hi * 2 + 1] - c[lo * 2 + 1]) * t,
        nx: nx / l,
        ny: ny / l,
      };
    },
  };
}

/** A precomputed penetration sequence along one subpath. */
export interface FixedPath {
  pts: Polyline;
  closed: boolean;
  /** Vertex indices where a closed path may start (default: every vertex). */
  anchors?: number[];
}

/** Rotates a closed polyline (first == last) to start at vertex i. */
function rotateAt(pts: Polyline, i: number): Polyline {
  const n = pts.length / 2;
  if (i <= 0 || i >= n - 1) return pts;
  const out = new Float64Array(pts.length);
  let k = 0;
  for (let j = i; j < n; j++) {
    out[k++] = pts[j * 2];
    out[k++] = pts[j * 2 + 1];
  }
  for (let j = 1; j <= i; j++) {
    out[k++] = pts[j * 2];
    out[k++] = pts[j * 2 + 1];
  }
  return out;
}

/**
 * Sews precomputed penetration sequences: greedy nearest order from `entry`, closed paths start
 * at their nearest anchor vertex, open paths from their nearer end; internal jumps between paths
 * (the sequencer decides whether to trim).
 */
export function routeFixedPaths(paths: FixedPath[], entry?: Vec2, exit?: Vec2): RunBuilder {
  const b = new RunBuilder();
  const remaining = paths.filter((p) => p.pts.length >= 4);
  let cur: Vec2 | undefined = entry;
  while (remaining.length) {
    let bi = 0,
      bd = Infinity,
      bStart = 0,
      bRev = false;
    if (cur) {
      for (let i = 0; i < remaining.length; i++) {
        const p = remaining[i];
        const n = p.pts.length / 2;
        if (p.closed) {
          const anchors = p.anchors ?? [...Array(n - 1).keys()];
          for (const a of anchors) {
            const d = dist(cur[0], cur[1], p.pts[a * 2], p.pts[a * 2 + 1]);
            if (d < bd) {
              bd = d;
              bi = i;
              bStart = a;
              bRev = false;
            }
          }
        } else {
          let ds = dist(cur[0], cur[1], p.pts[0], p.pts[1]);
          let de = dist(cur[0], cur[1], p.pts[n * 2 - 2], p.pts[n * 2 - 1]);
          if (remaining.length === 1 && exit) {
            ds += 0.5 * dist(p.pts[n * 2 - 2], p.pts[n * 2 - 1], exit[0], exit[1]);
            de += 0.5 * dist(p.pts[0], p.pts[1], exit[0], exit[1]);
          }
          if (Math.min(ds, de) < bd) {
            bd = Math.min(ds, de);
            bi = i;
            bRev = de < ds;
          }
        }
      }
    }
    const item = remaining.splice(bi, 1)[0];
    const pts = item.closed ? rotateAt(item.pts, bStart) : bRev ? reversePolyline(item.pts) : item.pts;
    if (b.length) b.jumpTo(pts[0], pts[1]);
    b.pushPolyline(pts, 0, b.length > 0);
    cur = b.last() ?? undefined;
  }
  return b;
}
