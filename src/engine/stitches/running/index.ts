// SPDX-License-Identifier: GPL-3.0-or-later
/** Running and triple (bean) run along every subpath of a shape. */
import { flattenToPaths } from '@/geom/flatten';
import { reversePolyline, rotateClosedTo } from '@/geom/polyline';
import type { Polyline } from '@/geom/types';
import type { StitchTypeDef } from '../../def';
import { num, type ParamDef } from '../../params/types';
import { F } from '../../types';
import { RunBuilder, beanify, dist, runningPoints } from '../common';

export interface PathItem {
  pts: Polyline;
  closed: boolean;
}

export interface RunningPrep {
  paths: PathItem[];
  stitchLength: number;
  bean: number;
  passes: number;
}

export const runningParams = (defLen: number, defBean: number): ParamDef[] =>
  [
    {
      key: 'stitchLength',
      label: 'Stitch length',
      help: 'Maximum distance between needle penetrations. Stitches are spaced evenly between corners.',
      kind: 'length',
      unit: 'mm',
      min: 0.5,
      max: 6,
      step: 0.1,
      group: 'basic',
    },
    {
      key: 'bean',
      label: 'Bean repeats',
      help: `How many extra times each stitch is sewn back and forth. 1 = triple run, 2 = quintuple. Default ${defBean}.`,
      kind: 'number',
      min: 0,
      max: 3,
      step: 1,
      group: 'basic',
    },
    {
      key: 'passes',
      label: 'Passes',
      help: 'Sew the path there and back this many times.',
      kind: 'number',
      min: 1,
      max: 5,
      step: 1,
      group: 'advanced',
    },
  ].map((d) =>
    d.key === 'stitchLength' ? { ...d, help: `${d.help} Default ${defLen} mm.` } : d,
  ) as ParamDef[];

export function prepareRunning(
  paths: PathItem[],
  stitchLength: number,
  bean: number,
  passes: number,
): RunningPrep {
  return {
    paths,
    stitchLength,
    bean: Math.max(0, Math.round(bean)),
    passes: Math.max(1, Math.round(passes)),
  };
}

/** Sews a single polyline with passes (alternating direction) and bean repeats. */
export function sewPath(
  b: RunBuilder,
  pts: Polyline,
  len: number,
  bean: number,
  passes: number,
  flag: number = F.STITCH,
): void {
  const base = runningPoints(pts, len);
  const fwd = beanify(base, bean);
  const rev = beanify(reversePolyline(base), bean);
  for (let p = 0; p < passes; p++) {
    const seq = p % 2 === 0 ? fwd : rev;
    b.pushPolyline(seq, flag, b.length > 0 && p > 0);
  }
}

/** Where a path ends after `passes` passes (closed paths end where they start). */
function pathEnd(item: PathItem, passes: number): [number, number] {
  const p = item.pts,
    n = p.length;
  return passes % 2 === 1 || item.closed ? [p[n - 2], p[n - 1]] : [p[0], p[1]];
}

/** Distance from q to the nearest place a path could start (any vertex if closed, else an end). */
function startDistance(item: PathItem, q: [number, number]): number {
  const p = item.pts,
    n = p.length;
  if (!item.closed) return Math.min(dist(q[0], q[1], p[0], p[1]), dist(q[0], q[1], p[n - 2], p[n - 1]));
  let d = Infinity;
  for (let k = 0; k < n; k += 2) d = Math.min(d, dist(q[0], q[1], p[k], p[k + 1]));
  return d;
}

/** Greedy order from `start` (optionally forcing the first path), each path oriented. */
function greedyOrder(
  paths: PathItem[],
  start: [number, number] | undefined,
  passes: number,
  exit: [number, number] | undefined,
  first?: number,
): PathItem[] {
  const remaining = paths.slice();
  const out: PathItem[] = [];
  let cur: [number, number] | undefined = start;
  while (remaining.length) {
    let bi = 0,
      bd = Infinity,
      brev = false;
    for (let i = 0; i < remaining.length; i++) {
      if (out.length === 0 && first !== undefined && remaining[i] !== paths[first]) continue;
      const p = remaining[i].pts;
      const n = p.length;
      if (!cur) {
        bi = i;
        break;
      }
      if (remaining[i].closed) {
        // Distance to nearest vertex approximates nearest boundary point.
        let d = Infinity;
        for (let k = 0; k < n; k += 2) d = Math.min(d, dist(cur[0], cur[1], p[k], p[k + 1]));
        if (d < bd) {
          bd = d;
          bi = i;
          brev = false;
        }
      } else {
        const ds = dist(cur[0], cur[1], p[0], p[1]);
        const de = dist(cur[0], cur[1], p[n - 2], p[n - 1]);
        let costS = ds,
          costE = de;
        if (remaining.length === 1 && exit) {
          // The path ends at the far end after an odd number of passes, the same end after an even number.
          const endS = passes % 2 ? [p[n - 2], p[n - 1]] : [p[0], p[1]];
          const endE = passes % 2 ? [p[0], p[1]] : [p[n - 2], p[n - 1]];
          costS += 0.5 * dist(endS[0], endS[1], exit[0], exit[1]);
          costE += 0.5 * dist(endE[0], endE[1], exit[0], exit[1]);
        }
        const d = Math.min(costS, costE);
        if (d < bd) {
          bd = d;
          bi = i;
          brev = costE < costS;
        }
      }
    }
    const item = remaining.splice(bi, 1)[0];
    let pts = item.pts;
    if (item.closed) {
      if (cur) pts = rotateClosedTo(pts, cur[0], cur[1]);
    } else if (brev) pts = reversePolyline(pts);
    out.push({ pts, closed: item.closed });
    cur = pathEnd(out[out.length - 1], passes);
  }
  return out;
}

