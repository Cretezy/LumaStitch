// SPDX-License-Identifier: GPL-3.0-or-later
/** Tatami fill: rows of running stitches with underlay and inside travel between sections. */
import { flattenGeom } from '@/geom/flatten';
import { intersection, makeValid, offset, union } from '@/geom/clipper';
import { createPointTester, polyShapeArea, polyShapeBBox } from '@/geom/polygon';
import { rotateClosedTo } from '@/geom/polyline';
import type { PolyShape } from '@/geom/types';
import { InsideRouter } from '@/geom/visibility';
import { apply, invert } from '@/geom/matrix';
import type { PathGeom, Vec2 } from '@/model/types';
import type { EngineCtx, Hints, StitchTypeDef } from '../../def';
import { num, str, type ParamDef, type Params } from '../../params/types';
import { F, type StitchRun } from '../../types';
import { RunBuilder, runningPoints } from '../common';
import {
  buildLayer,
  exitCorner,
  sectionCorner,
  sewSection,
  toDocPoint,
  type FillLayer,
  type Section,
} from './layer';

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

/** Extra cost (mm of travel) of a trim + jump inside a fill: a cut by hand on many machines. */
const JUMP_COST = 10;
/**
 * Cost of choosing a trim + jump over travel that would show on top (plus the jump's length): a
 * cut is better than a permanent line across the fill, but not worth it for a small blip.
 */
const JUMP_OPTION_COST = 20;
/** Length (mm) of a jump's end that may lie over the section it lands on. */
const JUMP_LANDING = 1.5;

function polyLength(p: Float64Array): number {
  let l = 0;
  for (let i = 2; i < p.length; i += 2) l += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
  return l;
}

/**
 * `coveredBy` sampled about every millimetre along a polyline (leaving out its ends), as the
 * distinct section masks seen and how many samples saw each.
 */
function coveredAlong(
  path: Float64Array,
  coveredBy: (x: number, y: number) => number,
): { masks: number[]; counts: number[]; n: number } {
  const seen = new Map<number, number>();
  const total = polyLength(path);
  const ns = Math.max(3, Math.ceil(total));
  let seg = 2,
    acc = 0;
  for (let q = 1; q < ns; q++) {
    const target = (total * q) / ns;
    while (seg < path.length - 2) {
      const l = Math.hypot(path[seg] - path[seg - 2], path[seg + 1] - path[seg - 1]);
      if (acc + l >= target) break;
      acc += l;
      seg += 2;
    }
    const l = Math.hypot(path[seg] - path[seg - 2], path[seg + 1] - path[seg - 1]) || 1;
    const u = Math.min(1, Math.max(0, (target - acc) / l));
    const bits = coveredBy(
      path[seg - 2] + (path[seg] - path[seg - 2]) * u,
      path[seg - 1] + (path[seg + 1] - path[seg - 1]) * u,
    );
    if (bits) seen.set(bits, (seen.get(bits) ?? 0) + 1);
  }
  return { masks: [...seen.keys()], counts: [...seen.values()], n: ns - 1 };
}

/**
 * Extra cost (mm) of travel that runs over rows already sewn: a line left on top of the fill is a
 * visible defect, while hidden travel only costs a few stitches.
 */
const VISIBLE_COST = 8;
/** Weight of the distance from the last section's exit to the requested exit point. */
const EXIT_WEIGHT = 0.3;
/** Each mm of visible travel also costs this many mm. */
const VISIBLE_FACTOR = 4;

/** Travel this close (mm) to sewn rows counts as running over them. */
const VISIBLE_MARGIN = 0.6;

/** Section counts up to this are ordered exactly (bitmask DP); larger layers greedily. */
const EXACT_SECTIONS = 10;
/** Larger layers up to this many sections use a beam search with the same costs; beyond, greedy. */
const BEAM_SECTIONS = 30;
const BEAM_WIDTH = 64;
const BEAM_NEAR = 8;

/**
 * Cost model for ordering a layer's sections: start and exit corners, the travel each hop will
 * really sew (mirroring travelTo: direct when short and clear, else the router's path, else trim +
 * jump), and which sections that travel crosses (over a section already sewn it stays visible on
 * top; over one sewn later it is hidden). Hops are computed lazily and memoised.
 */
