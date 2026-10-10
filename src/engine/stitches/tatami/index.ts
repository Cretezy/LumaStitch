// SPDX-License-Identifier: GPL-3.0-or-later
/** Tatami fill: rows of running stitches with underlay and inside travel between sections. */
import { flattenGeom } from '@/geom/flatten';
import { intersection, makeValid, offset, union } from '@/geom/clipper';
import { polyShapeArea } from '@/geom/polygon';
import { rotateClosedTo } from '@/geom/polyline';
import type { PolyShape } from '@/geom/types';
import { InsideRouter } from '@/geom/visibility';
import { apply, invert } from '@/geom/matrix';
import type { PathGeom, Vec2 } from '@/model/types';
import type { EngineCtx, Hints, StitchTypeDef } from '../../def';
import { num, str, type ParamDef, type Params } from '../../params/types';
import { F, type StitchRun } from '../../types';
import { RunBuilder, runningPoints } from '../common';
import { buildLayer, exitCorner, sectionCorner, sewSection, type FillLayer } from './layer';

export const FILL_UNDERLAY_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'edge', label: 'Edge run' },
  { value: 'tatami', label: 'Tatami' },
  { value: 'edgeTatami', label: 'Edge run + tatami' },
];

/** Polygon of a fill element: flattened, repaired, and grown into later regions for cutouts. */
export function fillPolygon(geom: PathGeom, params: Params, ctx: EngineCtx): PolyShape {
  const flat = flattenGeom(geom, ctx.tolerance);
  let poly = makeValid(flat.rings, geom.fillRule);
  const grow = num(params, 'cutoutGrowth', 0);
  if (grow > 0 && ctx.growClip && ctx.growClip.length) {
    poly = union(poly, intersection(offset(poly, grow), ctx.growClip));
  }
  return poly;
}

export interface TravelCtx {
  router: InsideRouter | null;
  travelLen: number;
}

/** Connects the builder's current point to `to`: inside travel run, or an internal jump. */
export function travelTo(b: RunBuilder, to: Vec2, t: TravelCtx, flag = 0): void {
  const cur = b.last();
  if (!cur) {
    b.push(to[0], to[1], flag);
    return;
  }
  const d = Math.hypot(to[0] - cur[0], to[1] - cur[1]);
  if (d < 1e-6) return;
  if (!t.router) {
    if (d <= t.travelLen) b.push(to[0], to[1], F.TRAVEL | flag);
    else b.jumpTo(to[0], to[1], F.TRIM | flag);
    return;
  }
  let path: Float64Array | null = null;
  const a = t.router.snapInside(cur[0], cur[1]);
  const z = t.router.snapInside(to[0], to[1]);
  if (a && z) {
    // A short hop is sewn directly only if it stays inside the shape.
    if (d <= t.travelLen && t.router.clear(a[0], a[1], z[0], z[1])) {
      b.push(to[0], to[1], F.TRAVEL | flag);
      return;
    }
    const inner = t.router.path(a[0], a[1], z[0], z[1]);
    if (inner) path = Float64Array.from([cur[0], cur[1], ...inner, to[0], to[1]]);
  }
  if (path) {
    let len = 0;
    for (let i = 2; i < path.length; i += 2)
      len += Math.hypot(path[i] - path[i - 2], path[i + 1] - path[i - 1]);
    if (len <= 3 * d + 1) {
      const pts = runningPoints(path, t.travelLen, 20);
      for (let i = 2; i < pts.length; i += 2) b.push(pts[i], pts[i + 1], F.TRAVEL | flag);
      return;
    }
  }
  // No inside path (or a long detour): tie off, trim and jump.
  b.jumpTo(to[0], to[1], F.TRIM | flag);
}