/** Total jump length of an ordered, oriented list (plus half the distance to the exit). */
function orderCost(
  order: PathItem[],
  start: [number, number] | undefined,
  passes: number,
  exit: [number, number] | undefined,
): number {
  let c = 0;
  let cur = start;
  for (const it of order) {
    if (cur) c += dist(cur[0], cur[1], it.pts[0], it.pts[1]);
    cur = pathEnd(it, passes);
  }
  if (exit && cur) c += 0.5 * dist(cur[0], cur[1], exit[0], exit[1]);
  return c;
}

/**
 * Orders and orients paths so the jumps between them are short. Every path is tried as the first
 * one (up to 40 paths), the rest follow greedily, and the cheapest order wins. A closed path ends
 * where it starts, so its start point is then chosen between the previous path's end and the next
 * path (not just next to the previous one).
 */
export function orderPaths(
  paths: PathItem[],
  start: [number, number] | undefined,
  passes: number,
  exit?: [number, number],
): PathItem[] {
  let best = greedyOrder(paths, start, passes, exit);
  if (paths.length > 1 && paths.length <= 40) {
    let bc = orderCost(best, start, passes, exit);
    for (let f = 0; f < paths.length; f++) {
      const o = greedyOrder(paths, start, passes, exit, f);
      const c = orderCost(o, start, passes, exit);
      if (c < bc - 1e-9) {
        bc = c;
        best = o;
      }
    }
  }
  // Refine start points and orientations along the chosen order.
  let cur = start;
  for (let k = 0; k < best.length; k++) {
    const it = best[k];
    const next = best[k + 1];
    const p = it.pts,
      n = p.length;
    if (it.closed) {
      let bx = p[0],
        by = p[1],
        bd = Infinity;
      for (let q = 0; q < n; q += 2) {
        let d = cur ? dist(cur[0], cur[1], p[q], p[q + 1]) : 0;
        if (next) d += startDistance(next, [p[q], p[q + 1]]);
        else if (exit) d += 0.5 * dist(p[q], p[q + 1], exit[0], exit[1]);
        if (d < bd) {
          bd = d;
          bx = p[q];
          by = p[q + 1];
        }
      }
      if (cur || next || exit) best[k] = { pts: rotateClosedTo(p, bx, by), closed: true };
    } else if (cur) {
      const rev = { pts: reversePolyline(p), closed: false };
      const cost = (o: PathItem) => {
        const e = pathEnd(o, passes);
        const tail = next ? startDistance(next, e) : exit ? 0.5 * dist(e[0], e[1], exit[0], exit[1]) : 0;
        return dist(cur![0], cur![1], o.pts[0], o.pts[1]) + tail;
      };
      if (cost(rev) < cost(it)) best[k] = rev;
    }
    cur = pathEnd(best[k], passes);
  }
  return best;
}

export function routeRunning(
  prep: RunningPrep,
  entry?: [number, number],
  exit?: [number, number],
): RunBuilder {
  const b = new RunBuilder();
  const ordered = orderPaths(prep.paths, entry, prep.passes, exit);
  ordered.forEach(({ pts }, i) => {
    // Separate paths have nothing inside to travel through: the jump between them is trimmed
    // (the sequencer still sews hops of 1 mm or less).
    if (i > 0) b.jumpTo(pts[0], pts[1], F.TRIM);
    const before = b.length;
    sewPath(b, pts, prep.stitchLength, prep.bean, prep.passes);
    if (i > 0 && b.length > before) {
      // sewPath pushed the first point again as a stitch; drop it (the jump already lands there).
      b.xy.splice(before * 2, 2);
      b.flags.splice(before, 1);
    }
  });
  return b;
}

function makeDef(
  id: 'running' | 'triple',
  label: string,
  defLen: number,
  defBean: number,
): StitchTypeDef<RunningPrep> {
  return {
    id,
    label,
    description:
      id === 'running'
        ? 'A single line of stitches. For outlines and fine detail.'
        : 'Each stitch sewn forward, back and forward again for a bold line.',
    role: 'outline',
    params: runningParams(defLen, defBean),
    defaults: { stitchLength: defLen, bean: defBean, passes: 1 },
    aliasOf: id === 'triple' ? 'running' : undefined,
    appliesTo: (s) => s.hasClosed || s.hasOpen,
    prepare(geom, params, _el, ctx) {
      const paths = flattenToPaths(geom, ctx.tolerance);
      return prepareRunning(
        paths,
        num(params, 'stitchLength', defLen),
        num(params, 'bean', defBean),
        num(params, 'passes', 1),
      );
    },
    route(prep, hints) {
      return routeRunning(prep, hints.entry, hints.exit).build();
    },
  };
}

export const runningDef = makeDef('running', 'Running', 2.5, 0);
export const tripleDef = makeDef('triple', 'Triple run', 3.0, 1);
