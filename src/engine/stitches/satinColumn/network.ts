// SPDX-License-Identifier: GPL-3.0-or-later
/** Network traversal with original, variable-width rail geometry retained for every branch. */
import { cumulativeLengths, nearestOnPolyline, pointAtLength, simplifyDP } from '@/geom/polyline';
import type { Vec2 } from '@/model/types';
import { F } from '../../types';
import { RunBuilder, runningPoints } from '../common';
import {
  buildRunningNetwork,
  routeRunningNetwork,
  type NetworkStep,
  type RunningNetwork,
} from '../running/network';
import {
  centerWalk,
  colA,
  colB,
  colC,
  satinPassCount,
  sewColumn,
  type Column,
  type ColumnSewOpts,
} from '../satin/column';

export interface RailNetwork {
  graph: RunningNetwork;
  /** Graph arclength → original centerline arclength, never nearest-point remapping at crossings. */
  maps: { lengths: Float64Array; positions: Float64Array }[];
}
export function buildRailNetwork(columns: Column[]): RailNetwork | null {
  const maps: RailNetwork['maps'] = [];
  const paths = columns.map((col) => {
    const points = simplifyDP(col.c, 0.01),
      positions: number[] = [];
    let j = 0;
    for (let i = 0; i < points.length; i += 2) {
      while (j + 1 < col.s.length && (col.c[j * 2] !== points[i] || col.c[j * 2 + 1] !== points[i + 1])) j++;
      positions.push(col.s[j], 0);
      if (i + 2 < points.length) j++;
    }
    maps.push({ lengths: cumulativeLengths(points), positions: new Float64Array(positions) });
    return { pts: points, closed: false };
  });
  // A rail endpoint can miss a simplified neighboring centerline by a few microns.
  // Snap only endpoints, at most 0.05 mm, without changing either column's actual rails.
  for (let i = 0; i < paths.length; i++) {
    const path = paths[i].pts;
    for (const k of [0, path.length - 2]) {
      let best = 0.05,
        target: Vec2 | undefined;
      for (let j = 0; j < paths.length; j++)
        if (i !== j) {
          const near = nearestOnPolyline(paths[j].pts, path[k], path[k + 1]);
          if (near.dist < best) {
            best = near.dist;
            target = [near.x, near.y];
          }
        }
      if (target) {
        path[k] = target[0];
        path[k + 1] = target[1];
      }
    }
    maps[i].lengths = cumulativeLengths(path);
  }
  const graph = buildRunningNetwork(paths);
  return graph ? { graph, maps } : null;
}

/** Slice by original centerline arclength, retaining all rail knots and guide correspondence. */
export function sliceRailColumn(col: Column, start: number, end: number): Column {
  const reverse = end < start,
    lo = Math.min(start, end),
    hi = Math.max(start, end);
  const positions = [lo, ...Array.from(col.s).filter((s) => s > lo + 1e-8 && s < hi - 1e-8), hi];
  if (reverse) positions.reverse();
  const a = new Float64Array(positions.flatMap((s) => colA(col, s))),
    b = new Float64Array(positions.flatMap((s) => colB(col, s))),
    c = new Float64Array(positions.flatMap((s) => colC(col, s))),
    lengths = cumulativeLengths(c);
  return { a, b, c, s: lengths, closed: false, length: lengths.at(-1) ?? 0 };
}

export function railBranchParts(network: RailNetwork, entry?: Vec2, exit?: Vec2) {
  const graph = network.graph,
    degree = new Map(graph.points.map((p, i) => [p, graph.adjacent[i].length]));
  const parts: NetworkStep[] = [];
  for (const step of routeRunningNetwork(graph, entry, exit)) {
    const last = parts.at(-1);
    if (
      last &&
      !step.jump &&
      last.to === step.from &&
      degree.get(step.from) === 2 &&
      last.source === step.source &&
      last.underpath === step.underpath &&
      Math.abs(last.end - step.start) < 1e-6 &&
      (last.end - last.start) * (step.end - step.start) > 0
    ) {
      last.to = step.to;
      last.end = step.end;
    } else parts.push({ ...step });
  }
  return parts.map((part) => {
    const map = network.maps[part.source];
    return {
      ...part,
      start: pointAtLength(map.positions, map.lengths, part.start)[0],
      end: pointAtLength(map.positions, map.lengths, part.end)[0],
    };
  });
}

export function routeRailNetwork(
  network: RailNetwork,
  columns: (ColumnSewOpts & { col: Column })[],
  entry?: Vec2,
  exit?: Vec2,
) {
  const b = new RunBuilder();
  const centerCoverage = new Map<number, [number, number][]>();
  const covered = (source: number, start: number, end: number) => {
    let at = Math.min(start, end);
    const target = Math.max(start, end);
    for (const [a, z] of (centerCoverage.get(source) ?? []).slice().sort((a, b) => a[0] - b[0])) {
      if (a > at + 1e-6) return false;
      at = Math.max(at, z);
      if (at >= target - 1e-6) return true;
    }
    return false;
  };
  for (const part of railBranchParts(network, entry, exit)) {
    let options = columns[part.source];
    const col = sliceRailColumn(options.col, part.start, part.end);
    if (col.length < 1e-8) continue;
    if (part.jump) b.jumpTo(...part.from, F.TRIM);
    // Small caps connect a snapped graph junction to the unchanged source column.
    b.push(...part.from, F.UNDERLAY | F.TRAVEL);
    if (part.underpath) {
      b.pushPolyline(runningPoints(col.c, options.underlayStitchLength), F.UNDERLAY | F.TRAVEL);
      centerCoverage.set(part.source, [
        ...(centerCoverage.get(part.source) ?? []),
        [Math.min(part.start, part.end), Math.max(part.start, part.end)],
      ]);
    } else {
      // A prior center underpath already supplies center underlay. Reusing it changes an
      // even pass count to odd, avoiding both a redundant center pass and an extra return walk.
      if (covered(part.source, part.start, part.end)) {
        if (options.underlay === 'center') options = { ...options, underlay: 'none' };
        else if (options.underlay === 'centerEdge') options = { ...options, underlay: 'edge' };
      }
      b.push(col.c[0], col.c[1], F.UNDERLAY);
      const forward = satinPassCount(options.underlay) % 2 === 1;
      if (!forward) centerWalk(b, col, true, options.underlayStitchLength, F.UNDERLAY | F.TRAVEL);
      sewColumn(b, col, options, undefined, undefined, forward);
      b.push(...colC(col, col.length));
    }
    b.push(...part.to, part.underpath ? F.UNDERLAY | F.TRAVEL : 0);
  }
  return b.build();
}
