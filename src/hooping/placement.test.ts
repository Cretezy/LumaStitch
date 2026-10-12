// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, it } from 'vitest';
import { optimizeHoopLayout } from './optimize';
import { placedLayout, toLocal, toWorld } from './placement';
import { splitHoopings } from './split';
import { hoopingArchive } from './archive';
import { placementPreview } from './preview';
import { placementSource, customOptions, gridOptions } from '../../tests/hooping-placements/examples';
import { buildPlan } from '@/engine/plan';
import { COMMAND_MASK } from '@/engine/types';
import { unzipFiles } from '@/library/zip';
import { readMachine } from '@/io/machine/read';
import { MC } from '@/io/pes/machineCommands';
import { multiHoopSchema, parseProjectFile, serializeProject } from '@/model/schema';
import type { Vec2 } from '@/model/types';

it('reduces a diagonal design from nine grid fields to three independently rotated fields', () => {
  const d = placementSource(),
    plan = buildPlan(d),
    parts = splitHoopings(d, customOptions);
  expect(splitHoopings(d, gridOptions)).toHaveLength(9);
  expect(parts).toHaveLength(3);
  const preview = placementPreview(d, customOptions);
  expect(preview).not.toContain('<?xml');
  expect(preview.match(/<svg /g)).toHaveLength(1);
  expect(parts.map((p) => p.angle)).toEqual([45, 40, 50]);
  expect(parts.map((p) => p.registrationParent)).toEqual([null, 1, 2]);
  expect(parts.reduce((n, p) => n + p.originalNeedles, 0)).toBe(plan.stats.stitches);
  expect(parseProjectFile(serializeProject(d)).multiHoop).toEqual(customOptions);
  for (const p of parts) {
    const plan = buildPlan(p.design);
    expect(plan.bounds.minX + plan.bounds.maxX).toBeCloseTo(0, 5);
    expect(plan.bounds.minY + plan.bounds.maxY).toBeCloseTo(0, 5);
    for (const mark of p.marks) {
      const local = toLocal(mark, p);
      expect(Math.abs(local[0])).toBeLessThan(46);
      expect(Math.abs(local[1])).toBeLessThan(46);
    }
    if (p.registrationParent) {
      const parent = parts[p.registrationParent - 1];
      const shared = p.marks.filter((m) => parent.marks.some((n) => m[0] === n[0] && m[1] === n[1]));
      expect(shared).toHaveLength(2);
      expect(Math.hypot(shared[0][0] - shared[1][0], shared[0][1] - shared[1][1])).toBeGreaterThanOrEqual(5);
    }
  }
});
it.each(['pes', 'dst', 'jef', 'exp', 'vp3'])(
  '%s retains all source positions within rotated-file quantization and fits the field',
  async (format) => {
    const d = placementSource(),
      source = buildPlan(d),
      result = hoopingArchive(d, customOptions, format),
      files = await unzipFiles(result.archive),
      points = new Map<string, Vec2[]>();
    for (const p of result.manifest.hoopings) {
      const file = files.find((f) => f.name === p.file)!;
      for (const cmd of readMachine(file.data, format).commands) {
        if (cmd.cmd !== MC.STITCH && cmd.cmd !== MC.JUMP) continue;
        expect(Math.abs(cmd.x)).toBeLessThanOrEqual(470);
        expect(Math.abs(cmd.y)).toBeLessThanOrEqual(470);
        if (cmd.cmd !== MC.STITCH) continue;
        const world = toWorld([cmd.x / 10, cmd.y / 10], { center: p.centerMm, angle: p.clockwiseDegrees }),
          key = `${Math.floor(world[0] * 10)},${Math.floor(world[1] * 10)}`;
        points.set(key, [...(points.get(key) ?? []), world]);
      }
    }
    for (let i = 0; i < source.flags.length; i++)
      if (!(source.flags[i] & COMMAND_MASK)) {
        const x = Math.round(source.x[i] * 10) / 10,
          y = Math.round(source.y[i] * 10) / 10;
        let nearest = Infinity;
        for (let a = -1; a <= 1; a++)
          for (let b = -1; b <= 1; b++)
            for (const p of points.get(`${Math.floor(x * 10) + a},${Math.floor(y * 10) + b}`) ?? [])
              nearest = Math.min(nearest, Math.hypot(p[0] - x, p[1] - y));
        expect(nearest).toBeLessThanOrEqual(Math.SQRT2 * 0.05 + 1e-7);
      }
  },
);
it('checks entire stitch chords, even when both endpoints are covered', () => {
  const layout = placedLayout(
      [
        { center: [0, 0], angle: 0 },
        { center: [60, 0], angle: 0 },
        { center: [60, 60], angle: 0 },
      ],
      94,
      94,
    ),
    a: Vec2 = [-40, 40],
    b: Vec2 = [20, 100];
  expect(layout.locate(a)).toBe(0);
  expect(layout.locate(b)).toBe(2);
  const cuts = layout.cuts(a, b);
  expect(() =>
    cuts.slice(1).forEach((v, i) => {
      const t = (cuts[i] + v) / 2;
      layout.locate([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }),
  ).toThrow(/outside every hoop/);
  expect(() =>
    placedLayout(
      [
        { center: [0, 0], angle: 0 },
        { center: [100, 0], angle: 0 },
      ],
      94,
      94,
    ),
  ).toThrow(/connected overlaps/);
});
it('every continuous ownership interval agrees with independent nearest eligible field selection', () => {
  const fields = customOptions.placements!,
    layout = placedLayout(fields, 94, 94);
  // Deterministic chords through the overlapped, rotated ribbon corridor, crossing field and bisector edges.
  for (let i = 0; i < 80; i++) {
    const a: Vec2 = [i * 2, i * 2 + Math.sin(i) * 5],
      b: Vec2 = [169 - i * 1.8, 169 - i * 1.8 + Math.cos(i) * 5];
    const cuts = layout.cuts(a, b);
    for (let j = 1; j < cuts.length; j++)
      for (const t of [0.01, 0.3, 0.7, 0.99]) {
        const u = cuts[j - 1] + (cuts[j] - cuts[j - 1]) * t,
          p: Vec2 = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
        const eligible = fields
          .map((f, index) => ({
            index,
            p: toLocal(p, f),
            distance: Math.hypot(p[0] - f.center[0], p[1] - f.center[1]),
          }))
          .filter((v) => Math.abs(v.p[0]) <= 46.5 + 1e-7 && Math.abs(v.p[1]) <= 46.5 + 1e-7)
          .sort((a, b) => a.distance - b.distance);
        if (eligible.length) {
          expect(layout.locate(p)).toBe(eligible[0].index);
          const mid = (cuts[j - 1] + cuts[j]) / 2;
          expect(layout.locate([a[0] + (b[0] - a[0]) * mid, a[1] + (b[1] - a[1]) * mid])).toBe(
            eligible[0].index,
          );
        } else expect(() => layout.locate(p)).toThrow(/outside every hoop/);
      }
  }
});
it('uses connected sewing order and rejects malformed persisted placements', () => {
  const placements = [
    { center: [0, 0] as Vec2, angle: 0 },
    { center: [140, 0] as Vec2, angle: 0 },
    { center: [70, 0] as Vec2, angle: 20 },
  ];
  const layout = placedLayout(placements, 94, 94);
  expect(layout.order).toEqual([0, 2, 1]);
  expect(layout.parents).toEqual([null, 2, 0]);
  expect(multiHoopSchema.safeParse({ ...gridOptions, placements: [] }).success).toBe(false);
  expect(
    multiHoopSchema.safeParse({ ...gridOptions, placements: [{ center: [0, 0], angle: Infinity }] }).success,
  ).toBe(false);
});

it('finds the three-field rotated grid without requiring manual coordinate entry', () => {
  const d = placementSource(),
    options = optimizeHoopLayout(d, gridOptions),
    parts = splitHoopings(d, options);
  expect(parts).toHaveLength(3);
  expect(options.placements!.every((p) => Math.abs(p.angle) === 45)).toBe(true);
  expect(parts.reduce((n, p) => n + p.originalNeedles, 0)).toBe(buildPlan(d).stats.stitches);
  const second = optimizeHoopLayout(d, options);
  expect(second).toEqual(options);
});