/** Sews a fill layer: greedy nearest section corner, inside travel between sections. */
export function sewLayer(
  b: RunBuilder,
  layer: FillLayer,
  t: TravelCtx,
  minEnd: number,
  flag: number,
  start?: Vec2,
  exit?: Vec2,
): void {
  const n = layer.sections.length;
  if (!n) return;
  const done = new Uint8Array(n);
  let last = -1;
  if (exit) {
    // Reserve the section nearest the exit for last.
    let bd = Infinity;
    for (let i = 0; i < n; i++)
      for (let c = 0; c < 4; c++) {
        const p = sectionCorner(layer, layer.sections[i], c);
        const d = Math.hypot(p[0] - exit[0], p[1] - exit[1]);
        if (d < bd) {
          bd = d;
          last = i;
        }
      }
    if (n > 1) done[last] = 1;
    else last = -1;
  }
  let remaining = n - (last >= 0 ? 1 : 0);
  const sew = (i: number, c: number) => {
    const s = layer.sections[i];
    const p = sectionCorner(layer, s, c);
    travelTo(b, p, t, flag);
    const rows = sewSection(layer, s, c, minEnd);
    rows.forEach((pts, ri) => {
      if (ri > 0) {
        // The turn to the next row normally follows the outline; if it would cut across a hole or
        // notch (rows far apart at a corner), travel inside instead.
        const cur = b.last()!;
        let ok = true;
        for (const u of [0.25, 0.5, 0.75])
          if (!layer.inside(cur[0] + (pts[0] - cur[0]) * u, cur[1] + (pts[1] - cur[1]) * u)) ok = false;
        if (!ok) travelTo(b, [pts[0], pts[1]], t, flag);
      }
      const startIdx = b.length;
      b.pushPolyline(pts, flag);
      // Drop a duplicate first point if travel already landed there.
      if (startIdx > 0 && b.length > startIdx) {
        const px = b.xy[startIdx * 2 - 2],
          py = b.xy[startIdx * 2 - 1];
        if (Math.abs(px - pts[0]) < 1e-9 && Math.abs(py - pts[1]) < 1e-9) {
          b.xy.splice(startIdx * 2, 2);
          b.flags.splice(startIdx, 1);
        }
      }
    });
  };
  // Travel that runs over rows already sewn stays visible on top; prefer section orders whose
  // connecting travel crosses unsewn areas (it is then covered by later rows).
  const toRot = invert(layer.toDoc);
  const sewn: number[] = [];
  const overSewn = (x: number, y: number) => {
    const [rx, ry] = apply(toRot, [x, y]);
    const half = layer.spacing / 2;
    for (const si of sewn) {
      const rows = layer.sections[si].rows;
      if (!rows.length || ry < rows[0].y - half || ry > rows[rows.length - 1].y + half) continue;
      let lo = 0,
        hi = rows.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (rows[mid].y < ry - half) lo = mid + 1;
        else hi = mid;
      }
      for (let k = lo; k < rows.length && rows[k].y <= ry + half; k++)
        if (rx >= rows[k].x0 && rx <= rows[k].x1) return true;
    }
    return false;
  };
  const visibleFraction = (a: Vec2, p: Vec2) => {
    let hits = 0;
    for (let s = 1; s <= 7; s++) {
      const u = s / 8;
      if (overSewn(a[0] + (p[0] - a[0]) * u, a[1] + (p[1] - a[1]) * u)) hits++;
    }
    return hits / 7;
  };
  while (remaining > 0) {
    const cur = b.last() ?? start;
    let bi = -1,
      bc = 0;
    if (!cur) {
      bi = done.findIndex((x) => !x);
    } else {
      // Nearest few candidates by distance, then re-ranked by how much of their travel would show.
      const cands: { i: number; c: number; d: number; p: Vec2 }[] = [];
      for (let i = 0; i < n; i++) {
        if (done[i]) continue;
        for (let c = 0; c < 4; c++) {
          const p = sectionCorner(layer, layer.sections[i], c);
          cands.push({ i, c, d: Math.hypot(p[0] - cur[0], p[1] - cur[1]), p });
        }
      }
      cands.sort((x, y) => x.d - y.d);
      let best = Infinity;
      for (const k of cands.slice(0, 8)) {
        const cost = k.d <= t.travelLen || !sewn.length ? k.d : k.d * (1 + 2 * visibleFraction(cur, k.p));
        if (cost < best) {
          best = cost;
          bi = k.i;
          bc = k.c;
        }
      }
    }
    done[bi] = 1;
    remaining--;
    sew(bi, bc);
    sewn.push(bi);
  }
  if (last >= 0 && exit) {
    // Choose the start corner whose exit corner is nearest the requested exit.
    const s = layer.sections[last];
    const cur = b.last() ?? start;
    let bc = 0,
      bd = Infinity;
    for (let c = 0; c < 4; c++) {
      const e = sectionCorner(layer, s, exitCorner(s, c));
      const p = sectionCorner(layer, s, c);
      const d =
        Math.hypot(e[0] - exit[0], e[1] - exit[1]) +
        (cur ? 0.3 * Math.hypot(p[0] - cur[0], p[1] - cur[1]) : 0);
      if (d < bd) {
        bd = d;
        bc = c;
      }
    }
    sew(last, bc);
  }
}

