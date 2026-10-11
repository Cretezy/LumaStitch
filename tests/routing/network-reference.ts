// SPDX-License-Identifier: GPL-3.0-or-later
import { buildRunningNetwork, routeRunningNetwork } from '@/engine/stitches/running/network';
import type { Vec2 } from '@/model/types';

export function networkReferenceCases() {
  const cases: { name: string; lines: number[][]; entry: Vec2; exit: Vec2 }[] = [
    {
      name: 'T-junction',
      lines: [
        [0, 0, 20, 0],
        [10, 0, 10, 10],
      ],
      entry: [0, 0],
      exit: [20, 0],
    },
    {
      name: 'square-cycle',
      lines: [
        [0, 0, 30, 0],
        [30, 0, 30, 30],
        [30, 30, 0, 30],
        [0, 30, 0, 0],
      ],
      entry: [0, 0],
      exit: [0, 0],
    },
    {
      name: 'grid-4x4',
      lines: [
        ...Array.from({ length: 4 }, (_, i) => [0, i * 10, 30, i * 10]),
        ...Array.from({ length: 4 }, (_, i) => [i * 10, 0, i * 10, 30]),
      ],
      entry: [0, 0],
      exit: [30, 30],
    },
  ];
  return cases.map(({ name, lines, entry, exit }) => {
    const graph = buildRunningNetwork(lines.map((xy) => ({ pts: Float64Array.from(xy), closed: false })))!;
    const steps = routeRunningNetwork(graph, entry, exit);
    return {
      name,
      points: graph.points,
      edges: graph.edges,
      start: graph.points.findIndex(([x, y]) => x === entry[0] && y === entry[1]),
      end: graph.points.findIndex(([x, y]) => x === exit[0] && y === exit[1]),
      requiredMm: graph.edges.reduce((sum, e) => sum + e.length, 0),
      lumaTravelMm: steps.reduce(
        (sum, s) => sum + (s.underpath ? Math.hypot(s.to[0] - s.from[0], s.to[1] - s.from[1]) : 0),
        0,
      ),
      lumaJumps: steps.filter((s) => s.jump).length,
    };
  });
}
