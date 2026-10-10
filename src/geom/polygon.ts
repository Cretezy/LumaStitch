// SPDX-License-Identifier: GPL-3.0-or-later
/** Polygon helpers on flattened rings (interleaved Float64Array). */
import type { BBox, PolyShape, Polygon, Ring } from './types';

export function signedArea(r: Ring): number {
  const n = r.length;
  let a = 0;
  for (let i = 0; i < n; i += 2) {
    const j = (i + 2) % n;
    a += r[i] * r[j + 1] - r[j] * r[i + 1];
  }
  return a / 2;
}

export function reverseRing(r: Ring): Ring {
  const n = r.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i += 2) {
    out[i] = r[n - 2 - i];
    out[i + 1] = r[n - 1 - i];
  }
  return out;
}

export function polygonArea(p: Polygon): number {
  let a = Math.abs(signedArea(p.outer));
  for (const h of p.holes) a -= Math.abs(signedArea(h));
  return a;
}

export function polyShapeArea(ps: PolyShape): number {
  let a = 0;
  for (const p of ps) a += polygonArea(p);
  return a;
}

export function emptyBBox(): BBox {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

export function extendBBox(b: BBox, pts: ArrayLike<number>): BBox {
  for (let i = 0; i < pts.length; i += 2) {
    const x = pts[i],
      y = pts[i + 1];
    if (x < b.minX) b.minX = x;
    if (y < b.minY) b.minY = y;
    if (x > b.maxX) b.maxX = x;
    if (y > b.maxY) b.maxY = y;
  }
  return b;
}

export function ringBBox(r: Ring): BBox {
  return extendBBox(emptyBBox(), r);
}

export function polyShapeBBox(ps: PolyShape): BBox {
  const b = emptyBBox();
  for (const p of ps) extendBBox(b, p.outer);
  return b;
}

export function bboxIntersects(a: BBox, b: BBox, margin = 0): boolean {
  return !(
    a.maxX + margin < b.minX ||
    b.maxX + margin < a.minX ||
    a.maxY + margin < b.minY ||
    b.maxY + margin < a.minY
  );
}

export function isEmptyBBox(b: BBox): boolean {
  return !(b.maxX >= b.minX && b.maxY >= b.minY);
}

/** Area centroid of a ring. Falls back to the vertex mean for degenerate rings. */
export function ringCentroid(r: Ring): [number, number] {
  let a = 0,
    cx = 0,
    cy = 0;
  const n = r.length;
  for (let i = 0; i < n; i += 2) {
    const j = (i + 2) % n;
    const cross = r[i] * r[j + 1] - r[j] * r[i + 1];
    a += cross;
    cx += (r[i] + r[j]) * cross;
    cy += (r[i + 1] + r[j + 1]) * cross;
  }
  if (Math.abs(a) < 1e-12) {
    let sx = 0,
      sy = 0;
    for (let i = 0; i < n; i += 2) {
      sx += r[i];
      sy += r[i + 1];
    }
    const m = Math.max(1, n / 2);
    return [sx / m, sy / m];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

export function polyShapeCentroid(ps: PolyShape): [number, number] {
  let A = 0,
    X = 0,
    Y = 0;
  for (const p of ps) {
    for (const r of [p.outer, ...p.holes]) {
      const a = signedArea(r);
      const [cx, cy] = ringCentroid(r);
      A += a;
      X += cx * a;
      Y += cy * a;
    }
  }
  if (Math.abs(A) < 1e-12) {
    const b = polyShapeBBox(ps);
    return [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
  }
  return [X / A, Y / A];
}

/** Even-odd point in ring test. */
export function pointInRing(r: Ring, x: number, y: number): boolean {
  let inside = false;
  const n = r.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const xi = r[i],
      yi = r[i + 1],
      xj = r[j],
      yj = r[j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function pointInPolygon(p: Polygon, x: number, y: number): boolean {
  if (!pointInRing(p.outer, x, y)) return false;
  for (const h of p.holes) if (pointInRing(h, x, y)) return false;
  return true;
}

export function pointInPolyShape(ps: PolyShape, x: number, y: number): boolean {
  for (const p of ps) if (pointInPolygon(p, x, y)) return true;
  return false;
}

/** Squared distance from point to segment, and the parameter t. */
export function segDist2(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): [number, number] {
  const dx = bx - ax,
    dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const qx = ax + t * dx - px,
    qy = ay + t * dy - py;
  return [qx * qx + qy * qy, t];
}

/** Distance from a point to the nearest edge of a ring. */
export function distToRing(r: Ring, x: number, y: number): number {
  let best = Infinity;
  const n = r.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const [d2] = segDist2(x, y, r[j], r[j + 1], r[i], r[i + 1]);
    if (d2 < best) best = d2;
  }
  return Math.sqrt(best);
}

export function distToPolyShapeBoundary(ps: PolyShape, x: number, y: number): number {
  let best = Infinity;
  for (const p of ps) {
    best = Math.min(best, distToRing(p.outer, x, y));
    for (const h of p.holes) best = Math.min(best, distToRing(h, x, y));
  }
  return best;
}

/** Nearest point on a ring boundary: returns point, edge index (start vertex), t and distance. */
export function nearestOnRing(
  r: Ring,
  x: number,
  y: number,
): { x: number; y: number; edge: number; t: number; dist: number } {
  let best = Infinity,
    be = 0,
    bt = 0;
  const n = r.length;
  for (let i = 0; i < n; i += 2) {
    const j = (i + 2) % n;
    const [d2, t] = segDist2(x, y, r[i], r[i + 1], r[j], r[j + 1]);
    if (d2 < best) {
      best = d2;
      be = i / 2;
      bt = t;
    }
  }
  const i = be * 2,
    j = (i + 2) % n;
  return {
    x: r[i] + (r[j] - r[i]) * bt,
    y: r[i + 1] + (r[j + 1] - r[i + 1]) * bt,
    edge: be,
    t: bt,
    dist: Math.sqrt(best),
  };
}

/** Andrew's monotone chain. Returns hull as ring with positive area. */
export function convexHull(pts: ArrayLike<number>): Ring {
  const P: [number, number][] = [];
  for (let i = 0; i < pts.length; i += 2) P.push([pts[i], pts[i + 1]]);
  P.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (P.length < 3) return Float64Array.from(P.flat());
  const cross = (o: number[], a: number[], b: number[]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const p of P) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: [number, number][] = [];
  for (let i = P.length - 1; i >= 0; i--) {
    const p = P[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  const hull = Float64Array.from(lower.concat(upper).flat());
  return signedArea(hull) < 0 ? reverseRing(hull) : hull;
}

export interface MinAreaRect {
  /** Long-axis direction, degrees CCW on screen (y down), in [0, 180). */
  angle: number;
  /** Long side. */
  length: number;
  /** Short side. */
  width: number;
  center: [number, number];
}

/** Minimum-area enclosing rectangle via rotating calipers over the convex hull edges. */
export function minAreaRect(pts: ArrayLike<number>): MinAreaRect {
  const hull = convexHull(pts);
  const n = hull.length / 2;
  if (n < 2) return { angle: 0, length: 0, width: 0, center: n ? [hull[0], hull[1]] : [0, 0] };
  let best: {
    area: number;
    ux: number;
    uy: number;
    minU: number;
    maxU: number;
    minV: number;
    maxV: number;
  } | null = null;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    let ux = hull[j * 2] - hull[i * 2],
      uy = hull[j * 2 + 1] - hull[i * 2 + 1];
    const l = Math.hypot(ux, uy);
    if (l < 1e-12) continue;
    ux /= l;
    uy /= l;
    let minU = Infinity,
      maxU = -Infinity,
      minV = Infinity,
      maxV = -Infinity;
    for (let k = 0; k < n; k++) {
      const x = hull[k * 2],
        y = hull[k * 2 + 1];
      const u = x * ux + y * uy;
      const v = -x * uy + y * ux;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    const area = (maxU - minU) * (maxV - minV);
    if (!best || area < best.area - 1e-12) best = { area, ux, uy, minU, maxU, minV, maxV };
  }
  if (!best) return { angle: 0, length: 0, width: 0, center: [hull[0], hull[1]] };
  const du = best.maxU - best.minU,
    dv = best.maxV - best.minV;
  const cu = (best.minU + best.maxU) / 2,
    cv = (best.minV + best.maxV) / 2;
  const center: [number, number] = [cu * best.ux - cv * best.uy, cu * best.uy + cv * best.ux];
  // Long axis direction vector.
  const [lx, ly] = du >= dv ? [best.ux, best.uy] : [-best.uy, best.ux];
  // Screen-CCW angle: y is down so negate.
  let angle = (Math.atan2(-ly, lx) * 180) / Math.PI;
  angle = ((angle % 180) + 180) % 180;
  return { angle, length: Math.max(du, dv), width: Math.min(du, dv), center };
}

/** Principal axis angle (screen-CCW degrees in [0,180)) of a point cloud. */
export function pcaAngle(pts: ArrayLike<number>): number {
  const n = pts.length / 2;
  let mx = 0,
    my = 0;
  for (let i = 0; i < pts.length; i += 2) {
    mx += pts[i];
    my += pts[i + 1];
  }
  mx /= n;
  my /= n;
  let sxx = 0,
    syy = 0,
    sxy = 0;
  for (let i = 0; i < pts.length; i += 2) {
    const dx = pts[i] - mx,
      dy = pts[i + 1] - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  let angle = (-theta * 180) / Math.PI;
  angle = ((angle % 180) + 180) % 180;
  return angle;
}

export function ringPerimeter(r: Ring): number {
  let l = 0;
  const n = r.length;
  for (let i = 0; i < n; i += 2) {
    const j = (i + 2) % n;
    l += Math.hypot(r[j] - r[i], r[j + 1] - r[i + 1]);
  }
  return l;
}

export function transformRing(r: Ring, m: [number, number, number, number, number, number]): Ring {
  const out = new Float64Array(r.length);
  for (let i = 0; i < r.length; i += 2) {
    const x = r[i],
      y = r[i + 1];
    out[i] = m[0] * x + m[2] * y + m[4];
    out[i + 1] = m[1] * x + m[3] * y + m[5];
  }
  return out;
}

export function transformPolyShape(
  ps: PolyShape,
  m: [number, number, number, number, number, number],
): PolyShape {
  const det = m[0] * m[3] - m[1] * m[2];
  const fix = (r: Ring) => (det < 0 ? reverseRing(transformRing(r, m)) : transformRing(r, m));
  return ps.map((p) => ({ outer: fix(p.outer), holes: p.holes.map(fix) }));
}

/**
 * Fast repeated point-in-polygon tests: edges are bucketed by y so each query only
 * ray-casts against edges crossing its row band. Even-odd over all rings (outer + holes).
 */
export function createPointTester(ps: PolyShape, bins = 256): (x: number, y: number) => boolean {
  const b = polyShapeBBox(ps);
  if (isEmptyBBox(b)) return () => false;
  const h = Math.max(1e-9, b.maxY - b.minY);
  const nb = Math.max(1, Math.min(bins, Math.ceil(h / 0.05)));
  const buckets: number[][] = Array.from({ length: nb }, () => []);
  const edges: number[] = [];
  const addRing = (r: Ring) => {
    const n = r.length;
    for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
      const e = edges.length;
      edges.push(r[j], r[j + 1], r[i], r[i + 1]);
      const y0 = Math.min(r[j + 1], r[i + 1]),
        y1 = Math.max(r[j + 1], r[i + 1]);
      const b0 = Math.max(0, Math.floor(((y0 - b.minY) / h) * nb));
      const b1 = Math.min(nb - 1, Math.floor(((y1 - b.minY) / h) * nb));
      for (let k = b0; k <= b1; k++) buckets[k].push(e);
    }
  };
  for (const p of ps) {
    addRing(p.outer);
    for (const hr of p.holes) addRing(hr);
  }
  return (x: number, y: number) => {
    if (x < b.minX || x > b.maxX || y < b.minY || y > b.maxY) return false;
    const k = Math.min(nb - 1, Math.max(0, Math.floor(((y - b.minY) / h) * nb)));
    let inside = false;
    for (const e of buckets[k]) {
      const xj = edges[e],
        yj = edges[e + 1],
        xi = edges[e + 2],
        yi = edges[e + 3];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
}
