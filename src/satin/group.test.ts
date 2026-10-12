// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { readPes, writePes } from '@/io/pes';
import { MC } from '@/io/pes/machineCommands';
import {
  buildRailNetwork,
  railBranchParts,
  routeRailNetwork,
  sliceRailColumn,
} from '@/engine/stitches/satinColumn/network';
import { columnFromRails } from '@/engine/stitches/satinColumn';
import type { UnderlayKind } from '@/engine/stitches/satin/column';
import { F } from '@/engine/types';
import { railExample } from '../../tests/satin-rails/examples';
import { groupSatinColumns, ungroupSatinColumns } from './group';
import { buildPlan, createPlanCache } from '@/engine/plan';
import { parseProjectFile, serializeProject } from '@/model/schema';
const horizontal = columnFromRails(
  new Float64Array([0, -1, 10, -2, 20, -3]),
  new Float64Array([0, 1, 10, 2, 20, 3]),
);
const vertical = columnFromRails(new Float64Array([9, 0, 8, 10]), new Float64Array([11, 0, 12, 10]));
const columns = [horizontal, vertical],
  network = buildRailNetwork(columns)!;
const opts = {
  density: 0.4,
  underlayInset: 0.4,
  zigzagUnderlaySpacing: 2,
  underlayStitchLength: 2,
  shortStitches: false,
  splitAbove: 7,
};
it.each<UnderlayKind>(['none', 'center', 'edge', 'zigzag', 'centerEdge', 'centerZigzag', 'edgeZigzag'])(
  'keeps changing rail widths and continuous traversal with %s underlay',
  (underlay) => {
    const run = routeRailNetwork(
      network,
      columns.map((col) => ({ col, ...opts, underlay })),
      [0, 0],
      [20, 0],
    );
    expect([...run.flags].some((f) => f & F.JUMP)).toBe(false);
    let left = 0,
      right = 0;
    for (let i = 0; i < run.flags.length; i++) {
      const x = run.xy[2 * i],
        y = run.xy[2 * i + 1];
      if (!(run.flags[i] & F.UNDERLAY) && Math.abs(y) > 0.5 && (x < 8 || x > 12)) {
        expect(Math.abs(y)).toBeCloseTo(1 + x / 10, 4);
        if (x < 8) left++;
        else right++;
      }
    }
    expect(left).toBeGreaterThan(20);
    expect(right).toBeGreaterThan(20);
    expect([...run.xy.slice(-2)]).toEqual([20, 0]);
  },
);
it('covers each original source interval exactly once and slices rails without recomputing widths', () => {
  const parts = railBranchParts(network, [0, 0], [20, 0]);
  for (const [source, col] of columns.entries()) {
    const tops = parts.filter((p) => p.source === source && !p.underpath);
    expect(tops.reduce((sum, p) => sum + Math.abs(p.end - p.start), 0)).toBeCloseTo(col.length, 6);
  }
  const cut = sliceRailColumn(horizontal, 15, 5);
  expect([...cut.a.slice(0, 2)]).toEqual([15, -2.5]);
  expect([...cut.b.slice(-2)]).toEqual([5, 1.5]);
});
it('routes the complete variable-width vine without trims and preserves project/ungrouped geometry', () => {
  const before = railExample(false),
    after = railExample(),
    a = buildPlan(before),
    b = buildPlan(after);
  expect(a.stats.trims).toBeGreaterThan(0);
  expect(b.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  expect(b.stats.trims).toBe(0);
  expect(b.stats.stitches).toBeGreaterThan(1000);
  expect(parseProjectFile(serializeProject(after))).toEqual(after);
  const restored = ungroupSatinColumns(after.shapes.vine);
  expect(restored).toHaveLength(before.zOrder.length);
  restored.forEach((s, i) => {
    expect(s.geom.subpaths.slice(0, 2)).toEqual(before.shapes[before.zOrder[i]].geom.subpaths.slice(0, 2));
    expect(s.outline!.satinGroups).toBeUndefined();
  });
});
it('rejects mixed settings, stops, interleaving and stale group topology', () => {
  const d = railExample(false);
  d.shapes.stem.outline!.params.density = 0.7;
  expect(() => groupSatinColumns(d, d.zOrder)).toThrow('same thread');
  d.shapes.stem.outline!.params.density = 0.42;
  d.sequence.splice(1, 0, { kind: 'stop', id: 'pause' });
  expect(() => groupSatinColumns(d, d.zOrder)).toThrow('sewing sequence');
  const grouped = railExample();
  grouped.shapes.vine.geom.subpaths.pop();
  expect(buildPlan(grouped).diagnostics.some((d) => d.message.includes('topology changed'))).toBe(true);
});
it('cached group runs follow rail and guide edits', () => {
  const d = railExample(),
    cache = createPlanCache(),
    before = buildPlan(d, { cache });
  const changed = structuredClone(d);
  changed.shapes.vine.geom.subpaths[0].nodes[0].p[0] -= 1;
  const cached = buildPlan(changed, { cache });
  expect(cached).toEqual(buildPlan(changed));
  expect(cached.x).not.toEqual(before.x);
});

it('reuses a prior center walk as center underlay instead of sewing two redundant passes', () => {
  const run = routeRailNetwork(
    network,
    columns.map((col) => ({ col, ...opts, underlay: 'centerEdge' })),
    [0, 0],
    [20, 0],
  );
  const central = [];
  for (let i = 0; i < run.flags.length; i++)
    if (
      run.flags[i] & F.UNDERLAY &&
      Math.abs(run.xy[2 * i] - 10) < 1e-6 &&
      run.xy[2 * i + 1] > 3 &&
      run.xy[2 * i + 1] < 9
    )
      central.push(run.xy[2 * i + 1]);
  expect(central).toHaveLength(3);
  expect(central.slice().sort((a, b) => a - b)).toEqual([4, 6, 8]);
});

it('retains coincident source columns and trims between disconnected components', () => {
  const duplicate = buildRailNetwork([horizontal, horizontal])!;
  const parts = railBranchParts(duplicate);
  for (const source of [0, 1])
    expect(
      parts
        .filter((p) => p.source === source && !p.underpath)
        .reduce((sum, p) => sum + Math.abs(p.end - p.start), 0),
    ).toBeCloseTo(20, 6);
  const far = columnFromRails(new Float64Array([40, -1, 50, -1]), new Float64Array([40, 1, 50, 1]));
  const run = routeRailNetwork(
    buildRailNetwork([horizontal, far])!,
    [horizontal, far].map((col) => ({ col, ...opts, underlay: 'edge' })),
  );
  expect([...run.flags].filter((f) => f & F.JUMP)).toEqual([F.JUMP | F.TRIM]);
});

it.each(['before', 'after'])('%s reproduces every exported needle and the committed machine file', (name) => {
  const base = `docs/satin-rails/${name}/${name}`,
    d = parseProjectFile(readFileSync(`${base}.lumastitch`, 'utf8')),
    p = buildPlan(d),
    bytes = writePes(p, d, { version: 6 });
  expect(bytes).toEqual(new Uint8Array(readFileSync(`${base}.pes`)));
  const expected = [];
  for (let i = 0; i < p.flags.length; i++)
    if (!(p.flags[i] & (F.JUMP | F.TRIM | F.STOP | F.COLOR_CHANGE | F.END)))
      expected.push([Math.round(p.x[i] * 10) || 0, Math.round(p.y[i] * 10) || 0]);
  expect(
    readPes(bytes)
      .commands.filter((c) => c.cmd === MC.STITCH)
      .map((c) => [c.x, c.y]),
  ).toEqual(expected);
});