function sectionCostModel(layer: FillLayer, idx: number[], t: TravelCtx) {
  const m = idx.length;
  const W = m * 4;
  const corner = (k: number, c: number) => sectionCorner(layer, layer.sections[idx[k]], c);
  const exitOf = (k: number, c: number) => exitCorner(layer.sections[idx[k]], c);
  const travel = (a: Vec2, b: Vec2): Float64Array | null => {
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (d < 1e-9) return Float64Array.of(a[0], a[1], b[0], b[1]);
    const r = t.router;
    if (!r) return d <= t.travelLen ? Float64Array.of(a[0], a[1], b[0], b[1]) : null;
    const sa = r.snapInside(a[0], a[1]),
      sb = r.snapInside(b[0], b[1]);
    if (!sa || !sb) return null;
    if (d <= t.travelLen && r.clear(sa[0], sa[1], sb[0], sb[1]))
      return Float64Array.of(a[0], a[1], b[0], b[1]);
    const path = r.path(sa[0], sa[1], sb[0], sb[1]);
    if (!path) return null;
    const full = Float64Array.from([a[0], a[1], ...path, b[0], b[1]]);
    return polyLength(full) <= 3 * d + 1 ? full : null;
  };
  // Bitmask of the sections whose rows cover (x, y), or come within VISIBLE_MARGIN of it (travel
  // along the edge of sewn rows runs over their ends and shows just the same).
  const toRot = invert(layer.toDoc);
  const half = layer.spacing / 2 + VISIBLE_MARGIN;
  const coveredBy = (x: number, y: number) => {
    const [rx, ry] = apply(toRot, [x, y]);
    let bits = 0;
    for (let k = 0; k < m; k++) {
      const rows = layer.sections[idx[k]].rows;
      if (!rows.length || ry < rows[0].y - half || ry > rows[rows.length - 1].y + half) continue;
      for (const r of rows)
        if (Math.abs(r.y - ry) <= half && rx >= r.x0 - VISIBLE_MARGIN && rx <= r.x1 + VISIBLE_MARGIN) {
          bits |= 1 << k;
          break;
        }
    }
    return bits;
  };
  type Coverage = { masks: number[]; counts: number[]; n: number };
  const H = new Float64Array(W * W).fill(NaN);
  const X = new Int32Array(W * W);
  const XC: (Coverage | undefined)[] = new Array(W * W);
  // The alternative to visible travel: trim and jump straight there. JX: sections the jump line
  // crosses (a jump over a section sewn later would be locked in by it, so that is not allowed).
  const JD = new Float64Array(W * W);
  const JX = new Int32Array(W * W);
  /** Part of a path's length that runs over sections in `mask`. */
  const visibleLen = (len: number, cv: Coverage | undefined, mask: number) => {
    if (!cv) return 0;
    let vis = 0;
    for (let q = 0; q < cv.masks.length; q++) if (cv.masks[q] & mask) vis += cv.counts[q];
    return (len * vis) / cv.n;
  };
  const fill = (k: number, c: number, j: number, cj: number) => {
    const at = (k * 4 + c) * W + j * 4 + cj;
    const e = corner(k, exitOf(k, c)),
      p = corner(j, cj);
    const d = Math.hypot(p[0] - e[0], p[1] - e[1]);
    H[at] = 0;
    if (d < 1e-9) return at;
    const path = travel(e, p);
    if (!path) {
      H[at] = d * 3 + JUMP_COST;
      return at;
    }
    const len = polyLength(path);
    H[at] = len;
    if (len > layer.spacing * 2) {
      const cv = coveredAlong(path, coveredBy);
      for (const mk of cv.masks) X[at] |= mk;
      if (X[at]) XC[at] = cv;
      JD[at] = d;
      // The jump lands on section j, so j may cover its last stretch, but not more: a jump that
      // runs along j (say up a letter's stem to its far corner) is sewn over when j is.
      const jc = coveredAlong(Float64Array.of(e[0], e[1], p[0], p[1]), coveredBy);
      let onJ = 0;
      jc.masks.forEach((mk, q) => {
        JX[at] |= mk & ~(1 << j);
        if (mk & (1 << j)) onJ += jc.counts[q];
      });
      if ((d * onJ) / (jc.n + 1) > JUMP_LANDING) JX[at] |= 1 << j;
    }
    return at;
  };
  const at = (k: number, c: number, j: number, cj: number) => {
    const i = (k * 4 + c) * W + j * 4 + cj;
    return Number.isNaN(H[i]) ? fill(k, c, j, cj) : i;
  };
  const insideCost = (i: number, mask: number) => {
    const h = H[i];
    if (!(X[i] & mask)) return h;
    // Travel over rows already sewn stays on top: charge it, plus a fixed cost per hop.
    return h + visibleLen(h, XC[i], mask) * VISIBLE_FACTOR + VISIBLE_COST;
  };
  const jumpCost = (i: number, mask: number) =>
    // Only where travel would show, and only if no section sewn later covers the jump thread.
    X[i] & mask && JD[i] > 0 && !(JX[i] & ~mask) ? JD[i] + JUMP_OPTION_COST : Infinity;
  return {
    m,
    corner,
    exitOf,
    /** Cost of the hop from the exit of (k, c) to the start of (j, cj), given the sections sewn. */
    hop(k: number, c: number, j: number, cj: number, mask: number): number {
      const i = at(k, c, j, cj);
      return Math.min(insideCost(i, mask), jumpCost(i, mask));
    },
    /** True when that hop is better done as a trim and jump than as (visible) travel. */
    jump(k: number, c: number, j: number, cj: number, mask: number): boolean {
      const i = at(k, c, j, cj);
      return jumpCost(i, mask) < insideCost(i, mask);
    },
    start(from: Vec2 | undefined, k: number, c: number): number {
      if (!from) return 0;
      const p = corner(k, c);
      const path = travel(from, p);
      return path ? polyLength(path) : Math.hypot(p[0] - from[0], p[1] - from[1]) * 3 + JUMP_COST;
    },
    /** Finishing near the exit only shortens the next jump; it weighs less than travel. */
    end(exit: Vec2 | undefined, k: number, c: number): number {
      if (!exit) return 0;
      const e = corner(k, exitOf(k, c));
      return EXIT_WEIGHT * Math.hypot(e[0] - exit[0], e[1] - exit[1]);
    },
  };
}

