// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Satin fill for a whole shape. Auto-turning mode derives two rails from the outline (split at the
 * ends of the medial-axis diameter path, or at user rail-split points) and pairs them through rungs
 * (user guides + automatic rungs from skeleton nodes). Shapes with holes or branches fall back to a
 * fixed-angle satin built from scanline sections.
 */
import { offset } from '@/geom/clipper';
import { flattenGeom } from '@/geom/flatten';
import { apply } from '@/geom/matrix';
import { createPointTester } from '@/geom/polygon';
import { medialAxis } from '@/geom/medialAxis';
import { cumulativeLengths, nearestOnPolyline, pointAtLength, rotateClosedTo } from '@/geom/polyline';
import type { PolyShape, Polyline } from '@/geom/types';
import type { InsideRouter } from '@/geom/visibility';
import type { StitchElement, Vec2 } from '@/model/types';
import type { StitchTypeDef } from '../../def';
import { bool, num, str, type ParamDef } from '../../params/types';
import { F } from '../../types';
import { RunBuilder, runningPoints } from '../common';
import { resolveSatinUnderlay, sewColumn, type Column, type UnderlayKind } from '../satin/column';
import { satinCommonDefaults, satinCommonParams } from '../satin';
import { fillPolygon, makeRouter, travelTo } from '../tatami';
import { buildSections, type Section } from '../tatami/layer';

interface AutoPrep {
  mode: 'auto';
  col: Column;
}
interface FixedPrep {
  mode: 'fixed';
  sections: Section[];
  toDoc: [number, number, number, number, number, number];
  edgeRings: Float64Array[];
  router: InsideRouter | null;
  /** Point-in-shape test (small tolerance) so stitches never cross holes or notches. */
  inside: (x: number, y: number) => boolean;
}
export type SatinFillPrep = (AutoPrep | FixedPrep | { mode: 'empty' }) & {
  density: number;
  underlay: UnderlayKind;
  underlayInset: number;
  zigzagUnderlaySpacing: number;
  underlayStitchLength: number;
  shortStitches: boolean;
  splitAbove: number;
};

function closeRing(r: Float64Array): Polyline {
  const c = new Float64Array(r.length + 2);
  c.set(r);
  c[r.length] = r[0];
  c[r.length + 1] = r[1];
  return c;
}

/** Nearest intersection of a ray with a closed polyline. */
function rayHit(pl: Polyline, ox: number, oy: number, dx: number, dy: number): Vec2 | null {
  let best = Infinity;
  let hit: Vec2 | null = null;
  for (let i = 0; i + 3 < pl.length; i += 2) {
    const ax = pl[i],
      ay = pl[i + 1],
      bx = pl[i + 2],
      by = pl[i + 3];
    const ex = bx - ax,
      ey = by - ay;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((ax - ox) * ey - (ay - oy) * ex) / den;
    const u = ((ax - ox) * dy - (ay - oy) * dx) / den;
    if (t > 0 && u >= 0 && u <= 1 && t < best) {
      best = t;
      hit = [ox + dx * t, oy + dy * t];
    }
  }
  return hit;
}

/** Sub-polyline of a closed polyline between arc positions s0 → s1 going forward (wrapping). */
function arcSlice(pl: Polyline, cum: Float64Array, s0: number, s1: number): Polyline {
  const L = cum[cum.length - 1];
  if (s1 < s0) s1 += L;
  const out: number[] = [];
  const p0 = pointAtLength(pl, cum, s0 % L);
  out.push(p0[0], p0[1]);
  // Walk vertices strictly between.
  const n = cum.length;
  for (let lap = 0; lap < 2; lap++) {
    for (let i = 0; i < n; i++) {
      const s = cum[i] + lap * L;
      if (s > s0 && s < s1) out.push(pl[i * 2], pl[i * 2 + 1]);
    }
  }
  const p1 = pointAtLength(pl, cum, s1 >= L ? s1 - L : s1);
  out.push(p1[0], p1[1]);
  return Float64Array.from(out);
}

function reverse(pl: Polyline): Polyline {
  const n = pl.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i += 2) {
    out[i] = pl[n - 2 - i];
    out[i + 1] = pl[n - 1 - i];
  }
  return out;
}

