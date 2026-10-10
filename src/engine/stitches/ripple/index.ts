// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Ripple fill: one continuous spiral that follows the outline inward. Inward offsets of the shape
 * are chained level by level; each lap blends from one ring to the next (by arc length), so laps
 * join without a trim. Where the offsets split into parts, or around holes, each part is its own
 * spiral and the spirals are joined by inside travel.
 */
import { offset } from '@/geom/clipper';
import { nearestOnRing, ringCentroid } from '@/geom/polygon';
import { resampleFixed, rotateClosedTo, simplifyRing } from '@/geom/polyline';
import type { Polygon, Ring } from '@/geom/types';
import type { InsideRouter } from '@/geom/visibility';
import type { StitchTypeDef } from '../../def';
import { num, str } from '../../params/types';
import { RunBuilder, dist, runningPoints } from '../common';
import { closeRing } from '../p2util';
import { fillPolygon, makeRouter, travelTo } from '../tatami';

export interface RipplePrep {
  /** Ring chains: consecutive rings are `spacing` apart and are sewn as one spiral. */
  chains: Ring[][];
  stitchLength: number;
  spacing: number;
  router: InsideRouter | null;
}

const MAX_RINGS = 3000;

/** Groups the inward offsets of `start` into chains of rings that continue 1:1 level to level. */
export function rippleChains(start: Polygon[], spacing: number): Ring[][] {
  const chains: Ring[][] = [];
  let total = 0;
  const simplify = (r: Ring) => simplifyRing(r, 0.02);
  const queue: Polygon[] = start.slice();
  while (queue.length && total < MAX_RINGS) {
    let cur = queue.shift()!;
    const outer: Ring[] = [simplify(cur.outer)];
    const holes: Ring[][] = cur.holes.map((h) => [simplify(h)]);
    chains.push(outer, ...holes);
    total += 1 + holes.length;
    while (total < MAX_RINGS) {
      const next = offset([cur], -spacing);
      if (!next.length) break;
      if (next.length !== 1 || next[0].holes.length !== cur.holes.length) {
        queue.push(...next);
        break;
      }
      const p = next[0];
      outer.push(simplify(p.outer));
      // Match each hole chain to the nearest unused hole of the next level.
      const used = new Uint8Array(p.holes.length);
      for (const chain of holes) {
        const c = ringCentroid(chain[chain.length - 1]);
        let bi = -1,
          bd = Infinity;
        p.holes.forEach((h, i) => {
          if (used[i]) return;
          const hc = ringCentroid(h);
          const d = Math.hypot(hc[0] - c[0], hc[1] - c[1]);
          if (d < bd) {
            bd = d;
            bi = i;
          }
        });
        if (bi >= 0) {
          used[bi] = 1;
          chain.push(simplify(p.holes[bi]));
        }
      }
      total += 1 + holes.length;
      cur = p;
    }
  }
  return chains;
}

/**
 * Spiral through a chain of rings starting near `from`: lap i runs around ring i while blending
 * linearly (by arc length) toward the nearest points of ring i + 1; the last ring is a full lap.
 */
export function spiralPoints(rings: Ring[], from: [number, number], step: number): number[] {
  const out: number[] = [];
  let p: [number, number] = from;
  for (let i = 0; i < rings.length; i++) {
    const ring = rotateClosedTo(closeRing(rings[i]), p[0], p[1]);
    const samples = resampleFixed(ring, step);
    const n = samples.length / 2;
    const next = i + 1 < rings.length ? rings[i + 1] : null;
    for (let k = out.length ? 1 : 0; k < n; k++) {
      const x = samples[k * 2],
        y = samples[k * 2 + 1];
      if (!next) {
        out.push(x, y);
        continue;
      }
      const t = k / (n - 1);
      const q = nearestOnRing(next, x, y);
      out.push(x + (q.x - x) * t, y + (q.y - y) * t);
    }
    p = [out[out.length - 2], out[out.length - 1]];
  }
  return out;
}

export const rippleDef: StitchTypeDef<RipplePrep> = {
  id: 'ripple',
  label: 'Ripple',
  description: 'One continuous spiral that follows the outline inward, like ripples. No trims.',
  role: 'fill',
  params: [
    {
      key: 'spacing',
      label: 'Spacing',
      help: 'Distance between neighbouring laps of the spiral.',
      kind: 'length',
      unit: 'mm',
      min: 0.3,
      max: 5,
      step: 0.05,
      group: 'basic',
    },
    {
      key: 'stitchLength',
      label: 'Stitch length',
      kind: 'length',
      unit: 'mm',
      min: 0.5,
      max: 6,
      step: 0.1,
      group: 'basic',
    },
    {
      key: 'direction',
      label: 'Direction',
      help: 'Start at the outline and spiral inward, or start in the middle and spiral out.',
      kind: 'enum',
      options: [
        { value: 'inward', label: 'Inward' },
        { value: 'outward', label: 'Outward' },
      ],
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
  ],
  defaults: { spacing: 1.0, stitchLength: 2.5, direction: 'inward', pullComp: 0 },
  appliesTo: (s) => s.hasClosed,
  prepare(geom, params, _el, ctx) {
    const base = fillPolygon(geom, params, ctx);
    const spacing = Math.max(0.2, num(params, 'spacing', 1));
    const L = Math.max(0.3, num(params, 'stitchLength', 2.5));
    const start = base.length ? offset(base, num(params, 'pullComp', 0) - spacing / 2) : [];
    let chains = rippleChains(start, spacing);
    const rings = chains.reduce((a, c) => a + c.length, 0);
    if (rings >= MAX_RINGS) ctx.diag('ripple-limit', `Ripple fill stopped after ${MAX_RINGS} rings.`);
    if (str(params, 'direction', 'inward') === 'outward')
      chains = chains.reverse().map((c) => c.slice().reverse());
    let travelArea = offset(base, -0.1);
    if (!travelArea.length) travelArea = base;
    return { chains, stitchLength: L, spacing, router: base.length ? makeRouter(travelArea) : null };
  },
  route(prep, hints) {
    const b = new RunBuilder();
    const t = { router: prep.router, travelLen: Math.max(prep.spacing * 3, 1) };
    const step = Math.min(0.5, prep.stitchLength / 2);
    for (const chain of prep.chains) {
      if (!chain.length) continue;
      const cur = b.last() ?? hints.entry;
      let from: [number, number] = [chain[0][0], chain[0][1]];
      if (cur) {
        const q = nearestOnRing(chain[0], cur[0], cur[1]);
        from = [q.x, q.y];
        if (dist(q.x, q.y, cur[0], cur[1]) < 1e-9) from = [cur[0], cur[1]];
      }
      const pts = runningPoints(Float64Array.from(spiralPoints(chain, from, step)), prep.stitchLength);
      if (pts.length < 2) continue;
      travelTo(b, [pts[0], pts[1]], t);
      b.pushPolyline(pts, 0, true);
    }
    return b.build();
  },
};
