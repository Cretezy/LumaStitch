// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, it } from 'vitest';
import { splitSatinGeometry, splitSatinShape } from './split';
import { splitExample } from '../../tests/satin-split/examples';
import { columnFromRails } from '@/engine/stitches/satinColumn';
import { colA, colB } from '@/engine/stitches/satin/column';
import { flattenSubpath } from '@/geom/flatten';
import { createDesign, createElement, createShape } from '@/model/factories';
import { polylineGeom, rectGeom, compound } from '@/geom/shapes';
import { buildPlan } from '@/engine/plan';
import { parseProjectFile, serializeProject } from '@/model/schema';
import type { Shape, Vec2 } from '@/model/types';
const column = (s: Shape) => {
  const [a, b, ...r] = s.geom.subpaths.map((p) => flattenSubpath(p, 0.03));
  return columnFromRails(a, b, [
    ...r.map(
      (p) =>
        [
          [p[0], p[1]],
          [p[p.length - 2], p[p.length - 1]],
        ] as [Vec2, Vec2],
    ),
    ...(s.outline!.guides ?? []),
  ]);
};
it.each([0.1, 0.45, 0.9])('preserves paired rails and shared cut endpoints at %s', (fraction) => {
  const d = splitExample(),
    s = d.shapes['ribbon-0'],
    original = column(s),
    pieces = splitSatinShape(s, d, fraction);
  expect(pieces[0].geom.subpaths[0].nodes.at(-1)!.p).toEqual(pieces[1].geom.subpaths[0].nodes[0].p);
  expect(pieces[0].geom.subpaths[1].nodes.at(-1)!.p).toEqual(pieces[1].geom.subpaths[1].nodes[0].p);
  for (const [i, part] of pieces.entries()) {
    const c = column(part),
      start = i ? fraction : 0,
      end = i ? 1 : fraction;
    for (let t = 0; t <= 1; t += 0.05)
      for (const rail of [colA, colB]) {
        const a = rail(c, c.length * t),
          b = rail(original, original.length * (start + (end - start) * t));
        expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeLessThan(0.002);
      }
    expect(part.outline!.params.pullComp).toBe(0.15);
    expect(part.outline!.params.underlay).toBe('edgeZigzag');
    expect(part.outline!.threadId).toBe(s.outline!.threadId);
    expect(part.outline!.entry).toBeUndefined();
    expect(part.outline!.exit).toBeUndefined();
  }
});
it('converts a centerline without baking compensation twice and retains effective underlay', () => {
  const d = createDesign(),
    s = createShape(
      'Straight satin',
      polylineGeom([
        [0, 0],
        [20, 0],
      ]),
      { strokeWidth: 3 },
    );
  s.outline = createElement('outline', 'satin', 'blue', { pullComp: 0.4 });
  const pieces = splitSatinShape(s, d, 0.3);
  const c = column(pieces[0]);
  expect(c.length).toBeCloseTo(6, 6);
  expect(Math.abs(c.a[1] - c.b[1])).toBeCloseTo(3, 6);
  expect(pieces[0].outline!.params.pullComp).toBe(0.4);
  expect(pieces[0].outline!.params.underlay).toBe('edge');
});
it('regenerates stitches and persists both complete editable sections', () => {
  const d = splitExample(true),
    reopened = parseProjectFile(serializeProject(d));
  expect(reopened).toEqual(d);
  const plan = buildPlan(reopened);
  expect(plan.stats.stitches).toBeGreaterThan(400);
  expect(plan.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
});
it('rejects unsupported or invalid splitting inputs', () => {
  const d = createDesign(),
    s = createShape(
      'Satin',
      polylineGeom([
        [0, 0],
        [20, 0],
      ]),
    );
  s.outline = createElement('outline', 'satin', 'blue');
  for (const f of [0, 1, NaN, Infinity]) expect(() => splitSatinGeometry(s, d, f)).toThrow('1%');
  expect(() => splitSatinGeometry({ ...s, locked: true }, d, 0.5)).toThrow('Unlock');
  expect(() => splitSatinGeometry({ ...s, fill: createElement('fill', 'tatami', 'blue') }, d, 0.5)).toThrow(
    'without a fill',
  );
  expect(() => splitSatinGeometry({ ...s, geom: rectGeom(0, 0, 10, 10) }, d, 0.5)).toThrow('Open');
  expect(() => splitSatinGeometry({ ...s, geom: compound([s.geom, s.geom]) }, d, 0.5)).toThrow('single open');
});
