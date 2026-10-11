// SPDX-License-Identifier: GPL-3.0-or-later
/** Pure operations on model geometry (no Paper). */
import { flattenSubpath } from '@/geom/flatten';
import { apply, applyLinear } from '@/geom/matrix';
import { emptyBBox, extendBBox } from '@/geom/polygon';
import type { BBox } from '@/geom/types';
import type { Matrix, Node, PathGeom, Shape, StitchElement, Vec2 } from './types';

export function transformNode(n: Node, m: Matrix): Node {
  const out: Node = { p: apply(m, n.p) };
  if (n.command) out.command = n.command;
  if (n.in) out.in = applyLinear(m, n.in);
  if (n.out) out.out = applyLinear(m, n.out);
  if (n.smooth) out.smooth = true;
  return out;
}

export function transformGeomM(g: PathGeom, m: Matrix): PathGeom {
  return {
    fillRule: g.fillRule,
    subpaths: g.subpaths.map((sp) => ({
      closed: sp.closed,
      nodes: sp.nodes.map((n) => transformNode(n, m)),
    })),
  };
}

/** Bounds of the flattened geometry (within 0.05 mm of the exact curve bounds). */
export function geomBBox(g: PathGeom, tol = 0.02): BBox {
  const b = emptyBBox();
  for (const sp of g.subpaths) extendBBox(b, flattenSubpath(sp, tol));
  return b;
}

export function shapesBBox(shapes: Shape[]): BBox {
  const b = emptyBBox();
  for (const s of shapes) {
    const sb = geomBBox(s.geom);
    if (sb.maxX >= sb.minX) {
      extendBBox(b, [sb.minX, sb.minY, sb.maxX, sb.maxY]);
    }
  }
  return b;
}

/** Direction angle (screen-CCW degrees) after transforming a direction at `deg` by m. */
export function transformAngle(deg: number, m: Matrix): number {
  const t = (-deg * Math.PI) / 180;
  const v = applyLinear(m, [Math.cos(t), Math.sin(t)]);
  let a = (-Math.atan2(v[1], v[0]) * 180) / Math.PI;
  a = ((a % 180) + 180) % 180;
  return Math.round(a * 1000) / 1000;
}

const ANGLE_TYPES = new Set(['tatami', 'satinFill', 'gradientFill', 'patternFill']);

/** Applies a transform to an element's spatial data (entry/exit/guides, angles, widths). */
export function transformElement(
  el: StitchElement,
  m: Matrix,
  scaleWidths: boolean,
  defaults: { angle?: number },
): void {
  if (el.entry) el.entry = apply(m, el.entry);
  if (el.exit) el.exit = apply(m, el.exit);
  if (el.guides) el.guides = el.guides.map(([a, b]) => [apply(m, a), apply(m, b)] as [Vec2, Vec2]);
  if (ANGLE_TYPES.has(el.type)) {
    const cur = typeof el.params.angle === 'number' ? el.params.angle : (defaults.angle ?? 45);
    const next = transformAngle(cur, m);
    const diff = Math.abs(((next - cur + 90) % 180) - 90);
    if (diff > 0.01 || typeof el.params.angle === 'number') el.params.angle = next;
    if (typeof el.params.underlayAngle === 'number')
      el.params.underlayAngle = transformAngle(el.params.underlayAngle, m);
  }
  if (scaleWidths) {
    const s = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
    if (Math.abs(s - 1) > 1e-9 && typeof el.params.width === 'number')
      el.params.width = Math.round(el.params.width * s * 1000) / 1000;
  }
}

export function isIdentity(m: Matrix): boolean {
  return (
    Math.abs(m[0] - 1) < 1e-12 &&
    Math.abs(m[1]) < 1e-12 &&
    Math.abs(m[2]) < 1e-12 &&
    Math.abs(m[3] - 1) < 1e-12 &&
    Math.abs(m[4]) < 1e-12 &&
    Math.abs(m[5]) < 1e-12
  );
}

export function cloneGeom(g: PathGeom): PathGeom {
  return structuredClone(g);
}

/** Total number of nodes. */
export function nodeCount(g: PathGeom): number {
  return g.subpaths.reduce((n, s) => n + s.nodes.length, 0);
}

/** Flattened polygons → PathGeom with straight segments (nonzero; holes oppositely oriented). */
export function polyShapeToGeom(ps: import('@/geom/types').PolyShape): PathGeom {
  const subpaths: PathGeom['subpaths'] = [];
  const ring = (r: Float64Array) => {
    const nodes: Node[] = [];
    for (let i = 0; i < r.length; i += 2) nodes.push({ p: [r[i], r[i + 1]] });
    if (nodes.length >= 3) subpaths.push({ closed: true, nodes });
  };
  for (const p of ps) {
    ring(p.outer);
    for (const h of p.holes) ring(h);
  }
  return { fillRule: 'nonzero', subpaths };
}
