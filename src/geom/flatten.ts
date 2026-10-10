// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Bézier flattening. Pure TS (no Paper) so it can run in the engine worker.
 * Adaptive subdivision with a chord-error tolerance (default 0.05 mm).
 */
import type { Node, PathGeom, Subpath } from '@/model/types';
import { FLATTEN_TOLERANCE, type Polyline, type Ring } from './types';

const MAX_DEPTH = 18;

function flatEnough(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
  tol: number,
): boolean {
  // Max distance of control points from the chord, a conservative bound on curve deviation (×3/4).
  const ux = 3 * x1 - 2 * x0 - x3;
  const uy = 3 * y1 - 2 * y0 - y3;
  const vx = 3 * x2 - 2 * x3 - x0;
  const vy = 3 * y2 - 2 * y3 - y0;
  const d = Math.max(ux * ux, vx * vx) + Math.max(uy * uy, vy * vy);
  return d <= 16 * tol * tol;
}

function subdivide(
  out: number[],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
  tol: number,
  depth: number,
): void {
  if (depth >= MAX_DEPTH || flatEnough(x0, y0, x1, y1, x2, y2, x3, y3, tol)) {
    out.push(x3, y3);
    return;
  }
  const x01 = (x0 + x1) / 2,
    y01 = (y0 + y1) / 2;
  const x12 = (x1 + x2) / 2,
    y12 = (y1 + y2) / 2;
  const x23 = (x2 + x3) / 2,
    y23 = (y2 + y3) / 2;
  const xa = (x01 + x12) / 2,
    ya = (y01 + y12) / 2;
  const xb = (x12 + x23) / 2,
    yb = (y12 + y23) / 2;
  const xm = (xa + xb) / 2,
    ym = (ya + yb) / 2;
  subdivide(out, x0, y0, x01, y01, xa, ya, xm, ym, tol, depth + 1);
  subdivide(out, xm, ym, xb, yb, x23, y23, x3, y3, tol, depth + 1);
}

/** Appends the flattened segment a→b (excluding a's point, including b's). */
export function flattenSegment(out: number[], a: Node, b: Node, tol = FLATTEN_TOLERANCE): void {
  const ao = a.out;
  const bi = b.in;
  if ((!ao || (ao[0] === 0 && ao[1] === 0)) && (!bi || (bi[0] === 0 && bi[1] === 0))) {
    out.push(b.p[0], b.p[1]);
    return;
  }
  const x0 = a.p[0],
    y0 = a.p[1];
  const x1 = x0 + (ao ? ao[0] : 0),
    y1 = y0 + (ao ? ao[1] : 0);
  const x3 = b.p[0],
    y3 = b.p[1];
  const x2 = x3 + (bi ? bi[0] : 0),
    y2 = y3 + (bi ? bi[1] : 0);
  subdivide(out, x0, y0, x1, y1, x2, y2, x3, y3, tol, 0);
}

/** Removes consecutive duplicate points (and closing duplicate for rings). */
function dedupe(pts: number[], closed: boolean): Float64Array {
  const out: number[] = [];
  for (let i = 0; i < pts.length; i += 2) {
    const n = out.length;
    if (n >= 2 && Math.abs(out[n - 2] - pts[i]) < 1e-9 && Math.abs(out[n - 1] - pts[i + 1]) < 1e-9) continue;
    out.push(pts[i], pts[i + 1]);
  }
  if (closed && out.length >= 4) {
    const n = out.length;
    if (Math.abs(out[0] - out[n - 2]) < 1e-9 && Math.abs(out[1] - out[n - 1]) < 1e-9) out.length = n - 2;
  }
  return Float64Array.from(out);
}

/**
 * Flattens one subpath. Closed subpaths return a ring (no repeated start point);
 * open subpaths return a polyline.
 */
export function flattenSubpath(sp: Subpath, tol = FLATTEN_TOLERANCE): Float64Array {
  const nodes = sp.nodes;
  if (nodes.length === 0) return new Float64Array(0);
  const pts: number[] = [nodes[0].p[0], nodes[0].p[1]];
  for (let i = 1; i < nodes.length; i++) flattenSegment(pts, nodes[i - 1], nodes[i], tol);
  if (sp.closed && nodes.length > 1) flattenSegment(pts, nodes[nodes.length - 1], nodes[0], tol);
  return dedupe(pts, sp.closed);
}

export interface FlatGeom {
  /** Closed subpaths (≥ 3 points). */
  rings: Ring[];
  /** Open subpaths (≥ 2 points). */
  polylines: Polyline[];
}

export function flattenGeom(geom: PathGeom, tol = FLATTEN_TOLERANCE): FlatGeom {
  const rings: Ring[] = [];
  const polylines: Polyline[] = [];
  for (const sp of geom.subpaths) {
    const f = flattenSubpath(sp, tol);
    if (sp.closed) {
      if (f.length >= 6) rings.push(f);
    } else if (f.length >= 4) polylines.push(f);
  }
  return { rings, polylines };
}

/**
 * Every subpath as a polyline to sew along. Closed subpaths repeat their start point at the end.
 */
export function flattenToPaths(
  geom: PathGeom,
  tol = FLATTEN_TOLERANCE,
): { pts: Polyline; closed: boolean }[] {
  const out: { pts: Polyline; closed: boolean }[] = [];
  for (const sp of geom.subpaths) {
    const f = flattenSubpath(sp, tol);
    if (f.length < 4) continue;
    if (sp.closed) {
      const c = new Float64Array(f.length + 2);
      c.set(f);
      c[f.length] = f[0];
      c[f.length + 1] = f[1];
      out.push({ pts: c, closed: true });
    } else out.push({ pts: f, closed: false });
  }
  return out;
}
