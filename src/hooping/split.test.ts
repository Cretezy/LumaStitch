// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, it } from 'vitest';
import { createDesign, createElement, createShape } from '@/model/factories';
import { polylineGeom, rectGeom } from '@/geom/shapes';
import { buildPlan } from '@/engine/plan';
import { COMMAND_MASK } from '@/engine/types';
import { hoopFit } from '@/engine/hoop';
import { splitHoopings } from './split';
import { hoopingArchive } from './archive';
import { unzipFiles } from '@/library/zip';
import { readMachine } from '@/io/machine/read';
import { MC } from '@/io/pes/machineCommands';
import { parseProjectFile, serializeProject } from '@/model/schema';

const options = { width: 100, height: 100, margin: 3, overlap: 12 };
function example() {
  const d = createDesign({ name: 'Across three fields' });
  d.threads.blue = { id: 'blue', color: '#123456', name: 'Original', code: 'ORIG' };
  const s = createShape(
    'Long path',
    polylineGeom([
      [0, 0],
      [220, 40],
      [0, 50],
    ]),
  );
  s.outline = createElement('outline', 'running', 'blue');
  d.shapes[s.id] = s;
  d.zOrder = [s.id];
  d.sequence = [{ kind: 'element', elementId: s.outline.id }];
  return d;
}
it('retains all source penetrations, shares registration pairs and fits every field', () => {
  const source = example(),
    original = buildPlan(source),
    parts = splitHoopings(source, options);
  expect(parts).toHaveLength(3);
  expect(parts.reduce((n, p) => n + p.originalNeedles, 0)).toBe(original.stats.stitches);
  expect(
    parts[0].marks.filter((a) => parts[1].marks.some((b) => a[0] === b[0] && a[1] === b[1])),
  ).toHaveLength(2);
  const points = new Set<string>();
  for (const part of parts) {
    expect(parseProjectFile(serializeProject(part.design))).toEqual(part.design);
    const plan = buildPlan(part.design);
    expect(hoopFit(plan, part.design.hoop!).outside).toBe(0);
    expect(plan.bounds.minX + plan.bounds.maxX).toBeCloseTo(0, 5);
    expect(plan.bounds.minY + plan.bounds.maxY).toBeCloseTo(0, 5);
    for (let i = 0; i < plan.flags.length; i++)
      if (!(plan.flags[i] & COMMAND_MASK))
        points.add(
          `${Math.round((plan.x[i] + part.center[0]) * 10)},${Math.round((plan.y[i] + part.center[1]) * 10)}`,
        );
  }
  for (let i = 0; i < original.flags.length; i++)
    if (!(original.flags[i] & COMMAND_MASK))
      expect(points.has(`${Math.round(original.x[i] * 10)},${Math.round(original.y[i] * 10)}`)).toBe(true);
});
it.each(['pes', 'dst', 'jef', 'exp', 'vp3'])(
  '%s package decodes inside every declared field',
  async (format) => {
    const result = hoopingArchive(example(), options, format),
      files = await unzipFiles(result.archive);
    expect(result.manifest.hoopings).toHaveLength(3);
    expect(files.some((f) => f.name === 'source.lumastitch')).toBe(true);
    for (const file of files.filter((f) => f.name.endsWith(`.${format}`))) {
      const parsed = readMachine(file.data, format);
      for (const p of parsed.commands.filter((p) => p.cmd === MC.STITCH || p.cmd === MC.JUMP)) {
        expect(Math.abs(p.x)).toBeLessThanOrEqual(470);
        expect(Math.abs(p.y)).toBeLessThanOrEqual(470);
      }
    }
  },
);
it('retains stage stops in every hoop touched by an appliqué phase and rejects excessive layouts', () => {
  const d = example(),
    s = d.shapes[d.zOrder[0]];
  s.geom = rectGeom(0, 0, 160, 40);
  s.outline = null;
  s.fill = createElement('fill', 'applique', 'blue');
  d.sequence = [{ kind: 'element', elementId: s.fill.id }];
  const source = buildPlan(d),
    parts = splitHoopings(d, options);
  expect(source.stats.stops).toBeGreaterThan(0);
  for (const p of parts)
    expect(buildPlan(p.design).stats.stops).toBeGreaterThanOrEqual(source.stats.stops + 1);
  expect(() => splitHoopings(d, { width: 30, height: 30, margin: 10, overlap: 12 })).toThrow();
  s.geom = rectGeom(0, 0, 5000, 5000);
  s.fill!.type = 'contour';
  s.fill!.params = { spacing: 5 };
  expect(() => splitHoopings(d, options)).toThrow(/limit|limited/);
});

it('joins nearby continuous fill rows at a seam without changing source penetration coverage', () => {
  const d = example(),
    s = d.shapes[d.zOrder[0]];
  s.geom = rectGeom(0, 0, 160, 30);
  s.outline = null;
  s.fill = createElement('fill', 'tatami', 'blue', { density: 0.4, angle: 0, underlay: 'none', pullComp: 0 });
  d.sequence = [{ kind: 'element', elementId: s.fill.id }];
  const joined = splitHoopings(d, options),
    cut = splitHoopings(d, { ...options, joinSeams: false });
  expect(joined.reduce((n, p) => n + buildPlan(p.design).stats.trims, 0)).toBeLessThan(
    cut.reduce((n, p) => n + buildPlan(p.design).stats.trims, 0) / 2,
  );
  expect(joined.map((p) => p.originalNeedles)).toEqual(cut.map((p) => p.originalNeedles));
});
it('orders two-dimensional fields continuously and shares pairs across both axes', () => {
  const d = example(),
    s = d.shapes[d.zOrder[0]];
  s.geom = polylineGeom([
    [0, 0],
    [150, 150],
  ]);
  const parts = splitHoopings(d, options);
  expect(parts.map((p) => [p.row, p.column])).toEqual([
    [0, 0],
    [0, 1],
    [1, 1],
    [1, 0],
  ]);
  for (let i = 1; i < parts.length; i++)
    expect(
      parts[i].marks.filter((a) => parts[i - 1].marks.some((b) => a[0] === b[0] && a[1] === b[1])).length,
    ).toBeGreaterThanOrEqual(2);
});