type SectionCostModel = ReturnType<typeof sectionCostModel>;

/**
 * Order and start corner of each section minimising the model's cost exactly: a bitmask DP over
 * (sections sewn, last section, its start corner). For up to EXACT_SECTIONS sections.
 */
function exactSectionOrder(
  M: SectionCostModel,
  from: Vec2 | undefined,
  exit: Vec2 | undefined,
): [number, number][] {
  const m = M.m;
  const S = 1 << m;
  const W = m * 4;
  const cost = new Float64Array(S * W).fill(Infinity);
  const prev = new Int32Array(S * W).fill(-1);
  for (let k = 0; k < m; k++)
    for (let c = 0; c < 4; c++) cost[(1 << k) * W + k * 4 + c] = M.start(from, k, c);
  for (let mask = 1; mask < S; mask++)
    for (let k = 0; k < m; k++) {
      if (!(mask & (1 << k))) continue;
      for (let c = 0; c < 4; c++) {
        const cur = cost[mask * W + k * 4 + c];
        if (cur === Infinity) continue;
        for (let j = 0; j < m; j++) {
          if (mask & (1 << j)) continue;
          const nm = mask | (1 << j);
          for (let cj = 0; cj < 4; cj++) {
            const v = cur + M.hop(k, c, j, cj, mask);
            const at = nm * W + j * 4 + cj;
            if (v < cost[at]) {
              cost[at] = v;
              prev[at] = mask * W + k * 4 + c;
            }
          }
        }
      }
    }
  const full = S - 1;
  let best = -1,
    bc = Infinity;
  for (let k = 0; k < m; k++)
    for (let c = 0; c < 4; c++) {
      const at = full * W + k * 4 + c;
      if (cost[at] === Infinity) continue;
      const v = cost[at] + M.end(exit, k, c);
      if (v < bc) {
        bc = v;
        best = at;
      }
    }
  const out: [number, number][] = [];
  for (let at = best; at >= 0; at = prev[at]) {
    const r = at % W;
    out.push([Math.floor(r / 4), r % 4]);
  }
  return out.reverse();
}

/**
 * Beam search with the same cost model, for layers with more sections than the exact DP can take
 * (up to BEAM_SECTIONS): the best BEAM_WIDTH partial orders survive each step, each extended to
 * the BEAM_NEAR nearest unsewn sections.
 */
