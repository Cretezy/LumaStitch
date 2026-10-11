// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { routeCost, routeOrder, type RouteProblem } from './routeOrder';

function permutations(a: number[]): number[][] {
  return a.length
    ? a.flatMap((v, k) => permutations(a.filter((_, j) => j !== k)).map((p) => [v, ...p]))
    : [[]];
}
const cmp = (a: [number, number], b: [number, number]) => a[0] - b[0] || a[1] - b[1];
function problem(n: number, seed = 17): RouteProblem {
  let s = seed;
  const random = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  const points = Array.from({ length: n }, () => [random() * 100, random() * 100]);
  return {
    size: n,
    start: (i) => Math.hypot(...points[i]),
    distance: (i, j) => Math.hypot(points[i][0] - points[j][0], points[i][1] - points[j][1]),
    thread: (i) => String(i % 3),
    predecessors: Array.from(
      { length: n },
      (_, i) => new Set(Array.from({ length: i }, (_, j) => j).filter(() => random() < 0.15)),
    ),
  };
}
function valid(p: RouteProblem, o: number[]) {
  expect(o.slice().sort((a, b) => a - b)).toEqual(Array.from({ length: p.size }, (_, i) => i));
  if (p.last !== undefined) expect(o.at(-1)).toBe(p.last);
  p.predecessors?.forEach((preds, i) =>
    preds.forEach((j) => expect(o.indexOf(j)).toBeLessThan(o.indexOf(i))),
  );
}

describe('open route optimization', () => {
  it('matches exhaustive lexicographic optima, with precedence, colours and a reserved exit', () => {
    const all = permutations([0, 1, 2, 3, 4, 5, 6]);
    for (let seed = 1; seed <= 12; seed++) {
      const p = problem(7, seed);
      if (seed % 2) p.last = 6;
      const candidates = all.filter(
        (o) =>
          (p.last === undefined || o.at(-1) === p.last) &&
          p.predecessors!.every((ps, i) => [...ps].every((j) => o.indexOf(j) < o.indexOf(i))),
      );
      const optimum = candidates.map((o) => routeCost(p, o)).sort(cmp)[0];
      const result = routeOrder(p)!;
      valid(p, result);
      const score = routeCost(p, result);
      expect(score[0]).toBe(optimum[0]);
      expect(score[1]).toBeCloseTo(optimum[1], 8);
    }
  });

  it('preserves constraints and never worsens a valid incumbent above the exact cutoff', () => {
    for (const n of [15, 32, 65, 301]) {
      const p = problem(n);
      p.last = n - 1;
      const incumbent = Array.from({ length: n }, (_, i) => i);
      const result = routeOrder(p, incumbent)!;
      valid(p, result);
      expect(cmp(routeCost(p, result), routeCost(p, incumbent))).toBeLessThanOrEqual(1e-7);
      expect(routeOrder(p, incumbent)).toEqual(result);
    }
  });

  it('can relocate a node across colour blocks without adding thread changes', () => {
    const p = problem(18);
    p.predecessors = undefined;
    const result = routeOrder(p)!;
    valid(p, result);
    expect(routeCost(p, result)[0]).toBe(2);
  });

  it('returns null for cycles and handles empty/singleton routes', () => {
    expect(routeOrder({ ...problem(2), predecessors: [new Set([1]), new Set([0])] })).toBeNull();
    expect(
      routeOrder({
        ...problem(16),
        predecessors: Array.from({ length: 16 }, (_, i) => new Set([(i + 1) % 16])),
      }),
    ).toBeNull();
    expect(routeOrder(problem(0))).toEqual([]);
    expect(routeOrder({ ...problem(1), last: 0 })).toEqual([0]);
  });
});
