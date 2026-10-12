// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, it } from 'vitest';
import { appliqueExample } from '../../tests/applique/examples';
import { buildPlan, createPlanCache } from '@/engine/plan';
import { appliqueDef } from '@/engine/stitches/applique';
import { F } from '@/engine/types';
import { appliqueCuttingArchive } from './cutting';
import { unzipFiles } from '@/library/zip';
import { parseProjectFile } from '@/model/schema';
import { makeValid, offset } from '@/geom/clipper';
import { flattenGeom } from '@/geom/flatten';
import { createElement, createDesign, createShape, DEFAULT_SETTINGS } from '@/model/factories';
import { compound, rectGeom } from '@/geom/shapes';
import { resolveParams } from '@/engine/params/resolve';
import { readPes, writePes } from '@/io/pes';
const ctx = { settings: DEFAULT_SETTINGS, tolerance: 0.05, diag() {} };
it('removes only cover sections and retains the first two phases and their stops', () => {
  const d = appliqueExample(false),
    shape = d.shapes.lower,
    el = shape.fill!;
  const p = resolveParams(el, d.fabric),
    clip = offset(makeValid(flattenGeom(d.shapes.upper.geom, 0.05).rings), -1.5);
  const a = appliqueDef.route(appliqueDef.prepare(shape.geom, p, el, ctx), {}, ctx);
  const b = appliqueDef.route(
    appliqueDef.prepare(shape.geom, { ...p, partialCover: true }, el, { ...ctx, appliqueCoverClip: clip }),
    {},
    ctx,
  );
  const stop = a.flags.findIndex(
    (f, i) => i > 0 && Boolean(f & F.STOP) && a.flags.slice(0, i).some((v) => v & F.STOP),
  );
  expect([...b.xy.slice(0, stop * 2)]).toEqual([...a.xy.slice(0, stop * 2)]);
  expect([...b.flags.slice(0, stop)]).toEqual([...a.flags.slice(0, stop)]);
  expect(b.flags.length).toBeLessThan(a.flags.length - 50);
  expect([...b.flags].filter((f) => f & F.STOP)).toHaveLength(2);
});
it('pre-cut mode skips only the trimming stop and PES retains placement stops', () => {
  const before = buildPlan(appliqueExample(false)),
    d = appliqueExample(true),
    after = buildPlan(d);
  expect(before.stats.stops).toBe(4);
  expect(after.stats.stops).toBe(2);
  expect(after.stats.stitches).toBeLessThan(before.stats.stitches);
  const pes = readPes(writePes(after, d, { version: 6 }));
  expect(pes.stopCount).toBe(2);
  expect(pes.stitchCount).toBe(after.stats.stitches);
});
it('invalidates cached partial covers when later geometry, width or sequence changes', () => {
  const d = appliqueExample(true),
    cache = createPlanCache();
  const original = buildPlan(d, { cache });
  const changed = structuredClone(d);
  changed.shapes.upper.fill!.params.width = 7;
  expect(buildPlan(changed, { cache })).toEqual(buildPlan(changed));
  expect(buildPlan(changed).stats.stitches).not.toBe(original.stats.stitches);
  changed.sequence.reverse();
  expect(buildPlan(changed, { cache })).toEqual(buildPlan(changed));
  changed.shapes.upper.hidden = true;
  expect(buildPlan(changed, { cache })).toEqual(buildPlan(changed));
});
it('keeps visible cover inside a later patch hole and handles a completely covered patch', () => {
  const shape = createShape('Base', rectGeom(0, 0, 10, 10));
  shape.fill = createElement('fill', 'applique', 'green');
  const clip = makeValid(
    flattenGeom(compound([rectGeom(-20, -20, 50, 50), rectGeom(-5, -5, 20, 20)]), 0.05).rings,
    'evenodd',
  );
  const params = { ...appliqueDef.defaults, partialCover: true };
  const visible = appliqueDef.prepare(shape.geom, params, shape.fill, { ...ctx, appliqueCoverClip: clip });
  expect(visible.covers?.length).toBeGreaterThan(0);
  const hidden = appliqueDef.prepare(shape.geom, params, shape.fill, {
    ...ctx,
    appliqueCoverClip: makeValid(flattenGeom(rectGeom(-20, -20, 50, 50), 0.05).rings),
  });
  expect(hidden.covers).toEqual([]);
  expect([...appliqueDef.route(hidden, {}, ctx).flags].filter((f) => f & F.STOP)).toHaveLength(2);
});
it('exports numbered SVG/DXF pieces with holes, millimetre units and an editable source', async () => {
  const d = appliqueExample(true),
    result = appliqueCuttingArchive(d, d.appliqueCut!),
    files = await unzipFiles(result.archive);
  expect(result.manifest.pieces).toHaveLength(2);
  expect(result.manifest.pieces[0].holes).toBe(1);
  const text = (name: string) => new TextDecoder().decode(files.find((f) => f.name === name)!.data);
  expect(text('piece-001.svg')).toContain('mm"');
  expect(text('piece-001.svg').match(/Z/g)).toHaveLength(2);
  expect(text('piece-001.dxf')).toContain('$INSUNITS\n70\n4');
  expect(text('piece-001.dxf').match(/LWPOLYLINE/g)).toHaveLength(2);
  expect(text('sheet.svg')).not.toContain('<text');
  expect(text('layout.svg')).toContain('<text');
  expect(parseProjectFile(text('source.lumastitch'))).toEqual(d);
});
it('offsets fabric independently of compensation, mirrors locally, and rejects unsafe allowances', () => {
  const d = createDesign(),
    s = createShape('Triangle', {
      fillRule: 'nonzero',
      subpaths: [{ closed: true, nodes: [{ p: [0, 0] }, { p: [30, 0] }, { p: [0, 20] }] }],
    });
  s.id = 'tri';
  s.fill = createElement('fill', 'applique', 'green', { width: 3, pullComp: 1 });
  s.fill.id = 'tri-fill';
  d.shapes.tri = s;
  d.zOrder = ['tri'];
  d.threads.green = { id: 'green', name: 'Green', color: '#123456' };
  d.sequence = [{ kind: 'element', elementId: s.fill.id }];
  const options = { allowance: 0, mirror: false, sheetWidth: 100 },
    a = appliqueCuttingArchive(d, options),
    b = appliqueCuttingArchive(d, { ...options, allowance: 0.3 });
  expect(b.manifest.pieces[0].widthMm).toBeGreaterThan(a.manifest.pieces[0].widthMm);
  expect(appliqueCuttingArchive(d, { ...options, mirror: true }).layout).not.toBe(a.layout);
  s.fill.params.pullComp = 0;
  expect(appliqueCuttingArchive(d, options).layout).toBe(a.layout);
  expect(() => appliqueCuttingArchive(d, { ...options, allowance: 1.5 })).toThrow('half the cover');
});