function beamSectionOrder(
  M: SectionCostModel,
  from: Vec2 | undefined,
  exit: Vec2 | undefined,
): [number, number][] {
  const m = M.m;
  interface State {
    mask: number;
    k: number;
    c: number;
    cost: number;
    parent: State | null;
  }
  // Straight distance from the exit of (k, c) to the nearest corner of section j.
  const near = (k: number, c: number, j: number) => {
    const e = M.corner(k, M.exitOf(k, c));
    let d = Infinity;
    for (let cj = 0; cj < 4; cj++) {
      const p = M.corner(j, cj);
      d = Math.min(d, Math.hypot(p[0] - e[0], p[1] - e[1]));
    }
    return d;
  };
  let beam: State[] = [];
  for (let k = 0; k < m; k++)
    for (let c = 0; c < 4; c++) beam.push({ mask: 1 << k, k, c, cost: M.start(from, k, c), parent: null });
  beam.sort((a, b) => a.cost - b.cost);
  beam = beam.slice(0, BEAM_WIDTH);
  for (let step = 1; step < m; step++) {
    const next = new Map<string, State>();
    for (const s of beam) {
      const cand: number[] = [];
      for (let j = 0; j < m; j++) if (!(s.mask & (1 << j))) cand.push(j);
      cand.sort((a, b) => near(s.k, s.c, a) - near(s.k, s.c, b));
      for (const j of cand.slice(0, BEAM_NEAR))
        for (let cj = 0; cj < 4; cj++) {
          const st: State = {
            mask: s.mask | (1 << j),
            k: j,
            c: cj,
            cost: s.cost + M.hop(s.k, s.c, j, cj, s.mask),
            parent: s,
          };
          const key = `${st.mask}:${j}:${cj}`;
          const old = next.get(key);
          if (!old || st.cost < old.cost) next.set(key, st);
        }
    }
    beam = [...next.values()].sort((a, b) => a.cost - b.cost).slice(0, BEAM_WIDTH);
  }
  let best = beam[0],
    bc = Infinity;
  for (const s of beam) {
    const v = s.cost + M.end(exit, s.k, s.c);
    if (v < bc) {
      bc = v;
      best = s;
    }
  }
  const out: [number, number][] = [];
  for (let s: State | null = best; s; s = s.parent) out.push([s.k, s.c]);
  return out.reverse();
}

const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];

