// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, it } from 'vitest';
import { closestBoundaryPoints, closestRings } from './closest';

it('finds a join in an edge interior, independent of vertex placement', () => {
  const a = Float64Array.of(0, 0, 100, 0, 100, 5, 0, 5);
  const b = Float64Array.of(40, 8, 60, 8, 60, 10, 40, 10);
  const result = closestRings(a, b)!;
  expect(result.distance).toBe(3);
  expect(result.a[1]).toBe(5);
  expect(result.a[0]).toBeGreaterThanOrEqual(40);
  expect(result.a[0]).toBeLessThanOrEqual(60);
  expect(closestRings(b, a)!.distance).toBe(result.distance);
});
it('detects crossing edges without an intersecting vertex', () => {
  const result = closestBoundaryPoints(
    [{ pts: Float64Array.of(0, 0, 10, 10), closed: false }],
    [{ pts: Float64Array.of(0, 10, 10, 0), closed: false }],
  )!;
  expect(result).toEqual({ a: [5, 5], b: [5, 5], distance: 0 });
});
it('does not invent a closing edge on an open path', () => {
  const result = closestBoundaryPoints(
    [{ pts: Float64Array.of(0, 0, 10, 0, 10, 10), closed: false }],
    [{ pts: Float64Array.of(4, 5, 4, 6), closed: false }],
  )!;
  expect(result.distance).toBe(5);
});
it('handles collinear, degenerate and empty paths', () => {
  const path = (pts: number[]) => [{ pts: Float64Array.from(pts), closed: false }];
  expect(closestBoundaryPoints(path([0, 0, 10, 0]), path([5, 0, 15, 0]))!.distance).toBe(0);
  expect(closestBoundaryPoints(path([0, 0]), path([3, 4]))!.distance).toBe(5);
  expect(closestBoundaryPoints([], path([3, 4]))).toBeNull();
});