export interface TatamiPrep {
  top: FillLayer;
  underlayLayer: FillLayer | null;
  edgeRings: Float64Array[];
  travelArea: PolyShape;
  router: InsideRouter | null;
  travelLen: number;
  underlayStitchLength: number;
  minEnd: number;
  empty: boolean;
}

export const tatamiParams: ParamDef[] = [
  {
    key: 'angle',
    label: 'Angle',
    help: 'Direction of the fill rows, counter-clockwise from horizontal.',
    kind: 'angle',
    unit: '°',
    min: 0,
    max: 180,
    step: 1,
    group: 'basic',
  },
  {
    key: 'density',
    label: 'Density',
    help: 'Spacing between rows. Smaller is denser.',
    kind: 'length',
    unit: 'mm',
    min: 0.2,
    max: 2,
    step: 0.01,
    group: 'basic',
  },
  {
    key: 'stitchLength',
    label: 'Stitch length',
    help: 'Maximum stitch length within a row.',
    kind: 'length',
    unit: 'mm',
    min: 1,
    max: 7,
    step: 0.1,
    group: 'basic',
  },
  {
    key: 'offset',
    label: 'Stitch offset',
    help: 'Fraction of the stitch length each row shifts. 0.25 repeats every 4 rows; 0.5 gives a brick pattern.',
    kind: 'fraction',
    min: 0,
    max: 1,
    step: 0.05,
    group: 'basic',
  },
  {
    key: 'pullComp',
    label: 'Pull compensation',
    help: 'Expands the shape outward, because stitches pull the fabric inwards.',
    kind: 'length',
    unit: 'mm',
    min: 0,
    max: 1,
    step: 0.05,
    group: 'compensation',
  },
  {
    key: 'underlay',
    label: 'Underlay',
    help: 'Sparse stitches sewn first to stabilise the fabric and lift the top stitches.',
    kind: 'enum',
    options: FILL_UNDERLAY_OPTIONS,
    group: 'underlay',
  },
  {
    key: 'underlayAngle',
    label: 'Underlay angle',
    help: 'Auto = fill angle + 90°.',
    kind: 'angle',
    unit: '°',
    min: 0,
    max: 180,
    step: 1,
    allowAuto: true,
    group: 'underlay',
    visibleIf: (p) => p.underlay === 'tatami' || p.underlay === 'edgeTatami',
  },
  {
    key: 'underlaySpacing',
    label: 'Underlay spacing',
    kind: 'length',
    unit: 'mm',
    min: 1,
    max: 6,
    step: 0.1,
    group: 'underlay',
    visibleIf: (p) => p.underlay === 'tatami' || p.underlay === 'edgeTatami',
  },
  {
    key: 'underlayStitchLength',
    label: 'Underlay stitch length',
    kind: 'length',
    unit: 'mm',
    min: 1,
    max: 6,
    step: 0.1,
    group: 'underlay',
    visibleIf: (p) => p.underlay !== 'none',
  },
  {
    key: 'underlayInset',
    label: 'Underlay inset',
    help: 'Keeps underlay from peeking out at the edges.',
    kind: 'length',
    unit: 'mm',
    min: 0,
    max: 2,
    step: 0.05,
    group: 'underlay',
    visibleIf: (p) => p.underlay !== 'none',
  },
  {
    key: 'travelStitchLength',
    label: 'Travel stitch length',
    help: 'Stitch length for hidden runs between fill sections.',
    kind: 'length',
    unit: 'mm',
    min: 1,
    max: 5,
    step: 0.1,
    group: 'advanced',
  },
  {
    key: 'cutoutGrowth',
    label: 'Cutout overlap',
    help: 'Grows this region under neighbours sewn later so no fabric shows at seams (set by the image digitizer).',
    kind: 'length',
    unit: 'mm',
    min: 0,
    max: 2,
    step: 0.05,
    group: 'compensation',
  },
];

export const tatamiDefaults: Params = {
  angle: 45,
  density: 0.4,
  stitchLength: 3.5,
  offset: 0.25,
  pullComp: 0.2,
  underlay: 'tatami',
  underlayAngle: 'auto',
  underlaySpacing: 3.0,
  underlayStitchLength: 3.0,
  underlayInset: 0.5,
  travelStitchLength: 2.0,
  cutoutGrowth: 0,
};

export function makeRouter(area: PolyShape): InsideRouter | null {
  if (!area.length) return null;
  const r = new InsideRouter(area, 0.3);
  return r;
}

/** Builds the top layer of a tatami-like fill from the pull-compensated polygon. */
export type TopLayerBuilder = (
  topPoly: PolyShape,
  params: Params,
  base: { angle: number; density: number; stitchLength: number },
) => FillLayer;