/** Sews a fill layer: greedy nearest section corner, inside travel between sections. */
export function sewLayer(
  b: RunBuilder,
  layer: FillLayer,
  t: TravelCtx,
  minEnd: number,
  flag: number,
  start?: Vec2,
  exit?: Vec2,
  /** Only sew the sections for which this returns true (one part of a multi-part fill). */
  only?: (i: number) => boolean,
): void {
  const n = layer.sections.length;
  if (!n) return;
  const done = new Uint8Array(n);
  let todo = n;
  if (only)
    for (let i = 0; i < n; i++)
      if (!only(i)) {
        done[i] = 1;
        todo--;
      }
  if (!todo) return;
  const allowed: number[] = [];
  for (let i = 0; i < n; i++) if (!done[i]) allowed.push(i);
  let last = -1;
  if (exit) {
    // Reserve the section nearest the exit for last.
    let bd = Infinity;
    for (let i = 0; i < n; i++)
      for (let c = 0; c < 4; c++) {
        if (done[i]) break;
        const p = sectionCorner(layer, layer.sections[i], c);
        const d = Math.hypot(p[0] - exit[0], p[1] - exit[1]);
        if (d < bd) {
          bd = d;
          last = i;
        }
      }
    if (todo > 1) done[last] = 1;
    else last = -1;
  }
  let remaining = todo - (last >= 0 ? 1 : 0);
  const sew = (i: number, c: number) => {
    const s = layer.sections[i];
    const p = sectionCorner(layer, s, c);
    travelTo(b, p, t, flag);
    const rows = sewSection(layer, s, c, minEnd);
    rows.forEach((pts, ri) => {
      if (ri > 0) {
        // The turn to the next row normally follows the outline; if it would cut across a hole or
        // notch (rows far apart at a corner), travel inside instead.
        // If the straight turn would leave the layer (a concave edge, a notch), follow the
        // outline between the two row ends instead; the router is the fallback for long detours.
        const cur = b.last()!;
        const near = layer.near ?? layer.inside;
        let ok = true;
        for (const u of [0.25, 0.5, 0.75])
          if (!near(cur[0] + (pts[0] - cur[0]) * u, cur[1] + (pts[1] - cur[1]) * u)) ok = false;
        if (!ok) {
          const d = Math.hypot(pts[0] - cur[0], pts[1] - cur[1]);
          const walk = safeOutlineWalk(layer, cur, [pts[0], pts[1]], 2 * d + 1, minEnd);
          if (walk)
            for (let k = 2; k < walk.length - 2; k += 2) b.push(walk[k], walk[k + 1], F.TRAVEL | flag);
          else travelTo(b, [pts[0], pts[1]], t, flag);
        }
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
    const half = layer.spacing / 2 + VISIBLE_MARGIN;
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
        if (rx >= rows[k].x0 - VISIBLE_MARGIN && rx <= rows[k].x1 + VISIBLE_MARGIN) return true;
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
  // Up to BEAM_SECTIONS sections (a letter, a simple shape): choose the order and start corners by
  // the full travel cost (exactly for few sections, by beam search for more), so the fill flows
  // through the shape instead of hopping between its ends or leaving travel on top.
  if (allowed.length <= BEAM_SECTIONS) {
    const model = sectionCostModel(layer, allowed, t);
    const from = b.last() ?? start;
    const order =
      allowed.length <= EXACT_SECTIONS
        ? exactSectionOrder(model, from, exit)
        : beamSectionOrder(model, from, exit);
    let mask = 0,
      pk = -1,
      pc = 0;
    for (const [k, c] of order) {
      if (pk >= 0 && model.jump(pk, pc, k, c, mask)) {
        const p = model.corner(k, c);
        b.jumpTo(p[0], p[1], F.TRIM | flag);
      }
      sew(allowed[k], c);
      mask |= 1 << k;
      pk = k;
      pc = c;
    }
    return;
  }
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

/** One connected part of a fill (e.g. one letter of a word set as a single shape). */
export interface FillPart {
  /** Outer ring of the part (doc mm), for choosing the order of parts. */
  outer: Float64Array;
  /** Point-in-part test. */
  inside: (x: number, y: number) => boolean;
  /** Inside router for this part only (travel never leaves a part; smaller graphs are faster). */
  router: InsideRouter | null;
}

export interface TatamiPrep {
  top: FillLayer;
  underlayLayer: FillLayer | null;
  edgeRings: Float64Array[];
  /** Connected parts; each is sewn completely (edge run, underlay, top) before the next. */
  parts: FillPart[];
  /** Part index of each top section, underlay section and edge ring. */
  topPart: Int32Array;
  underlayPart: Int32Array;
  edgePart: Int32Array;
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
  const partOf = partLocator(base);
  const partTravel: PolyShape[] = base.map(() => []);
  for (const p of travelArea) partTravel[partOf(p.outer[0], p.outer[1])].push(p);
  const parts: FillPart[] = base.map((p, i) => ({
    outer: p.outer,
    inside: createPointTester([p]),
    router: base.length > 1 ? makeRouter(partTravel[i]) : null,
  }));
  const topSplit = splitByPart(splitAtTurns(top), partOf);
  const underlaySplit = underlayLayer ? splitByPart(splitAtTurns(underlayLayer), partOf) : null;
  const area = polyShapeArea(base);
  if (area > 0 && area < 1) ctx.diag('tiny-fill', `Very small fill (${area.toFixed(2)} mm²).`);
  return {
    top: topSplit.layer,
    underlayLayer: underlaySplit?.layer ?? null,
    edgeRings,
    parts,
    topPart: topSplit.part,
    underlayPart: underlaySplit ? underlaySplit.part : new Int32Array(0),
    edgePart: Int32Array.from(edgeRings, (r) => partOf(r[0], r[1])),
    travelArea,
    router: makeRouter(travelArea),
    travelLen: Math.max(0.5, num(params, 'travelStitchLength', 2)),
    underlayStitchLength: Math.max(1, num(params, 'underlayStitchLength', 3)),
    minEnd,
    empty: top.sections.length === 0,
  };
}

/**
 * Returns a function giving the index of the polygon of `ps` that contains (x, y), or the nearest
 * one (points just outside, e.g. on pull-compensated rows, belong to the closest part).
 */
function partLocator(ps: PolyShape): (x: number, y: number) => number {
  if (ps.length <= 1) return () => 0;
  const testers = ps.map((p) => createPointTester([p]));
  const boxes = ps.map((p) => polyShapeBBox([p]));
  return (x, y) => {
    for (let i = 0; i < ps.length; i++) {
      const b = boxes[i];
      if (x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY && testers[i](x, y)) return i;
    }
    let best = 0,
      bd = Infinity;
    for (let i = 0; i < ps.length; i++) {
      const d = ringDistance(ps[i].outer, [x, y]);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  };
}

/**
 * outlineWalk on the layer's polygon, made safe to sew: points the minimum stitch length would
 * merge anyway are dropped first (post-processing would otherwise cut the corner they mark), and
 * every leg must stay within the layer's loose tolerance. Null if there is no such walk.
 */
function safeOutlineWalk(
  layer: FillLayer,
  a: Vec2,
  b: Vec2,
  maxLen: number,
  minEnd: number,
): Float64Array | null {
  if (!layer.poly) return null;
  const walk = outlineWalk(layer.poly, a, b, maxLen);
  if (!walk) return null;
  const kept = [walk[0], walk[1]];
  for (let k = 2; k < walk.length; k += 2) {
    const last = k === walk.length - 2;
    const far = Math.hypot(walk[k] - kept[kept.length - 2], walk[k + 1] - kept[kept.length - 1]) >= minEnd;
    if (far || last) kept.push(walk[k], walk[k + 1]);
  }
  const near = layer.near ?? layer.inside;
  for (let k = 2; k < kept.length; k += 2)
    for (const u of [0.25, 0.5, 0.75])
      if (!near(kept[k - 2] + (kept[k] - kept[k - 2]) * u, kept[k - 1] + (kept[k + 1] - kept[k - 1]) * u))
        return null;
  return Float64Array.from(kept);
}

/**
 * The path from a to b along the nearest ring of `ps` (both ends within 0.3 mm of it), as a
 * polyline from a to b, or null if there is no such ring or the walk is longer than maxLen.
 */
function outlineWalk(ps: PolyShape, a: Vec2, b: Vec2, maxLen: number): Float64Array | null {
  const proj = (r: Float64Array, p: Vec2) => {
    let best = { seg: 0, t: 0, d: Infinity, x: 0, y: 0 };
    const n = r.length;
    for (let i = 0; i < n; i += 2) {
      const j = (i + 2) % n;
      const ex = r[j] - r[i],
        ey = r[j + 1] - r[i + 1];
      const l2 = ex * ex + ey * ey;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - r[i]) * ex + (p[1] - r[i + 1]) * ey) / l2)) : 0;
      const x = r[i] + ex * t,
        y = r[i + 1] + ey * t;
      const d = Math.hypot(x - p[0], y - p[1]);
      if (d < best.d) best = { seg: i / 2, t, d, x, y };
    }
    return best;
  };
  let bestRing: Float64Array | null = null;
  let pa = proj(new Float64Array(0), a),
    pb = pa,
    bd = Infinity;
  for (const p of ps)
    for (const r of [p.outer, ...p.holes]) {
      if (r.length < 6) continue;
      const qa = proj(r, a),
        qb = proj(r, b);
      if (qa.d > 0.3 || qb.d > 0.3 || qa.d + qb.d >= bd) continue;
      bd = qa.d + qb.d;
      bestRing = r;
      pa = qa;
      pb = qb;
    }
  if (!bestRing) return null;
  const r = bestRing,
    n = r.length / 2;
  // Walk forward (increasing segment index) and backward; keep the shorter.
  const walk = (dir: 1 | -1) => {
    const out = [a[0], a[1], pa.x, pa.y];
    let len = Math.hypot(pa.x - a[0], pa.y - a[1]);
    let x = pa.x,
      y = pa.y;
    if (pa.seg === pb.seg && (dir > 0 ? pb.t >= pa.t : pb.t <= pa.t)) {
      // Same segment, already in the right direction.
    } else {
      let v = dir > 0 ? (pa.seg + 1) % n : pa.seg;
      for (let steps = 0; steps <= n; steps++) {
        const vx = r[v * 2],
          vy = r[v * 2 + 1];
        len += Math.hypot(vx - x, vy - y);
        out.push(vx, vy);
        x = vx;
        y = vy;
        if (len > maxLen) return null;
        // Stop at the vertex that starts (forward) or ends (backward) b's segment.
        if (dir > 0 ? v === pb.seg : v === (pb.seg + 1) % n) break;
        v = dir > 0 ? (v + 1) % n : (v - 1 + n) % n;
      }
    }
    len += Math.hypot(pb.x - x, pb.y - y) + Math.hypot(b[0] - pb.x, b[1] - pb.y);
    if (len > maxLen) return null;
    out.push(pb.x, pb.y, b[0], b[1]);
    return { pts: out, len };
  };
  const f = walk(1),
    w = walk(-1);
  const pick = f && w ? (f.len <= w.len ? f : w) : (f ?? w);
  return pick ? Float64Array.from(pick.pts) : null;
}

/** Row-to-row turns up to this length (mm) are sewn directly, along the outline. */
const shortTurn = (layer: FillLayer) => Math.max(1, 2.5 * layer.spacing);

/**
 * Splits sections where a long row-to-row turn doesn't follow the outline: where it would leave
 * the fill (a step in the outline, e.g. a bar meeting a narrower ear above it), or cut across it
 * (a stem meeting a wider bar: the turn would be a diagonal stitch across the bar instead of the
 * bar's own horizontal rows). A turn follows the outline when the outline between the two row
 * ends bulges less than half a row spacing from it: slanted and curved edges (the caps of a
 * circle) stay one section, steps don't. Separate sections let the order choose a clean entry.
 */
function splitAtTurns(layer: FillLayer): FillLayer {
  const limit = shortTurn(layer);
  const ok = (x0: number, y0: number, x1: number, y1: number) => {
    if (Math.abs(x1 - x0) <= limit) return true;
    const a = toDocPoint(layer, x0, y0),
      b = toDocPoint(layer, x1, y1);
    for (const u of [0.25, 0.5, 0.75])
      if (!layer.inside(a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u)) return false;
    if (!layer.poly) return true;
    const ex = b[0] - a[0],
      ey = b[1] - a[1];
    const len = Math.hypot(ex, ey);
    const walk = outlineWalk(layer.poly, a, b, 2 * len + 1);
    if (!walk) return false;
    for (let k = 2; k < walk.length - 2; k += 2)
      if (Math.abs((walk[k] - a[0]) * ey - (walk[k + 1] - a[1]) * ex) / len > layer.spacing / 2) return false;
    return true;
  };
  const sections: Section[] = [];
  for (const s of layer.sections) {
    let cur: Section = { rows: [s.rows[0]] };
    sections.push(cur);
    for (let i = 1; i < s.rows.length; i++) {
      const p = s.rows[i - 1],
        r = s.rows[i];
      if (!ok(p.x0, p.y, r.x0, r.y) || !ok(p.x1, p.y, r.x1, r.y)) {
        cur = { rows: [] };
        sections.push(cur);
      }
      cur.rows.push(r);
    }
  }
  return sections.length === layer.sections.length ? layer : { ...layer, sections };
}

/**
 * Splits the sections of a layer where consecutive rows belong to different parts (rows of
 * neighbouring letters can be linked into one section when the row spacing exceeds the gap
 * between them), and returns the part index of each resulting section.
 */
function splitByPart(
  layer: FillLayer,
  partOf: (x: number, y: number) => number,
): { layer: FillLayer; part: Int32Array } {
  const sections: Section[] = [];
  const part: number[] = [];
  for (const s of layer.sections) {
    let cur: Section | null = null;
    let curPart = -1;
    for (const r of s.rows) {
      const [x, y] = toDocPoint(layer, (r.x0 + r.x1) / 2, r.y);
      const p = partOf(x, y);
      if (!cur || p !== curPart) {
        cur = { rows: [] };
        sections.push(cur);
        part.push(p);
        curPart = p;
      }
      cur.rows.push(r);
    }
  }
  return { layer: { ...layer, sections }, part: Int32Array.from(part) };
}

/** Distance from p to a closed ring (its nearest edge). */
function ringDistance(ring: Float64Array, p: Vec2): number {
  return Math.hypot(...(sub(nearestOnRing(ring, p), p) as [number, number]));
}

/** The point of a closed ring nearest to p. */
function nearestOnRing(ring: Float64Array, p: Vec2): Vec2 {
  let d = Infinity,
    bx = ring[0],
    by = ring[1];
  const n = ring.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const ax = ring[j],
      ay = ring[j + 1],
      ex = ring[i] - ax,
      ey = ring[i + 1] - ay;
    const l2 = ex * ex + ey * ey;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - ax) * ex + (p[1] - ay) * ey) / l2)) : 0;
    const x = ax + ex * t,
      y = ay + ey * t;
    const dd = Math.hypot(x - p[0], y - p[1]);
    if (dd < d) {
      d = dd;
      bx = x;
      by = y;
    }
  }
  return [bx, by];
}

