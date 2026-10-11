// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, it } from 'vitest';
import { buildRunningNetwork, routeRunningNetwork } from './network';
import { prepareRunning, routeRunning, type PathItem } from './index';
import { F } from '../../types';
const paths = (...xy: number[][]): PathItem[] =>
  xy.map((p) => ({ pts: Float64Array.from(p), closed: false }));
const length = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);

it('routes a T junction without jumps and with the minimum 10 mm of underpath', () => {
  const network = buildRunningNetwork(paths([0, 0, 20, 0], [10, 0, 10, 10]))!;
  expect(network.components.length).toBe(1);
  expect(network.edges.length).toBe(3);
  const steps = routeRunningNetwork(network, [0, 0], [20, 0]);
  expect(steps.filter((s) => s.jump)).toEqual([]);
  expect(steps.filter((s) => s.underpath).reduce((sum, s) => sum + length(s.from, s.to), 0)).toBe(10);
  expect(steps.filter((s) => !s.underpath).reduce((sum, s) => sum + length(s.from, s.to), 0)).toBe(30);
  expect(steps[0].from).toEqual([0, 0]);
  expect(steps.at(-1)!.to).toEqual([20, 0]);
  steps.slice(1).forEach((s, i) => expect(s.from).toEqual(steps[i].to));
});

it('splits interior crossings and sews each original edge exactly once as top stitches', () => {
  const network = buildRunningNetwork(paths([0, 0, 20, 20], [0, 20, 20, 0], [0, 10, 20, 10]))!;
  expect(network.components.length).toBe(1);
  const steps = routeRunningNetwork(network);
  expect(steps.some((s) => s.jump)).toBe(false);
  const key = (a: number[], b: number[]) => [a.join(','), b.join(',')].sort().join('|');
  expect(
    steps
      .filter((s) => !s.underpath)
      .map((s) => key(s.from, s.to))
      .sort(),
  ).toEqual(network.edges.map((e) => key(network.points[e.a], network.points[e.b])).sort());
});

it('preserves duplicate and collinear overlapping strokes as separate required edges', () => {
  const network = buildRunningNetwork(paths([0, 0, 20, 0], [5, 0, 15, 0], [5, 0, 15, 0]))!;
  const steps = routeRunningNetwork(network, [0, 0], [20, 0]);
  expect(steps.filter((s) => !s.underpath).reduce((sum, s) => sum + length(s.from, s.to), 0)).toBe(40);
  expect(steps.filter((s) => s.underpath).length).toBe(0);
});

it('uses exactly one inter-component jump and never stitches across the gap', () => {
  const source = paths([0, 0, 10, 0], [5, 0, 5, 5], [30, 0, 40, 0], [35, 0, 35, 5]);
  const steps = routeRunningNetwork(buildRunningNetwork(source)!);
  expect(steps.filter((s) => s.jump).length).toBe(1);
  const run = routeRunning(prepareRunning(source, 2, 1, 1, true)).build();
  expect(Array.from(run.flags).filter((f) => f & F.JUMP).length).toBe(1);
  for (let i = 1; i < run.flags.length; i++) {
    if (run.flags[i] & F.JUMP) continue;
    expect(
      Math.hypot(run.xy[2 * i] - run.xy[2 * i - 2], run.xy[2 * i + 1] - run.xy[2 * i - 1]),
    ).toBeLessThanOrEqual(2.00001);
  }
});

it('keeps bean repeats on the final pass and uses single stitches for underpaths', () => {
  const source = paths([0, 0, 20, 0], [10, 0, 10, 10]);
  const a = routeRunning(prepareRunning(source, 2, 0, 1, true), [0, 0], [20, 0]).build();
  const b = routeRunning(prepareRunning(source, 2, 1, 1, true), [0, 0], [20, 0]).build();
  const travel = (f: Uint8Array) => Array.from(f).filter((x) => x & F.TRAVEL).length;
  expect(travel(b.flags)).toBe(travel(a.flags));
  expect(b.flags.length).toBeGreaterThan(a.flags.length);
  expect(prepareRunning(source, 2, 0, 2, true).network).toBeUndefined();
});

it('supports a closed Euler circuit with no repeated edges and bounds oversized work', () => {
  const square = paths([0, 0, 10, 0, 10, 10, 0, 10, 0, 0]);
  const steps = routeRunningNetwork(buildRunningNetwork(square)!, [0, 0], [0, 0]);
  expect(steps.length).toBe(4);
  expect(steps.some((s) => s.underpath || s.jump)).toBe(false);
  expect(buildRunningNetwork(paths([]))).toBeNull();
  expect(buildRunningNetwork(Array.from({ length: 1001 }, (_, i) => paths([0, i, 10, i])[0]))).toBeNull();
});

it('routes large odd-degree graphs deterministically through the bounded matching fallback', () => {
  const source = paths([0, 0, 100, 0], ...Array.from({ length: 24 }, (_, i) => [i * 4, 0, i * 4, 10]));
  const g = buildRunningNetwork(source)!;
  const result = routeRunningNetwork(g, [0, 0], [100, 0]);
  expect(result.some((s) => s.jump)).toBe(false);
  expect(result.filter((s) => !s.underpath).length).toBe(g.edges.length);
  expect(routeRunningNetwork(g, [0, 0], [100, 0])).toEqual(result);
});

it('matches an independent all-edges shortest-walk oracle on small networks', () => {
  for (const source of [
    paths([0, 0, 20, 0], [10, 0, 10, 10]),
    paths([0, 0, 10, 0, 10, 10, 0, 10, 0, 0], [0, 0, 10, 10]),
    paths([0, 0, 20, 0], [10, -10, 10, 10]),
  ]) {
    const graph = buildRunningNetwork(source)!;
    for (const end of [0, graph.points.length - 1]) {
      const n = graph.points.length,
        full = (1 << graph.edges.length) - 1;
      const distances = new Float64Array((full + 1) * n).fill(Infinity);
      const done = new Uint8Array(distances.length);
      distances[0] = 0;
      // Dijkstra over (visited edge mask, current vertex), independent of parity matching.
      for (;;) {
        let at = -1;
        for (let i = 0; i < distances.length; i++)
          if (!done[i] && Number.isFinite(distances[i]) && (at < 0 || distances[i] < distances[at])) at = i;
        if (at < 0 || at === full * n + end) break;
        done[at] = 1;
        const v = at % n,
          mask = Math.floor(at / n);
        for (const ei of graph.adjacent[v]) {
          const e = graph.edges[ei],
            u = e.a === v ? e.b : e.a;
          const to = (mask | (1 << ei)) * n + u;
          distances[to] = Math.min(distances[to], distances[at] + e.length);
        }
      }
      const route = routeRunningNetwork(graph, graph.points[0], graph.points[end]);
      expect(route.reduce((sum, s) => sum + length(s.from, s.to), 0)).toBeCloseTo(
        distances[full * n + end],
        8,
      );
    }
  }
});
