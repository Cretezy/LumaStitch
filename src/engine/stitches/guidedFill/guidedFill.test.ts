// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, it } from 'vitest';
import { guidedRows } from './index';
import { makeValid, offset } from '@/geom/clipper';
import { flattenGeom } from '@/geom/flatten';
import { createPointTester } from '@/geom/polygon';
import { rectGeom } from '@/geom/shapes';
import { buildPlan } from '../../plan';
import { COMMAND_MASK, F } from '../../types';
import { stitchExamples } from '../../../../tests/guided-fill/examples';
import { parseProjectFile, serializeProject } from '@/model/schema';

it.each(['parallel', 'copy', 'buffer'] as const)(
  '%s maintains constant spacing along a straight guide',
  (mode) => {
    const area = makeValid(flattenGeom(rectGeom(0, -5, 20, 10)).rings);
    const rows = guidedRows(area, [new Float64Array([-5, 0, 25, 0])], 1, mode, 90);
    const ys = [...new Set(rows.flat().flatMap((p) => [p[1], p[p.length - 1]]))].sort((a, b) => a - b);
    expect(ys.length).toBeGreaterThanOrEqual(9);
    for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeCloseTo(1, 3);
  },
);
it.each(stitchExamples())(
  '$name clips needle chords and travel around holes and persists editable guides',
  ({ design }) => {
    const reopened = parseProjectFile(serializeProject(design));
    expect(reopened).toEqual(design);
    const plan = buildPlan(reopened);
    expect(plan.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(plan.stats.stitches).toBeGreaterThan(300);
    const area = makeValid(flattenGeom(reopened.shapes.guided.geom).rings, 'evenodd');
    const inside = createPointTester(offset(area, 0.06));
    for (let i = 1; i < plan.flags.length; i++) {
      if (plan.flags[i] & COMMAND_MASK) continue;
      const x = plan.x[i],
        y = plan.y[i],
        a = plan.x[i - 1],
        b = plan.y[i - 1];
      for (let t = 0; t <= 1; t += 0.1)
        expect(
          inside(a + (x - a) * t, b + (y - b) * t),
          `segment ${i} crosses boundary (${plan.flags[i]})`,
        ).toBe(true);
      if (!(plan.flags[i] & F.TRAVEL))
        expect(Math.hypot(x - a, y - b), `length at ${i}, flag ${plan.flags[i]}`).toBeLessThanOrEqual(3.1);
    }
    expect(buildPlan(reopened).x).toEqual(plan.x);
  },
);
it('reports a missing guide and rejects excessive offset work', () => {
  const design = stitchExamples()[0].design;
  design.shapes.guided.geom.subpaths = design.shapes.guided.geom.subpaths.filter((s) => s.closed);
  expect(buildPlan(design).diagnostics.some((d) => d.code === 'guided-path' && d.severity === 'error')).toBe(
    true,
  );
  const area = makeValid(flattenGeom(rectGeom(0, 0, 2000, 2000)).rings);
  expect(() => guidedRows(area, [new Float64Array([0, 0, 20, 0])], 0.1, 'parallel', 90)).toThrow(/2000/);
});

it('keeps sub-millimetre disconnected gaps as jumps instead of sewing across them', async () => {
  const { compound, polylineGeom } = await import('@/geom/shapes');
  const design = stitchExamples()[0].design;
  const s = design.shapes.guided;
  s.geom = compound([
    rectGeom(0, 0, 10, 10),
    rectGeom(10.6, 0, 10, 10),
    polylineGeom([
      [-1, 5],
      [22, 5],
    ]),
  ]);
  s.fill!.params = { guideMode: 'parallel', density: 1, pullComp: 0, underlay: 'none' };
  const plan = buildPlan(design);
  const inside = createPointTester(offset(makeValid(flattenGeom(s.geom).rings, 'evenodd'), 0.01));
  expect(plan.stats.trims).toBeGreaterThan(0);
  for (let i = 1; i < plan.flags.length; i++)
    if (!(plan.flags[i] & COMMAND_MASK)) {
      for (let t = 0; t <= 1; t += 0.05)
        expect(
          inside(
            plan.x[i - 1] + (plan.x[i] - plan.x[i - 1]) * t,
            plan.y[i - 1] + (plan.y[i] - plan.y[i - 1]) * t,
          ),
        ).toBe(true);
    }
});