/** The point of ring `to` closest to ring `from` (vertices of `to`, sampled for long rings). */
export function nearestPointTo(to: Float64Array, from: Float64Array): Vec2 {
  const step = Math.max(1, Math.floor(to.length / 2 / 200)) * 2;
  let best: Vec2 = [to[0], to[1]],
    bd = Infinity;
  for (let i = 0; i < to.length; i += step) {
    const p: Vec2 = [to[i], to[i + 1]];
    const d = ringDistance(from, p);
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  return best;
}

/** Smallest distance between two rings (vertices of each against the edges of the other). */
function ringGap(a: Float64Array, b: Float64Array): number {
  return Math.min(ringDistance(a, nearestPointTo(b, a)), ringDistance(b, nearestPointTo(a, b)));
}

/**
 * Order in which to sew the parts of a fill: the shortest open path through the parts (gap between
 * consecutive parts), starting near the entry and ending at the part nearest the exit, if any.
 * Small part counts try every start and improve with 2-opt; large ones use bounding-box gaps.
 */
export function partOrder(
  parts: { outer: Float64Array }[],
  from: Vec2 | undefined,
  exit: Vec2 | undefined,
): number[] {
  const n = parts.length;
  if (n <= 1) return n ? [0] : [];
  const exact = n <= 24;
  const boxes = parts.map((p) => polyShapeBBox([{ outer: p.outer, holes: [] }]));
  const gap = (i: number, j: number) => {
    if (exact) return ringGap(parts[i].outer, parts[j].outer);
    const a = boxes[i],
      b = boxes[j];
    return Math.hypot(
      Math.max(0, a.minX - b.maxX, b.minX - a.maxX),
      Math.max(0, a.minY - b.maxY, b.minY - a.maxY),
    );
  };
  const G = new Float64Array(n * n);
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) G[i * n + j] = G[j * n + i] = gap(i, j);
  const d0 = parts.map((p) => (from ? ringDistance(p.outer, from) : 0));
  let lastPart = -1;
  if (exit) {
    let bd = Infinity;
    for (let i = 0; i < n; i++) {
      const d = ringDistance(parts[i].outer, exit);
      if (d < bd) {
        bd = d;
        lastPart = i;
      }
    }
  }
  const cost = (o: number[]) => {
    let c = d0[o[0]];
    for (let k = 1; k < o.length; k++) c += G[o[k - 1] * n + o[k]];
    return c;
  };
  const greedy = (start: number) => {
    const o = [start];
    const used = new Uint8Array(n);
    used[start] = 1;
    if (lastPart >= 0) used[lastPart] = 1;
    for (;;) {
      const cur = o[o.length - 1];
      let pick = -1,
        bd = Infinity;
      for (let j = 0; j < n; j++)
        if (!used[j] && G[cur * n + j] < bd) {
          bd = G[cur * n + j];
          pick = j;
        }
      if (pick < 0) break;
      used[pick] = 1;
      o.push(pick);
    }
    if (lastPart >= 0 && lastPart !== start) o.push(lastPart);
    return o;
  };
  const starts = exact ? parts.map((_, i) => i).filter((i) => i !== lastPart || n === 1) : [];
  if (!exact) {
    let s0 = 0;
    for (let i = 1; i < n; i++) if (i !== lastPart && d0[i] < d0[s0]) s0 = i;
    starts.push(s0);
  }
  let best: number[] = [],
    bc = Infinity;
  for (const st of starts) {
    const o = greedy(st);
    // 2-opt on the open path; the last part stays fixed when there is an exit.
    const end = lastPart >= 0 ? o.length - 1 : o.length;
    for (let improved = true, pass = 0; improved && pass < 8; pass++) {
      improved = false;
      for (let i = 0; i < end - 1; i++)
        for (let j = i + 1; j < end; j++) {
          const c0 = cost(o);
          const r = o.slice(0, i).concat(o.slice(i, j + 1).reverse(), o.slice(j + 1));
          if (cost(r) < c0 - 1e-9) {
            o.splice(0, o.length, ...r);
            improved = true;
          }
        }
    }
    const c = cost(o);
    if (c < bc) {
      bc = c;
      best = o;
    }
  }
  return best;
}