const defaultTop: TopLayerBuilder = (poly, params, b) =>
  buildLayer(poly, b.angle, b.density, b.stitchLength, num(params, 'offset', 0.25));

/**
 * Tatami preparation (underlay, travel area, router) with a pluggable top layer, shared by
 * gradient and pattern fills.
 */
export function prepareTatamiLike(
  geom: PathGeom,
  params: Params,
  ctx: EngineCtx,
  buildTop: TopLayerBuilder = defaultTop,
): TatamiPrep {
  const base = fillPolygon(geom, params, ctx);
  const angle = num(params, 'angle', 45);
  const density = Math.max(0.1, num(params, 'density', 0.4));
  const L = Math.max(0.5, num(params, 'stitchLength', 3.5));
  const minEnd = Math.max(0.3, ctx.settings.minStitchLength);
  const topPoly = offset(base, num(params, 'pullComp', 0.2));
  const top = buildTop(topPoly, params, { angle, density, stitchLength: L });
  const underlay = str(params, 'underlay', 'tatami');
  const inset = num(params, 'underlayInset', 0.5);
  const uPoly = underlay === 'none' ? [] : offset(base, -inset);
  let underlayLayer: FillLayer | null = null;
  const ua = params.underlayAngle;
  if ((underlay === 'tatami' || underlay === 'edgeTatami') && uPoly.length) {
    const uAngle = typeof ua === 'number' ? ua : angle + 90;
    underlayLayer = buildLayer(
      uPoly,
      uAngle,
      Math.max(0.5, num(params, 'underlaySpacing', 3)),
      Math.max(1, num(params, 'underlayStitchLength', 3)),
      0.5,
    );
  }
  const edgeRings: Float64Array[] = [];
  if ((underlay === 'edge' || underlay === 'edgeTatami') && uPoly.length) {
    for (const p of uPoly) {
      edgeRings.push(p.outer);
      for (const h of p.holes) edgeRings.push(h);
    }
  }
  let travelArea = offset(base, -0.25);
  if (!travelArea.length) travelArea = base;
  const area = polyShapeArea(base);
  if (area > 0 && area < 1) ctx.diag('tiny-fill', `Very small fill (${area.toFixed(2)} mm²).`);
  return {
    top,
    underlayLayer,
    edgeRings,
    travelArea,
    router: makeRouter(travelArea),
    travelLen: Math.max(0.5, num(params, 'travelStitchLength', 2)),
    underlayStitchLength: Math.max(1, num(params, 'underlayStitchLength', 3)),
    minEnd,
    empty: top.sections.length === 0,
  };
}

/** Tatami routing: edge run, underlay layer, top layer, inside travel between sections. */
export function routeTatami(prep: TatamiPrep, hints: Hints): StitchRun {
  const b = new RunBuilder();
  if (prep.empty) return b.build();
  const t: TravelCtx = { router: prep.router, travelLen: prep.travelLen };
  const entry = hints.entry;
  for (const ring of prep.edgeRings) {
    const closed = new Float64Array(ring.length + 2);
    closed.set(ring);
    closed[ring.length] = ring[0];
    closed[ring.length + 1] = ring[1];
    const cur = b.last() ?? entry;
    const rot = cur ? rotateClosedTo(closed, cur[0], cur[1]) : closed;
    const pts = runningPoints(rot, prep.underlayStitchLength);
    travelTo(b, [pts[0], pts[1]], t, F.UNDERLAY);
    b.pushPolyline(pts, F.UNDERLAY, true);
  }
  if (prep.underlayLayer) sewLayer(b, prep.underlayLayer, t, prep.minEnd, F.UNDERLAY, entry);
  sewLayer(b, prep.top, t, prep.minEnd, 0, b.last() ?? entry, hints.userExit ? hints.exit : undefined);
  if (hints.userExit && hints.exit) {
    const ex = hints.exit;
    const r = prep.router;
    if (r && r.isInside(ex[0], ex[1])) travelTo(b, ex, t);
  }
  return b.build();
}

export const tatamiDef: StitchTypeDef<TatamiPrep> = {
  id: 'tatami',
  label: 'Tatami',
  description: 'Rows of running stitches covering an area. The standard fill.',
  role: 'fill',
  params: tatamiParams,
  defaults: tatamiDefaults,
  appliesTo: (s) => s.hasClosed,
  prepare(geom, params, _el, ctx) {
    return prepareTatamiLike(geom, params, ctx);
  },
  route: routeTatami,
};
