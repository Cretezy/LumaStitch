// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, it } from 'vitest';
import { buildPlan } from './plan';
import { createDesign, createElement, createShape } from '@/model/factories';
import { polylineGeom } from '@/geom/shapes';
import { hoopFit, hoopWarnings } from './hoop';
import { parseProjectFile, serializeProject } from '@/model/schema';
import { pesFormat } from '@/io/export/pesFormat';
import { dstFormat, expFormat, jefFormat, vp3Format } from '@/io/export/machineFormats';

it('checks actual needle positions in rectangular and elliptical fields and persists the optional field', () => {
  const d = createDesign();
  d.threads.t = { id: 't', name: 'Blue', color: '#123456' };
  const s = createShape(
    'Corners',
    polylineGeom(
      [
        [20, 30],
        [100, 30],
        [100, 110],
        [20, 110],
      ],
      true,
    ),
  );
  s.outline = createElement('outline', 'running', 't');
  d.shapes[s.id] = s;
  d.zOrder = [s.id];
  d.sequence = [{ kind: 'element', elementId: s.outline.id }];
  const plan = buildPlan(d);
  expect(hoopWarnings(plan)).toEqual([]);
  d.hoop = { width: 100, height: 100, margin: 0, shape: 'rectangle' };
  expect(hoopFit(plan, d.hoop).outside).toBe(0);
  d.hoop.shape = 'ellipse';
  expect(hoopFit(plan, d.hoop).outside).toBeGreaterThan(0);
  for (const format of [pesFormat, dstFormat, expFormat, jefFormat, vp3Format])
    expect(format.validate(plan, d).some((v) => v.code === 'export.hoop')).toBe(true);
  d.hoop.shape = 'rectangle';
  d.hoop.margin = 11;
  expect(hoopFit(plan, d.hoop).outside).toBeGreaterThan(0);
  expect(parseProjectFile(serializeProject(d)).hoop).toEqual(d.hoop);
});