/**
 * Tatami routing. Each connected part is finished (edge run, underlay, top layer) before moving to
 * the next, nearest first; inside travel between sections, jumps only between parts.
 */
export function routeTatami(prep: TatamiPrep, hints: Hints): StitchRun {
  const b = new RunBuilder();
  if (prep.empty) return b.build();
  const entry = hints.entry;
  const exit = hints.exit;
  const order = partOrder(prep.parts, entry, exit);
  order.forEach((part, k) => {
    const isLast = k === order.length - 1;
    const P = prep.parts[part];
    const t: TravelCtx = { router: P.router ?? prep.router, travelLen: prep.travelLen };
    // Arriving from outside the part: come in at its edge point nearest to where we are, so the
    // jump is as short as possible, then travel inside (hidden under this part's rows) from there.
    const from = b.last() ?? entry;
    if (from && t.router && !P.inside(from[0], from[1])) {
      const q = nearestOnRing(P.outer, from);
      const z = t.router.snapInside(q[0], q[1]);
      if (z && P.inside(z[0], z[1])) {
        if (b.length) b.jumpTo(z[0], z[1], F.TRIM);
        else b.push(z[0], z[1], 0);
      }
    }
    // Finish each part next to the part that follows it, so the jump between them is short.
    const partExit = isLast ? exit : nearestPointTo(prep.parts[order[k + 1]].outer, prep.parts[part].outer);
    prep.edgeRings.forEach((ring, ri) => {
      if (prep.edgePart[ri] !== part) return;
      const closed = new Float64Array(ring.length + 2);
      closed.set(ring);
      closed[ring.length] = ring[0];
      closed[ring.length + 1] = ring[1];
      const cur = b.last() ?? entry;
      const rot = cur ? rotateClosedTo(closed, cur[0], cur[1]) : closed;
      const pts = runningPoints(rot, prep.underlayStitchLength);
      travelTo(b, [pts[0], pts[1]], t, F.UNDERLAY);
      b.pushPolyline(pts, F.UNDERLAY, true);
    });
    if (prep.underlayLayer)
      sewLayer(
        b,
        prep.underlayLayer,
        t,
        prep.minEnd,
        F.UNDERLAY,
        b.last() ?? entry,
        undefined,
        (i) => prep.underlayPart[i] === part,
      );
    sewLayer(b, prep.top, t, prep.minEnd, 0, b.last() ?? entry, partExit, (i) => prep.topPart[i] === part);
  });
  if (hints.userExit && exit) {
    const r = prep.router;
    if (r && r.isInside(exit[0], exit[1])) travelTo(b, exit, { router: r, travelLen: prep.travelLen });
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
