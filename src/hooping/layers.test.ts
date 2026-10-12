// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { layerSource, layerOptions } from '../../tests/hooping-layers/examples';
import { assignWholeObjects } from './objects';
import { splitHoopings } from './split';
import { hoopingArchive } from './archive';
import { toWorld } from './placement';
import { buildPlan } from '@/engine/plan';
import { COMMAND_MASK } from '@/engine/types';
import { createDesign, createShape, createElement } from '@/model/factories';
import { polylineGeom } from '@/geom/shapes';
import { transformGeom } from '@/geom/pathData';
import { pesFormat } from '@/io/export/pesFormat';

it('keeps complete touching layer groups in one field and preserves their sew order', () => {
  const d = layerSource(),
    before = splitHoopings(d, layerOptions),
    after = splitHoopings(d, { ...layerOptions, keepObjects: true });
  expect(after.flatMap((p) => p.wholeObjects)).toHaveLength(4);
  for (const i of [0, 1]) {
    const field = after.find((p) => p.wholeObjects.some((o) => o.shapeId === `background-${i}`))!;
    expect(field.wholeObjects.map((o) => o.shapeId)).toEqual([`background-${i}`, `star-${i}`]);
    expect(field.wholeObjects.every((o) => o.layerGroup === `background-${i}`)).toBe(true);
    const blocks = buildPlan(field.design).colorBlocks.map((b) => b.color);
    expect(blocks).toContain('#c89432');
    expect(blocks).toContain('#eee0bb');
    expect(blocks.indexOf('#c89432')).toBeLessThan(blocks.indexOf('#eee0bb'));
  }
  expect(after.reduce((n, p) => p.originalNeedles + n, 0)).toBe(buildPlan(d).stats.stitches);
  expect(after.reduce((n, p) => buildPlan(p.design).stats.trims + n, 0)).toBeLessThan(
    before.reduce((n, p) => buildPlan(p.design).stats.trims + n, 0),
  );
});

it('requires a shared field for the entire transitive contact group, not just adjacent pairs', () => {
  const d = createDesign();
  d.threads.t = { id: 't', color: '#123456', name: 'Blue' };
  for (const [i, x] of [0, 30, 60].entries()) {
    const s = createShape(
      `Line ${i}`,
      polylineGeom([
        [x, 0],
        [x, 0],
        [x + 40, 0],
      ]),
    );
    s.id = `shape-${i}`;
    s.geom.subpaths[0].nodes[0].command = 'jump';
    s.outline = createElement('outline', 'manual', 't', { preserveCommands: true });
    d.shapes[s.id] = s;
    d.zOrder.push(s.id);
    d.sequence.push({ kind: 'element', elementId: s.outline.id });
  }
  const p = buildPlan(d),
    fields = [
      { center: [35, 0] as [number, number], angle: 0 },
      { center: [65, 0] as [number, number], angle: 0 },
    ];
  const split = assignWholeObjects(d, p, fields, 94, 94);
  expect(split.objects).toEqual([]);
  expect([...split.owners]).toEqual([-1, -1, -1]);
  const fit = assignWholeObjects(d, p, [{ center: [50, 0], angle: 0 }], 110, 94);
  expect(fit.objects).toHaveLength(3);
  expect(fit.objects.every((o) => o.layerGroup === 'shape-0')).toBe(true);
  expect([...fit.owners]).toEqual([0, 0, 0]);
});

it('keeps rotated layer groups whole and retains every quantized source penetration', () => {
  const d = layerSource(),
    angle = 31,
    a = (angle * Math.PI) / 180,
    c = Math.cos(a),
    s = Math.sin(a);
  const base = splitHoopings(d, layerOptions);
  for (const shape of Object.values(d.shapes)) shape.geom = transformGeom(shape.geom, [c, s, -s, c, 0, 0]);
  const p = buildPlan(d),
    parts = splitHoopings(d, {
      ...layerOptions,
      keepObjects: true,
      placements: base.map((p) => ({ center: toWorld(p.center, { center: [0, 0], angle }), angle })),
    });
  expect(parts.flatMap((p) => p.wholeObjects)).toHaveLength(4);
  const points = parts.flatMap((p) => {
    const plan = buildPlan(p.design);
    return [...plan.flags].flatMap((f, i) => (f & COMMAND_MASK ? [] : [toWorld([plan.x[i], plan.y[i]], p)]));
  });
  for (let i = 0; i < p.flags.length; i++)
    if (!(p.flags[i] & COMMAND_MASK)) {
      const x = Math.round(p.x[i] * 10) / 10,
        y = Math.round(p.y[i] * 10) / 10;
      expect(points.some((q) => Math.hypot(q[0] - x, q[1] - y) < 0.071)).toBe(true);
    }
});
it.each(['pes', 'dst', 'jef', 'exp', 'vp3'])(
  'exports grouped layers and verifies the encoded %s fields',
  (format) => {
    const r = hoopingArchive(layerSource(), { ...layerOptions, keepObjects: true }, format);
    expect(
      r.manifest.hoopings.flatMap((p) => p.wholeObjects).every((o) => typeof o.layerGroup === 'string'),
    ).toBe(true);
    expect(r.manifest.hoopings.flatMap((p) => p.wholeObjects)).toHaveLength(4);
  },
);
it('reproduces all six illustrated machine programs', () => {
  for (const name of ['before', 'after'])
    for (const p of splitHoopings(layerSource(), { ...layerOptions, keepObjects: name === 'after' })) {
      const file = `docs/hooping-layers/${name}-hoop-${p.number}/${name}-hoop-${p.number}.pes`;
      expect(pesFormat.write(buildPlan(p.design), p.design, { version: 6 })).toEqual(
        new Uint8Array(readFileSync(file)),
      );
    }
});

function coincidentObjects(count: number) {
  const d = createDesign();
  d.threads.t = { id: 't', name: 'Blue', color: '#123456' };
  for (let i = 0; i < count; i++) {
    const s = createShape(`Point ${i}`, polylineGeom([[0, 0]]));
    s.id = `point-${i}`;
    s.outline = createElement('outline', 'manual', 't', { preserveCommands: true });
    d.shapes[s.id] = s;
    d.zOrder.push(s.id);
    d.sequence.push({ kind: 'element', elementId: s.outline.id });
  }
  return d;
}
it('uses linear group metadata even when many source objects touch', () => {
  const d = coincidentObjects(500);
  const r = assignWholeObjects(d, buildPlan(d), [{ center: [0, 0], angle: 0 }], 94, 94);
  expect(r.objects).toHaveLength(500);
  expect(r.objects.every((o) => o.layerGroup === 'point-0')).toBe(true);
  expect(JSON.stringify(r.objects).length).toBeLessThan(500 * 300);
});
it('bounds dense-cell work even after all objects join the same group', () => {
  const d = coincidentObjects(8000);
  expect(() => assignWholeObjects(d, buildPlan(d), [{ center: [0, 0], angle: 0 }], 94, 94)).toThrow(
    /work limit/,
  );
});
