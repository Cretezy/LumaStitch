// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, it } from 'vitest';
import { exactOpenOrder } from './exactOrder';
import { orderPaths, type PathItem } from './index';
import type { Vec2 } from '@/model/types';

function cost(paths: PathItem[], start: Vec2, passes: number, exit: Vec2): number {
  let total = 0,
    pos = start;
  for (const { pts } of paths) {
    total += Math.hypot(pos[0] - pts[0], pos[1] - pts[1]);
    pos = passes % 2 ? [pts[pts.length - 2], pts[pts.length - 1]] : [pts[0], pts[1]];
  }
  return total + 0.5 * Math.hypot(pos[0] - exit[0], pos[1] - exit[1]);
}
it('jointly optimizes order and direction against exhaustive enumeration for odd and even passes', () => {
  const paths: PathItem[] = [
    [4, 8, 7, 2],
    [12, 5, 3, 1],
    [20, 2, 14, 9],
    [9, 17, 2, 14],
    [6, 12, 15, 6],
  ].map((xy) => ({ pts: Float64Array.from(xy), closed: false }));
  const start: Vec2 = [0, 0],
    exit: Vec2 = [20, 20];
  for (const passes of [1, 2, 3, 4]) {
    let optimum = Infinity;
    const visit = (order: PathItem[], remaining: PathItem[]) => {
      if (!remaining.length) {
        optimum = Math.min(optimum, cost(order, start, passes, exit));
        return;
      }
      remaining.forEach((p, i) => {
        const rest = remaining.filter((_, j) => i !== j);
        visit([...order, p], rest);
        visit(
          [...order, { pts: Float64Array.of(p.pts[2], p.pts[3], p.pts[0], p.pts[1]), closed: false }],
          rest,
        );
      });
    };
    visit([], paths);
    const result = exactOpenOrder(paths, start, passes, exit)!;
    expect(cost(result, start, passes, exit)).toBeCloseTo(optimum, 9);
    expect(orderPaths(paths, start, passes, exit)).toEqual(result);
    expect(result.length).toBe(paths.length);
    const key = ({ pts }: PathItem) =>
      Array.from(pts)
        .sort((a, b) => a - b)
        .join(',');
    expect(result.map(key).sort()).toEqual(paths.map(key).sort());
  }
});
it('keeps empty, closed and large jobs on the existing fallback', () => {
  const p = { pts: Float64Array.of(0, 0, 1, 1), closed: false };
  expect(exactOpenOrder([], undefined, 1, undefined)).toBeNull();
  expect(exactOpenOrder([{ ...p, closed: true }], undefined, 1, undefined)).toBeNull();
  expect(
    exactOpenOrder(
      Array.from({ length: 13 }, () => p),
      undefined,
      1,
      undefined,
    ),
  ).toBeNull();
});
