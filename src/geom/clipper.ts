// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Polygon operations on flattened geometry via Clipper2 (clipper2-ts, BSL-1.0).
 * Integer scale ×1000 (1 µm units).
 */
import {
  ClipType,
  Clipper64,
  EndType,
  FillRule,
  JoinType,
  PolyTree64,
  booleanOpWithPolyTree,
  inflatePaths,
  type Path64,
  type Paths64,
  type PolyPath64,
} from 'clipper2-ts';
import { reverseRing, signedArea } from './polygon';
import type { PolyShape, Polygon, Polyline, Ring } from './types';

export const CLIPPER_SCALE = 1000;

function ringToPath(r: Ring): Path64 {
  const p: Path64 = [];
  for (let i = 0; i < r.length; i += 2)
    p.push({ x: Math.round(r[i] * CLIPPER_SCALE), y: Math.round(r[i + 1] * CLIPPER_SCALE) });
  return p;
}

function pathToRing(p: Path64): Ring {
  const r = new Float64Array(p.length * 2);
  for (let i = 0; i < p.length; i++) {
    r[i * 2] = p[i].x / CLIPPER_SCALE;
    r[i * 2 + 1] = p[i].y / CLIPPER_SCALE;
  }
  return r;
}

function polyShapeToPaths(ps: PolyShape): Paths64 {
  const out: Paths64 = [];
  for (const p of ps) {
    out.push(ringToPath(p.outer));
    for (const h of p.holes) out.push(ringToPath(h));
  }
  return out;
}

function ringsToPaths(rings: Ring[]): Paths64 {
  return rings.filter((r) => r.length >= 6).map(ringToPath);
}

function orient(r: Ring, positive: boolean): Ring {
  const a = signedArea(r);
  return a > 0 === positive ? r : reverseRing(r);
}

function treeToPolyShape(tree: PolyTree64): PolyShape {
  const out: PolyShape = [];
  const visitOuter = (node: PolyPath64) => {
    const poly = node.poly;
    if (!poly || poly.length < 3) return;
    const polygon: Polygon = { outer: orient(pathToRing(poly), true), holes: [] };
    for (let i = 0; i < node.count; i++) {
      const hole = node.child(i);
      if (hole.poly && hole.poly.length >= 3) polygon.holes.push(orient(pathToRing(hole.poly), false));
      for (let j = 0; j < hole.count; j++) visitOuter(hole.child(j));
    }
    out.push(polygon);
  };
  for (let i = 0; i < tree.count; i++) visitOuter(tree.child(i));
  return out;
}

function run(type: ClipType, subject: Paths64, clip: Paths64 | null, fillRule: FillRule): PolyShape {
  const tree = new PolyTree64();
  booleanOpWithPolyTree(type, subject, clip, tree, fillRule);
  return treeToPolyShape(tree);
}

/** Repairs self-intersections and resolves the fill rule into outer rings with holes. */
export function makeValid(rings: Ring[], fillRule: 'nonzero' | 'evenodd' = 'nonzero'): PolyShape {
  if (!rings.length) return [];
  return run(
    ClipType.Union,
    ringsToPaths(rings),
    null,
    fillRule === 'evenodd' ? FillRule.EvenOdd : FillRule.NonZero,
  );
}

export function normalize(ps: PolyShape): PolyShape {
  return run(ClipType.Union, polyShapeToPaths(ps), null, FillRule.NonZero);
}

export function union(a: PolyShape, b?: PolyShape): PolyShape {
  return run(ClipType.Union, polyShapeToPaths(a), b ? polyShapeToPaths(b) : null, FillRule.NonZero);
}

export function unionAll(list: PolyShape[]): PolyShape {
  const paths: Paths64 = [];
  for (const ps of list) paths.push(...polyShapeToPaths(ps));
  if (!paths.length) return [];
  return run(ClipType.Union, paths, null, FillRule.NonZero);
}

export function difference(a: PolyShape, b: PolyShape): PolyShape {
  if (!b.length) return a;
  return run(ClipType.Difference, polyShapeToPaths(a), polyShapeToPaths(b), FillRule.NonZero);
}

export function intersection(a: PolyShape, b: PolyShape): PolyShape {
  if (!a.length || !b.length) return [];
  return run(ClipType.Intersection, polyShapeToPaths(a), polyShapeToPaths(b), FillRule.NonZero);
}

export function xorShapes(a: PolyShape, b: PolyShape): PolyShape {
  return run(ClipType.Xor, polyShapeToPaths(a), polyShapeToPaths(b), FillRule.NonZero);
}

const JOIN: Record<'round' | 'miter' | 'square', JoinType> = {
  round: JoinType.Round,
  miter: JoinType.Miter,
  square: JoinType.Square,
};

/** Offsets polygons outward (delta > 0) or inward (delta < 0), in mm. */
export function offset(
  ps: PolyShape,
  delta: number,
  join: 'round' | 'miter' | 'square' = 'round',
  miterLimit = 2,
): PolyShape {
  if (!ps.length) return [];
  if (Math.abs(delta) < 1e-9) return ps;
  const paths = inflatePaths(
    polyShapeToPaths(ps),
    delta * CLIPPER_SCALE,
    JOIN[join],
    EndType.Polygon,
    miterLimit,
    0.01 * CLIPPER_SCALE,
  );
  return run(ClipType.Union, paths, null, FillRule.NonZero);
}

/** Offsets open polylines into a filled outline of half-width `delta` (stroke → shape). */
export function offsetPolylines(
  lines: Polyline[],
  delta: number,
  join: 'round' | 'miter' | 'square' = 'round',
  cap: 'round' | 'butt' | 'square' = 'round',
): PolyShape {
  const paths = lines.filter((l) => l.length >= 4).map(ringToPath);
  if (!paths.length || delta <= 0) return [];
  const endType = cap === 'round' ? EndType.Round : cap === 'butt' ? EndType.Butt : EndType.Square;
  const res = inflatePaths(paths, delta * CLIPPER_SCALE, JOIN[join], endType, 2, 0.01 * CLIPPER_SCALE);
  return run(ClipType.Union, res, null, FillRule.NonZero);
}

/** Offsets closed rings treated as strokes (both sides), e.g. stroke of a closed path. */
export function offsetClosedStroke(
  rings: Ring[],
  delta: number,
  join: 'round' | 'miter' | 'square' = 'round',
): PolyShape {
  const paths = ringsToPaths(rings);
  if (!paths.length || delta <= 0) return [];
  const res = inflatePaths(paths, delta * CLIPPER_SCALE, JOIN[join], EndType.Joined, 2, 0.01 * CLIPPER_SCALE);
  return run(ClipType.Union, res, null, FillRule.NonZero);
}

/** Splits a multipolygon into its connected parts (each outer with its holes). */
export function splitParts(ps: PolyShape): PolyShape[] {
  return ps.map((p) => [p]);
}

/** Exact open-path intersection with a polygon, retaining holes and disconnected pieces. */
export function clipPolylines(lines: Polyline[], area: PolyShape): Polyline[] {
  if (!lines.length || !area.length) return [];
  const c = new Clipper64();
  c.addOpenSubject(lines.filter((p) => p.length >= 4).map(ringToPath));
  c.addClip(polyShapeToPaths(area));
  const closed: Paths64 = [],
    open: Paths64 = [];
  c.execute(ClipType.Intersection, FillRule.NonZero, closed, open);
  return open.map(pathToRing);
}