/** Builds rails + rungs into a Column. Returns null when the shape is not suitable. */
export function autoColumn(
  base: PolyShape,
  expanded: PolyShape,
  el: StitchElement,
  origRing: Polyline | null,
): Column | null {
  if (base.length !== 1 || base[0].holes.length) return null;
  if (expanded.length !== 1) return null;
  const med = medialAxis(base);
  if (med.branches > 0 || med.diameter.length < 2) return null;
  const R = closeRing(expanded[0].outer);
  const cumR = cumulativeLengths(R);
  const sk = med.skeleton;
  const dpath = med.diameter;

  let P1: Vec2, P2: Vec2;
  if (el.railSplit && origRing) {
    const cumO = cumulativeLengths(origRing);
    const LO = cumO[cumO.length - 1];
    P1 = pointAtLength(origRing, cumO, (((el.railSplit[0] % 1) + 1) % 1) * LO);
    P2 = pointAtLength(origRing, cumO, (((el.railSplit[1] % 1) + 1) % 1) * LO);
  } else {
    const endPoint = (fromEnd: boolean): Vec2 => {
      const n = dpath.length;
      const i0 = fromEnd ? dpath[n - 1] : dpath[0];
      // Direction from a node a few steps in toward the leaf.
      const back = Math.min(n - 1, 5);
      const i1 = fromEnd ? dpath[n - 1 - back] : dpath[back];
      let dx = sk.x[i0] - sk.x[i1],
        dy = sk.y[i0] - sk.y[i1];
      const l = Math.hypot(dx, dy);
      if (l > 1e-9) {
        dx /= l;
        dy /= l;
        const h = rayHit(R, sk.x[i0], sk.y[i0], dx, dy);
        if (h) return h;
      }
      const nr = nearestOnPolyline(R, sk.x[i0], sk.y[i0]);
      return [nr.x, nr.y];
    };
    P1 = endPoint(false);
    P2 = endPoint(true);
  }
  const s1 = nearestOnPolyline(R, P1[0], P1[1]).s;
  const s2 = nearestOnPolyline(R, P2[0], P2[1]).s;
  if (Math.abs(s1 - s2) < 1e-6) return null;
  const railA = arcSlice(R, cumR, s1, s2);
  const railB = reverse(arcSlice(R, cumR, s2, s1));
  const cumA = cumulativeLengths(railA),
    cumB = cumulativeLengths(railB);
  const LA = cumA[cumA.length - 1],
    LB = cumB[cumB.length - 1];
  if (LA < 1e-6 || LB < 1e-6) return null;

  // Rungs: (sA, sB) pairs.
  const rungs: { a: number; b: number; user: boolean }[] = [];
  for (const g of el.guides ?? []) {
    const [p, q] = g;
    const pa = nearestOnPolyline(railA, p[0], p[1]),
      qa = nearestOnPolyline(railA, q[0], q[1]);
    const useP = pa.dist <= qa.dist;
    const a = useP ? pa : qa;
    const other = useP ? q : p;
    const bb = nearestOnPolyline(railB, other[0], other[1]);
    rungs.push({ a: a.s, b: bb.s, user: true });
  }
  let acc = 0;
  for (let k = 1; k < dpath.length - 1; k++) {
    const i = dpath[k];
    acc += Math.hypot(sk.x[i] - sk.x[dpath[k - 1]], sk.y[i] - sk.y[dpath[k - 1]]);
    if (acc < 1.0) continue;
    acc = 0;
    const na = nearestOnPolyline(railA, sk.x[i], sk.y[i]);
    const nb = nearestOnPolyline(railB, sk.x[i], sk.y[i]);
    rungs.push({ a: na.s, b: nb.s, user: false });
  }
  rungs.sort((r1, r2) => r1.a - r2.a || (r2.user ? 1 : 0) - (r1.user ? 1 : 0));
  // Enforce monotonic b; user rungs win.
  const kept: { a: number; b: number }[] = [{ a: 0, b: 0 }];
  const users = rungs.filter((r) => r.user);
  for (const r of rungs) {
    const prev = kept[kept.length - 1];
    if (r.a <= prev.a + 0.05 || r.b <= prev.b + 0.05 || r.a >= LA - 0.05 || r.b >= LB - 0.05) continue;
    if (!r.user && users.some((u) => (u.a - r.a) * (u.b - r.b) < 0)) continue;
    kept.push(r);
  }
  kept.push({ a: LA, b: LB });

  const A: number[] = [],
    B: number[] = [],
    C: number[] = [];
  for (let i = 0; i < kept.length - 1; i++) {
    const r0 = kept[i],
      r1 = kept[i + 1];
    const m = Math.max(1, Math.ceil(Math.max(r1.a - r0.a, r1.b - r0.b) / 0.2));
    for (let j = i === 0 ? 0 : 1; j <= m; j++) {
      const t = j / m;
      const pa = pointAtLength(railA, cumA, r0.a + (r1.a - r0.a) * t);
      const pb = pointAtLength(railB, cumB, r0.b + (r1.b - r0.b) * t);
      A.push(pa[0], pa[1]);
      B.push(pb[0], pb[1]);
      C.push((pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2);
    }
  }
  const c = Float64Array.from(C);
  const s = cumulativeLengths(c);
  return { s, a: Float64Array.from(A), b: Float64Array.from(B), c, closed: false, length: s[s.length - 1] };
}

export const satinFillParams: ParamDef[] = [
  {
    key: 'mode',
    label: 'Direction',
    help: 'Auto-turning follows the shape with two rails derived from the outline. Shapes with holes or branches fall back to a fixed angle.',
    kind: 'enum',
    options: [
      { value: 'auto', label: 'Auto-turning' },
      { value: 'fixed', label: 'Fixed angle' },
    ],
    group: 'basic',
  },
  {
    key: 'angle',
    label: 'Angle',
    kind: 'angle',
    unit: '°',
    min: 0,
    max: 180,
    step: 1,
    group: 'basic',
    visibleIf: (p) => p.mode === 'fixed',
  },
  ...satinCommonParams,
  {
    key: 'cutoutGrowth',
    label: 'Cutout overlap',
    kind: 'length',
    unit: 'mm',
    min: 0,
    max: 2,
    step: 0.05,
    group: 'compensation',
  },
];

export const satinFillDef: StitchTypeDef<SatinFillPrep> = {
  id: 'satinFill',
  label: 'Satin',
  description: 'Satin stitches spanning the whole shape. Best for narrow shapes up to about 7 mm wide.',
  role: 'fill',
  params: satinFillParams,
  defaults: { mode: 'auto', angle: 45, ...satinCommonDefaults, cutoutGrowth: 0 },
  appliesTo: (s) => s.hasClosed,
  prepare(geom, params, el, ctx) {
    const base = fillPolygon(geom, params, ctx);
    const pull = num(params, 'pullComp', 0.2);
    const common = {
      density: Math.max(0.1, num(params, 'density', 0.4)),
      underlayInset: num(params, 'underlayInset', 0.4),
      zigzagUnderlaySpacing: num(params, 'zigzagUnderlaySpacing', 2),
      underlayStitchLength: num(params, 'underlayStitchLength', 2),
      shortStitches: bool(params, 'shortStitches', true),
      splitAbove: num(params, 'splitAbove', 7),
    };
    if (!base.length) return { mode: 'empty', underlay: 'none', ...common };
    const expanded = offset(base, pull);
    const underlaySetting = str(params, 'underlay', 'auto');
    const boost = num(params, 'underlayBoost', 0);
    if (str(params, 'mode', 'auto') === 'auto') {
      const flat = flattenGeom(geom, ctx.tolerance);
      const orig = flat.rings[0] ? closeRing(flat.rings[0]) : null;
      const col = autoColumn(base, expanded, el, orig);
      if (col) {
        let maxW = 0;
        for (let i = 0; i < col.s.length; i++)
          maxW = Math.max(maxW, Math.hypot(col.a[i * 2] - col.b[i * 2], col.a[i * 2 + 1] - col.b[i * 2 + 1]));
        if (maxW > 10)
          ctx.diag('satin-wide', `Satin fill is up to ${maxW.toFixed(1)} mm wide; consider tatami.`);
        return {
          mode: 'auto',
          col,
          underlay: resolveSatinUnderlay(underlaySetting, maxW - 2 * pull, boost),
          ...common,
        };
      }
      ctx.diag(
        'satin-fallback',
        'Satin fill has holes or branches; using a fixed angle instead of auto-turning.',
        undefined,
        'info',
      );
    }
    const angle = num(params, 'angle', 45);
    const { sections, toDoc } = buildSections(expanded, angle, common.density / 2);
    const inset = offset(base, -common.underlayInset);
    const edgeRings: Float64Array[] = [];
    const ul = resolveSatinUnderlay(underlaySetting, 4, boost);
    if (ul !== 'none') for (const p of inset) edgeRings.push(p.outer, ...p.holes);
    let travelArea = offset(base, -0.25);
    if (!travelArea.length) travelArea = base;
    return {
      mode: 'fixed',
      sections,
      toDoc,
      edgeRings,
      router: makeRouter(travelArea),
      inside: createPointTester(offset(expanded, 0.05)),
      underlay: ul,
      ...common,
    };
  },
  route(prep, hints) {
    const b = new RunBuilder();
    if (prep.mode === 'empty') return b.build();
    if (prep.mode === 'auto') {
      sewColumn(b, prep.col, prep, hints.entry, hints.exit);
      return b.build();
    }
    const t = { router: prep.router, travelLen: 2 };
    for (const ring of prep.edgeRings) {
      const cur = b.last() ?? hints.entry;
      const closed = closeRing(ring);
      const rot = cur ? rotateClosedTo(closed, cur[0], cur[1]) : closed;
      const pts = runningPoints(rot, prep.underlayStitchLength);
      travelTo(b, [pts[0], pts[1]], t, F.UNDERLAY);
      b.pushPolyline(pts, F.UNDERLAY, true);
    }
    const done = new Uint8Array(prep.sections.length);
    for (let count = 0; count < prep.sections.length; count++) {
      const cur = b.last() ?? hints.entry;
      let bi = -1,
        bc = 0,
        bd = Infinity;
      prep.sections.forEach((s, i) => {
        if (done[i]) return;
        for (let c = 0; c < 4; c++) {
          const row = c < 2 ? s.rows[0] : s.rows[s.rows.length - 1];
          const p = apply(prep.toDoc, [c % 2 ? row.x1 : row.x0, row.y]);
          const d = cur ? Math.hypot(p[0] - cur[0], p[1] - cur[1]) : 0;
          if (d < bd) {
            bd = d;
            bi = i;
            bc = c;
          }
        }
      });
      done[bi] = 1;
      const s = prep.sections[bi];
      const rows = bc < 2 ? s.rows : s.rows.slice().reverse();
      let right = bc % 2 === 1;
      const pts: Vec2[] = rows.map((row) => {
        const p = apply(prep.toDoc, [right ? row.x1 : row.x0, row.y]);
        right = !right;
        return p;
      });
      travelTo(b, pts[0], t);
      for (let i = 1; i < pts.length; i++) {
        const [px, py] = pts[i - 1],
          [qx, qy] = pts[i];
        // A satin stitch that would leave the shape (across a hole or notch) becomes inside travel.
        let ok = true;
        for (const u of [0.25, 0.5, 0.75])
          if (!prep.inside(px + (qx - px) * u, py + (qy - py) * u)) ok = false;
        if (!ok) {
          travelTo(b, [qx, qy], t);
          continue;
        }
        const l = Math.hypot(qx - px, qy - py);
        if (prep.splitAbove > 0 && l > prep.splitAbove) {
          const m = Math.ceil(l / prep.splitAbove);
          const stagger = i % 2 ? 0.5 : 0;
          for (let j = 1; j < m + (stagger ? 1 : 0); j++) {
            const tt = (j - stagger) / m;
            if (tt > 0.05 && tt < 0.95) b.push(px + (qx - px) * tt, py + (qy - py) * tt);
          }
        }
        b.push(qx, qy);
      }
    }
    return b.build();
  },
};
