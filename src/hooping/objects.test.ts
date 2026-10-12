// SPDX-License-Identifier: GPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { pesFormat } from '@/io/export/pesFormat';
import { expect, it } from 'vitest';
import { buildPlan } from '@/engine/plan';
import { COMMAND_MASK } from '@/engine/types';
import { objectSource, objectOptions } from '../../tests/hooping-objects/examples';
import { assignWholeObjects } from './objects';
import { splitHoopings } from './split';
import { toWorld } from './placement';
import { transformGeom } from '@/geom/pathData';
import { parseProjectFile, serializeProject } from '@/model/schema';
import { machineDesign } from '@/io/machine/import';
import { MC } from '@/io/pes/machineCommands';
import { hoopingArchive } from './archive';
import { createElement } from '@/model/factories';

it('keeps each medallion fill and satin outline together while splitting the oversized border', () => {
  const d = objectSource(),
    before = splitHoopings(d, objectOptions),
    after = splitHoopings(d, { ...objectOptions, keepObjects: true });
  expect(after).toHaveLength(3);
  const whole = after.flatMap((p) => p.wholeObjects);
  expect(whole.map((o) => o.shapeId).sort()).toEqual(['medallion-0', 'medallion-1']);
  expect(whole.every((o) => o.elementIds.length === 2)).toBe(true);
  const goldFields = (parts: typeof after) =>
    parts.filter((p) => buildPlan(p.design).colorBlocks.some((b) => b.color === '#cc9933')).length;
  expect(goldFields(before)).toBe(3);
  expect(goldFields(after)).toBe(2);
  expect(after.reduce((n, p) => n + buildPlan(p.design).stats.trims, 0)).toBeLessThan(
    before.reduce((n, p) => n + buildPlan(p.design).stats.trims, 0),
  );
  expect(after.reduce((n, p) => n + p.originalNeedles, 0)).toBe(buildPlan(d).stats.stitches);
  expect(parseProjectFile(serializeProject(d)).multiHoop?.keepObjects).toBe(true);
});
it('accounts for sewn connectors entering an object from a preceding shape', () => {
  const d = machineDesign(
    {
      name: 'Connected pieces',
      notes: [],
      colors: [{ color: '#123456' }],
      commands: [
        { cmd: MC.STITCH, x: 0, y: 0 },
        { cmd: MC.STITCH, x: 1000, y: 0 },
        { cmd: MC.END, x: 1000, y: 0 },
      ],
    },
    'Connected',
  );
  const first = d.shapes[d.zOrder[0]],
    second = structuredClone(first);
  first.outline!.id = 'first';
  second.id = 'second';
  second.outline!.id = 'second';
  d.shapes.second = second;
  const plan = {
    ...buildPlan(d),
    x: new Float32Array([0, 100]),
    y: new Float32Array([0, 0]),
    flags: new Uint8Array([0, 0]),
    element: new Uint32Array([0, 1]),
    elementIds: ['first', 'second'],
  };
  const result = assignWholeObjects(
    d,
    plan,
    [
      { center: [10, 0], angle: 0 },
      { center: [90, 0], angle: 0 },
    ],
    94,
    94,
  );
  // The second group's own point fits the right hoop, but its incoming sewn chord doesn't.
  expect(result.objects.find((o) => o.shapeId === 'second')).toBeUndefined();
  expect(result.owners[1]).toBe(-1);
});
it('preserves every source needle and whole-object assignment when fields are rotated', () => {
  const d = objectSource(),
    angle = 30,
    a = (angle * Math.PI) / 180,
    c = Math.cos(a),
    s = Math.sin(a);
  const base = splitHoopings(d, objectOptions);
  for (const shape of Object.values(d.shapes)) shape.geom = transformGeom(shape.geom, [c, s, -s, c, 0, 0]);
  const options = {
    ...objectOptions,
    keepObjects: true,
    placements: base.map((p) => ({ center: toWorld(p.center, { center: [0, 0], angle }), angle })),
  };
  const plan = buildPlan(d),
    parts = splitHoopings(d, options);
  expect(parts.flatMap((p) => p.wholeObjects)).toHaveLength(2);
  expect(parts.reduce((n, p) => n + p.originalNeedles, 0)).toBe(plan.stats.stitches);
  const points = parts.flatMap((p) => {
    const plan = buildPlan(p.design);
    return Array.from(plan.flags).flatMap((f, i) =>
      f & COMMAND_MASK ? [] : [toWorld([plan.x[i], plan.y[i]], p)],
    );
  });
  for (let i = 0; i < plan.flags.length; i++)
    if (!(plan.flags[i] & COMMAND_MASK)) {
      const x = Math.round(plan.x[i] * 10) / 10,
        y = Math.round(plan.y[i] * 10) / 10;
      expect(points.some((p) => Math.hypot(p[0] - x, p[1] - y) < 0.071)).toBe(true);
    }
});
it.each(['pes', 'dst', 'jef', 'exp', 'vp3'])(
  '%s exports retained object identities and validates each encoded field',
  (format) => {
    const result = hoopingArchive(objectSource(), { ...objectOptions, keepObjects: true }, format);
    expect(
      result.manifest.hoopings
        .flatMap((p) => p.wholeObjects)
        .map((p) => p.name)
        .sort(),
    ).toEqual(['Medallion 1', 'Medallion 2']);
  },
);

it('keeps overlapping layers on their existing ownership seams', () => {
  const d = objectSource(),
    panel = d.shapes.panel;
  panel.outline = null;
  panel.fill = createElement('fill', 'tatami', 'green', {
    density: 0.65,
    angle: 0,
    pullComp: 0,
    underlay: 'edge',
  });
  d.sequence[0] = { kind: 'element', elementId: panel.fill.id };
  const regular = splitHoopings(d, objectOptions),
    safe = splitHoopings(d, { ...objectOptions, keepObjects: true });
  expect(safe.flatMap((p) => p.wholeObjects)).toHaveLength(0);
  expect(safe.map((p) => buildPlan(p.design).stats)).toEqual(regular.map((p) => buildPlan(p.design).stats));
});

it('reproduces all six committed before/after PES programs used by the rendered examples', () => {
  for (const name of ['before', 'after'])
    for (const p of splitHoopings(objectSource(), { ...objectOptions, keepObjects: name === 'after' })) {
      const bytes = pesFormat.write(buildPlan(p.design), p.design, { version: 6 });
      const expected = new Uint8Array(
        readFileSync(
          new URL(
            `../../docs/hooping-objects/${name}-hoop-${p.number}/${name}-hoop-${p.number}.pes`,
            import.meta.url,
          ),
        ),
      );
      expect(bytes).toEqual(expected);
    }
});
