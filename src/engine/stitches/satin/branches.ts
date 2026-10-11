// SPDX-License-Identifier: GPL-3.0-or-later
import type { Vec2 } from '@/model/types';
import { F } from '../../types';
import { RunBuilder, runningPoints } from '../common';
import { routeRunningNetwork, type RunningNetwork } from '../running/network';
import { centerWalk, columnFromCenterline, satinPassCount, sewColumn, type ColumnSewOpts } from './column';

/** Preserve curved branches through degree-two vertices; split only at graph junctions. */
export function satinBranchPaths(network: RunningNetwork, entry?: Vec2, exit?: Vec2) {
  const degree = new Map(network.points.map((p, i) => [p, network.adjacent[i].length]));
  const groups: { points: number[]; underpath: boolean; jump: boolean }[] = [];
  let previous: Vec2 | undefined;
  for (const step of routeRunningNetwork(network, entry, exit)) {
    const last = groups.at(-1);
    if (
      last &&
      !step.jump &&
      previous === step.from &&
      degree.get(step.from) === 2 &&
      last.underpath === step.underpath
    ) {
      last.points.push(...step.to);
    } else {
      groups.push({ points: [...step.from, ...step.to], underpath: step.underpath, jump: step.jump });
    }
    previous = step.to;
  }
  return groups;
}

/** Repeated traversals are center walks; each branch's last visit covers them with satin. */
export function routeSatinBranches(
  network: RunningNetwork,
  halfWidth: number,
  options: ColumnSewOpts,
  entry?: Vec2,
  exit?: Vec2,
) {
  const b = new RunBuilder();
  for (const part of satinBranchPaths(network, entry, exit)) {
    const points = Float64Array.from(part.points);
    if (part.jump) b.jumpTo(points[0], points[1], F.TRIM);
    if (part.underpath) {
      b.pushPolyline(runningPoints(points, options.underlayStitchLength), F.UNDERLAY | F.TRAVEL);
    } else {
      const col = columnFromCenterline(points, false, halfWidth);
      if (col.length <= 0) continue;
      b.push(points[0], points[1], F.UNDERLAY);
      // The top must traverse start → end. With an even pass count, first walk to the
      // far end, then sew underlay back. That walk is covered by this same branch.
      const forward = satinPassCount(options.underlay) % 2 === 1;
      if (!forward) centerWalk(b, col, true, options.underlayStitchLength, F.UNDERLAY | F.TRAVEL);
      sewColumn(b, col, options, undefined, undefined, forward);
      b.push(points[points.length - 2], points[points.length - 1]);
    }
  }
  return b.build();
}
