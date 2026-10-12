// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, it } from 'vitest';
import { buildRunningNetwork } from '../running/network';
import { routeSatinBranches, satinBranchPaths } from './branches';
import { satinDef } from './index';
import type { UnderlayKind } from './column';
import { F } from '../../types';
import { createElement, DEFAULT_SETTINGS } from '@/model/factories';
import { compound, polylineGeom } from '@/geom/shapes';
import { buildPlan } from '../../plan';
import { branchExample } from '../../../../tests/satin-branches/examples';
import { parseProjectFile, serializeProject } from '@/model/schema';
const graph = (...points: number[][]) =>
  buildRunningNetwork(points.map((p) => ({ pts: Float64Array.from(p), closed: false })))!;
const opts = {
  density: 0.4,
  underlay: 'none' as UnderlayKind,
  underlayInset: 0.4,
  zigzagUnderlaySpacing: 2,
  underlayStitchLength: 2,
  shortStitches: true,
  splitAbove: 7,
};
it.each<UnderlayKind>(['none', 'center', 'edge', 'zigzag', 'edgeZigzag', 'centerZigzag', 'centerEdge'])(
  'covers every T arm continuously with %s underlay',
  (underlay) => {
    const run = routeSatinBranches(
      graph([0, 0, 20, 0], [10, 0, 10, 10]),
      1,
      { ...opts, underlay },
      [0, 0],
      [20, 0],
    );
    expect([...run.flags].some((f) => f & (F.JUMP | F.TRIM))).toBe(false);
    expect([...run.xy.slice(0, 2)]).toEqual([0, 0]);
    expect([...run.xy.slice(-2)]).toEqual([20, 0]);
    const tops = [];
    for (let i = 0; i < run.flags.length; i++)
      if (!(run.flags[i] & F.UNDERLAY)) tops.push([run.xy[2 * i], run.xy[2 * i + 1]]);
    // All arms have their full-density top, and the branch underpath precedes its covering top.
    expect(tops.filter(([x, y]) => x < 9 && Math.abs(y) > 0.9).length).toBeGreaterThan(40);
    expect(tops.filter(([x, y]) => x > 11 && Math.abs(y) > 0.9).length).toBeGreaterThan(40);
    expect(tops.filter(([x, y]) => Math.abs(x - 10) > 0.9 && y > 1).length).toBeGreaterThan(40);
    const firstBranchTop = run.flags.findIndex((f, i) => !(f & F.UNDERLAY) && run.xy[2 * i + 1] > 1);
    expect(
      [...run.flags.slice(0, firstBranchTop)].some((f, i) => f & F.TRAVEL && run.xy[2 * i + 1] > 1),
    ).toBe(true);
    for (let i = 1; i < run.flags.length; i++)
      expect(
        Math.hypot(run.xy[2 * i] - run.xy[2 * i - 2], run.xy[2 * i + 1] - run.xy[2 * i - 1]),
      ).toBeLessThan(2.1);
  },
);
it('groups curved degree-two samples and covers each graph segment exactly once after underpaths', () => {
  const g = graph([0, 0, 5, 1, 10, 4, 15, 9, 20, 16], [10, 4, 10, 14]);
  const parts = satinBranchPaths(g, [0, 0], [20, 16]);
  expect(parts.some((p) => p.points.length >= 6)).toBe(true);
  const key = (p: number[], q: number[]) => [p.join(','), q.join(',')].sort().join('|');
  const visits = new Map<string, boolean[]>();
  for (const p of parts)
    for (let i = 2; i < p.points.length; i += 2) {
      const k = key(p.points.slice(i - 2, i), p.points.slice(i, i + 2));
      visits.set(k, [...(visits.get(k) ?? []), p.underpath]);
    }
  expect(visits.size).toBe(g.edges.length);
  for (const flags of visits.values()) {
    expect(flags.at(-1)).toBe(false);
    expect(flags.filter((f) => !f)).toHaveLength(1);
  }
});
it('jumps only between disconnected components', () => {
  const run = routeSatinBranches(graph([0, 0, 20, 0], [10, 0, 10, 10], [40, 0, 50, 0]), 1, opts);
  expect([...run.flags].filter((f) => f & F.JUMP)).toHaveLength(1);
  for (let i = 1; i < run.flags.length; i++)
    if (!(run.flags[i] & F.JUMP))
      expect(
        Math.hypot(run.xy[2 * i] - run.xy[2 * i - 2], run.xy[2 * i + 1] - run.xy[2 * i - 1]),
      ).toBeLessThan(2.1);
});
it('leaves the option off by default and reports bounded-work fallback', () => {
  const geom = compound([
    polylineGeom([
      [0, 0],
      [20, 0],
    ]),
    polylineGeom([
      [10, 0],
      [10, 10],
    ]),
  ]);
  const diag: string[] = [];
  const ctx = {
    settings: DEFAULT_SETTINGS,
    tolerance: 0.05,
    diag: (code: string) => {
      diag.push(code);
    },
  };
  expect(
    satinDef.prepare(geom, satinDef.defaults, createElement('outline', 'satin', ''), ctx).network,
  ).toBeUndefined();
  const oversized = polylineGeom(Array.from({ length: 1002 }, (_, i) => [i, i % 2]));
  expect(
    satinDef.prepare(
      oversized,
      { ...satinDef.defaults, connectBranches: true },
      createElement('outline', 'satin', ''),
      ctx,
    ).network,
  ).toBeUndefined();
  expect(diag).toContain('satin-network-limit');
});
it('reduces the complete fern to zero trims and persists the editable option', () => {
  const before = buildPlan(branchExample(false));
  const d = branchExample(true);
  const reopened = parseProjectFile(serializeProject(d));
  expect(reopened).toEqual(d);
  const after = buildPlan(reopened);
  expect(after.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  expect(before.stats.trims).toBeGreaterThan(5);
  expect(after.stats.trims).toBe(0);
  expect(after.stats.stitches).toBeGreaterThan(900);
});
