// SPDX-License-Identifier: GPL-3.0-or-later
import { beforeEach, expect, it } from 'vitest';
import { DEFAULT_LETTERING, layoutLettering } from './layout';
import { polylineGeom } from '@/geom/shapes';
import { geomBBox, transformGeomM } from '@/model/geomOps';
import { translate, scale } from '@/geom/matrix';
import { createDesign, createElement, createShape } from '@/model/factories';
import { parseProjectFile, serializeProject } from '@/model/schema';
import { setLettering } from '@/store/commands/lettering';
import { useDoc } from '@/store/documentStore';
import { useUi } from '@/store/uiStore';
import { setShapeGeom, transformShapes } from '@/store/commands';
import { letteringBatch } from './batch';
import { buildPlan } from '@/engine/plan';
const options = {
  ...DEFAULT_LETTERING,
  text: 'ABC',
  baseline: polylineGeom([
    [20, 30],
    [140, 30],
  ]),
};
beforeEach(() => {
  useUi.getState().setSim({ active: false });
  useDoc.getState().load(createDesign(), 'test');
});
it('places letters rigidly at the baseline tangent with alignment and normal offset', () => {
  const plain = layoutLettering({ ...DEFAULT_LETTERING, text: 'ABC' }, 't', '#123456');
  const path = layoutLettering(options, 't', '#123456');
  const offset = layoutLettering({ ...options, baselineOffset: 4 }, 't', '#123456');
  for (let i = 0; i < plain.length; i++) {
    const a = geomBBox(plain[i].geom),
      b = geomBBox(path[i].geom),
      c = geomBBox(offset[i].geom);
    expect(b.minX - a.minX).toBeCloseTo(20, 6);
    expect(b.minY - a.minY).toBeCloseTo(30, 6);
    expect(c.minY - b.minY).toBeCloseTo(4, 6);
    expect(b.maxX - b.minX).toBeCloseTo(a.maxX - a.minX, 6);
  }
  const center = layoutLettering({ ...options, align: 'center' }, 't', '#123456'),
    right = layoutLettering({ ...options, align: 'right' }, 't', '#123456');
  const shift = geomBBox(center[0].geom).minX - geomBBox(path[0].geom).minX;
  expect(shift).toBeGreaterThan(20);
  expect(geomBBox(right[0].geom).minX - geomBBox(path[0].geom).minX).toBeCloseTo(shift * 2, 6);
  const reversed = layoutLettering({ ...options, baselineReverse: true }, 't', '#123456');
  expect(geomBBox(reversed[0].geom).minX).toBeGreaterThan(100);
});
it('rejects short, closed and multiline baselines without losing text', () => {
  expect(() =>
    layoutLettering(
      {
        ...options,
        baseline: polylineGeom([
          [0, 0],
          [5, 0],
        ]),
      },
      't',
      '#123456',
    ),
  ).toThrow('Text needs');
  expect(() =>
    layoutLettering(
      {
        ...options,
        baseline: polylineGeom(
          [
            [0, 0],
            [50, 0],
            [50, 50],
          ],
          true,
        ),
      },
      't',
      '#123456',
    ),
  ).toThrow('open path');
  expect(() => layoutLettering({ ...options, text: 'A\nB' }, 't', '#123456')).toThrow('one line');
});
it('reflows baseline node edits and restores the complete block with undo', () => {
  const id = setLettering(options, '#123456'),
    before = useDoc.getState().design!,
    g = before.lettering![id],
    sid = g.baselineShapeId!;
  expect(g.shapeIds).toContain(sid);
  expect(before.sequence).toHaveLength(g.shapeIds.length - 1);
  setShapeGeom(sid, transformGeomM(before.shapes[sid].geom, translate(5, 7)));
  const after = useDoc.getState().design!;
  expect(after.lettering![id]).toBeDefined();
  expect(
    geomBBox(after.shapes[g.shapeIds[0]].geom).minX - geomBBox(before.shapes[g.shapeIds[0]].geom).minX,
  ).toBeCloseTo(5, 6);
  expect(parseProjectFile(serializeProject(after))).toEqual(after);
  useDoc.getState().undo();
  expect(useDoc.getState().design).toEqual(before);
  useDoc.getState().redo();
  expect(useDoc.getState().design).toEqual(after);
});
it('keeps group transforms and supports moving the baseline alone without detaching text', () => {
  const id = setLettering(options, '#123456'),
    g = useDoc.getState().design!.lettering![id];
  transformShapes(g.shapeIds, scale(2));
  const before = useDoc.getState().design!,
    sid = g.baselineShapeId!;
  transformShapes([sid], translate(3, 4));
  const after = useDoc.getState().design!;
  expect(after.lettering![id].matrix).toEqual(scale(2));
  expect(
    geomBBox(after.shapes[g.shapeIds[0]].geom).minX - geomBBox(before.shapes[g.shapeIds[0]].geom).minX,
  ).toBeCloseTo(3, 6);
  setLettering({ ...after.lettering![id].options, text: 'AB' }, '#123456', id);
  expect(useDoc.getState().design!.lettering![id].matrix).toEqual(scale(2));
});
it('rejects baseline edits that cannot fit, and retains metadata on no-op geometry edits', () => {
  const id = setLettering(options, '#123456'),
    before = useDoc.getState().design!,
    sid = before.lettering![id].baselineShapeId!;
  setShapeGeom(
    sid,
    polylineGeom([
      [0, 0],
      [2, 0],
    ]),
  );
  expect(useDoc.getState().design).toBe(before);
  setShapeGeom(sid, structuredClone(before.shapes[sid].geom));
  expect(useDoc.getState().design!.lettering![id]).toBeDefined();
});
it('consumes a source path in one undo step and keeps baseline guides out of batch stitches', () => {
  const d = createDesign(),
    source = createShape('Source path', options.baseline);
  source.outline = createElement('outline', 'running', 't');
  d.shapes[source.id] = source;
  d.zOrder = [source.id];
  d.threads.t = { id: 't', name: 'Thread', color: '#123456' };
  d.sequence = [{ kind: 'element', elementId: source.outline.id }];
  useDoc.getState().load(d, 'test');
  const id = setLettering(options, '#123456', undefined, source.id),
    after = useDoc.getState().design!;
  expect(after.shapes[source.id]).toBeUndefined();
  expect(after.lettering![id].baselineShapeId).toBeDefined();
  useDoc.getState().undo();
  expect(useDoc.getState().design).toEqual(d);
  const batch = letteringBatch(['ABC', 'DEF'], options, '#123456');
  for (const item of batch) {
    expect(item.lettering!.text.baselineShapeId).toBeDefined();
    expect(buildPlan(item).diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  }
});
