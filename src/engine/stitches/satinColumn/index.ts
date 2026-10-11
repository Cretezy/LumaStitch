// SPDX-License-Identifier: GPL-3.0-or-later
/** Explicit digitized rails. First two subpaths are rails; subsequent paths are direction rungs. */
import { flattenSubpath } from '@/geom/flatten';
import { cumulativeLengths, nearestOnPolyline, pointAtLength } from '@/geom/polyline';
import type { Polyline } from '@/geom/types';
import type { Vec2 } from '@/model/types';
import type { StitchTypeDef } from '../../def';
import { bool, num, str } from '../../params/types';
import { RunBuilder } from '../common';
import { satinCommonDefaults, satinCommonParams } from '../satin';
import { resolveSatinUnderlay, sewColumn, type Column, type UnderlayKind } from '../satin/column';

export function columnFromRails(a: Polyline, b: Polyline, rungs: [Vec2, Vec2][] = [], pull = 0): Column {
  const ca = cumulativeLengths(a),
    cb = cumulativeLengths(b);
  const la = ca.at(-1) ?? 0,
    lb = cb.at(-1) ?? 0;
  if (!(la > 0 && lb > 0)) throw new Error('Satin rails must each have a nonzero length.');
  const hit = (rail: Polyline, cum: Float64Array, p: Vec2, q: Vec2): number | undefined => {
    const dx = q[0] - p[0],
      dy = q[1] - p[1];
    for (let i = 0; i + 3 < rail.length; i += 2) {
      const ex = rail[i + 2] - rail[i],
        ey = rail[i + 3] - rail[i + 1];
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-12) continue;
      const px = rail[i] - p[0],
        py = rail[i + 1] - p[1];
      const t = (px * ey - py * ex) / den,
        u = (px * dy - py * dx) / den;
      if (t >= -1e-6 && t <= 1 + 1e-6 && u >= -1e-6 && u <= 1 + 1e-6)
        return cum[i / 2] + Math.max(0, Math.min(1, u)) * Math.hypot(ex, ey);
    }
  };
  const pairs = rungs
    .map(([p, q]) => {
      const pa = nearestOnPolyline(a, ...p),
        qa = nearestOnPolyline(a, ...q);
      const useP = pa.dist <= qa.dist;
      return {
        a: hit(a, ca, p, q) ?? (useP ? pa : qa).s,
        b: hit(b, cb, p, q) ?? nearestOnPolyline(b, ...(useP ? q : p)).s,
      };
    })
    .filter((r) => r.a > 1e-6 && r.a < la - 1e-6 && r.b > 1e-6 && r.b < lb - 1e-6)
    .sort((p, q) => p.a - q.a);
  const anchors = [{ a: 0, b: 0 }];
  for (const p of pairs) {
    const prev = anchors.at(-1)!;
    if (p.a <= prev.a + 1e-6 || p.b <= prev.b + 1e-6)
      throw new Error('Satin direction rungs cross; reverse a rail or move the rungs.');
    anchors.push(p);
  }
  anchors.push({ a: la, b: lb });
  const aa: number[] = [],
    bb: number[] = [],
    cc: number[] = [];
  for (let i = 1; i < anchors.length; i++) {
    const p = anchors[i - 1],
      q = anchors[i];
    const n = Math.max(1, Math.ceil(Math.max(q.a - p.a, q.b - p.b) / 0.15));
    for (let j = i === 1 ? 0 : 1; j <= n; j++) {
      const t = j / n;
      const u = pointAtLength(a, ca, p.a + (q.a - p.a) * t);
      const v = pointAtLength(b, cb, p.b + (q.b - p.b) * t);
      const dx = u[0] - v[0],
        dy = u[1] - v[1],
        length = Math.hypot(dx, dy);
      const k = length > 1e-9 ? pull / length : 0;
      aa.push(u[0] + dx * k, u[1] + dy * k);
      bb.push(v[0] - dx * k, v[1] - dy * k);
      cc.push((u[0] + v[0]) / 2, (u[1] + v[1]) / 2);
    }
  }
  const c = Float64Array.from(cc),
    s = cumulativeLengths(c);
  return { a: Float64Array.from(aa), b: Float64Array.from(bb), c, s, closed: false, length: s.at(-1)! };
}

interface Prep {
  col: Column | null;
  density: number;
  underlay: UnderlayKind;
  underlayInset: number;
  zigzagUnderlaySpacing: number;
  underlayStitchLength: number;
  shortStitches: boolean;
  splitAbove: number;
}

export const satinColumnDef: StitchTypeDef<Prep> = {
  id: 'satinColumn',
  label: 'Satin rails',
  role: 'outline',
  description: 'Two digitized rails followed by direction rungs. Edit the rails with the node tool.',
  params: satinCommonParams,
  defaults: satinCommonDefaults,
  appliesTo: (s) => s.hasOpen,
  prepare(geom, params, el, ctx) {
    let col: Column | null = null;
    let width = 0;
    try {
      if (geom.subpaths.length < 2) throw new Error('Satin rails need two open subpaths.');
      const [a, b, ...r] = geom.subpaths.map((sp) => flattenSubpath(sp, ctx.tolerance));
      const rungs: [Vec2, Vec2][] = r
        .filter((p) => p.length >= 4)
        .map((p) => [
          [p[0], p[1]],
          [p[p.length - 2], p[p.length - 1]],
        ]);
      col = columnFromRails(
        a,
        b,
        [...rungs, ...(el.guides ?? [])],
        Math.max(0, num(params, 'pullComp', 0.2)),
      );
      for (let i = 0; i < col.a.length; i += 2)
        width = Math.max(width, Math.hypot(col.a[i] - col.b[i], col.a[i + 1] - col.b[i + 1]));
    } catch (error) {
      ctx.diag('satin-rails', error instanceof Error ? error.message : String(error), undefined, 'error');
    }
    return {
      col,
      density: Math.max(0.1, num(params, 'density', 0.4)),
      underlay: resolveSatinUnderlay(str(params, 'underlay', 'auto'), width, num(params, 'underlayBoost', 0)),
      underlayInset: num(params, 'underlayInset', 0.4),
      zigzagUnderlaySpacing: num(params, 'zigzagUnderlaySpacing', 2),
      underlayStitchLength: num(params, 'underlayStitchLength', 2),
      shortStitches: bool(params, 'shortStitches', true),
      splitAbove: num(params, 'splitAbove', 7),
    };
  },
  route(prep, hints) {
    const b = new RunBuilder();
    if (prep.col) sewColumn(b, prep.col, prep, hints.entry, hints.exit);
    return b.build();
  },
};
