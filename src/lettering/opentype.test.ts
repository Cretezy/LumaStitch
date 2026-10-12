// SPDX-License-Identifier: GPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { beforeEach, expect, it } from 'vitest';
import { inspectFont, prepareOpenType } from './shapeFont';
import { DEFAULT_LETTERING, layoutLettering } from './layout';
import type { LetteringOptions } from '@/model/types';
import { letteringBatch } from './batch';
import { parseProjectFile, serializeProject } from '@/model/schema';
import { buildPlan } from '@/engine/plan';
import { geomBBox, transformGeomM } from '@/model/geomOps';
import { polylineGeom } from '@/geom/shapes';
import { createDesign } from '@/model/factories';
import { useDoc } from '@/store/documentStore';
import { useUi } from '@/store/uiStore';
import { setLettering } from '@/store/commands/lettering';
import { setShapeGeom } from '@/store/commands';
import { translate } from '@/geom/matrix';
import { pesFormat } from '@/io/export/pesFormat';
import { readPes } from '@/io/pes/pesReader';
import { MC } from '@/io/pes/machineCommands';
import { F } from '@/engine/types';
const bytes = (name: string) => new Uint8Array(readFileSync(`src/lettering/fonts/opentype/${name}.ttf`));
const sans = inspectFont(bytes('NotoSans'), 'Noto Sans'),
  arabic = inspectFont(bytes('NotoSansArabic'), 'Noto Sans Arabic');
function options(text = 'AV', font = sans): LetteringOptions {
  return {
    ...DEFAULT_LETTERING,
    font: 'opentype',
    text,
    height: 25,
    openType: { ...font, direction: 'auto', language: '', variations: {}, stitch: 'tatami' },
  };
}
beforeEach(() => {
  useUi.getState().setSim({ active: false });
  useDoc.getState().load(createDesign(), 'test');
});
it('shapes Latin kerning and ligatures with font metrics and vector outlines', () => {
  const p = prepareOpenType(options()).openType!.prepared!;
  expect(p.upem).toBe(1000);
  expect(p.lines[0].glyphs.map((g) => g.id)).toEqual([36, 57]);
  expect(p.lines[0].advance).toBe(1199);
  expect(p.lines[0].glyphs[1].x).toBe(599);
  expect(prepareOpenType(options('ffi')).openType!.prepared!.lines[0].glyphs).toHaveLength(1);
  const shape = layoutLettering(prepareOpenType(options('O')), 't', '#123456')[0];
  expect(shape.geom.fillRule).toBe('nonzero');
  expect(shape.geom.subpaths).toHaveLength(2);
  expect(geomBBox(shape.geom).minY).toBeLessThan(-15);
});
it('joins Arabic, positions marks, and keeps numbers left-to-right in mixed text', () => {
  const o = options('سَلَام', arabic),
    p = prepareOpenType(o).openType!.prepared!;
  expect(p.lines[0].glyphs.length).toBeGreaterThan(3);
  expect(p.lines[0].glyphs.some((g) => g.y !== 0)).toBe(true);
  expect(p.lines[0].glyphs[0].cluster).toBeGreaterThan(p.lines[0].glyphs.at(-1)!.cluster);
  const d = letteringBatch([o.text], prepareOpenType(o), '#123456')[0];
  expect(d.sequence).toHaveLength(1);
  const plan = buildPlan(d);
  expect(plan.stats.stitches).toBeGreaterThan(100);
  expect(plan.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  const mixed = prepareOpenType({ ...o, text: 'سلام 123' }).openType!.prepared!.lines[0];
  expect(mixed.glyphs.slice(0, 3).map((g) => g.cluster)).toEqual([5, 6, 7]);
  expect(() => prepareOpenType({ ...o, letterSpacing: 1 })).toThrow('spacing');
});
it('applies variable weight and preserves complete font/options through project round trips', () => {
  const light = options('Luma'),
    bold = { ...light, openType: { ...light.openType!, variations: { wght: 800 } } };
  expect(prepareOpenType(light).openType!.prepared!.lines[0].glyphs[0].path).not.toEqual(
    prepareOpenType(bold).openType!.prepared!.lines[0].glyphs[0].path,
  );
  const d = letteringBatch([bold.text], prepareOpenType(bold), '#123456')[0];
  const reopened = parseProjectFile(serializeProject(d));
  expect(reopened).toEqual(JSON.parse(JSON.stringify(d)));
  const reshaped = prepareOpenType({ ...reopened.lettering!.text.options, text: 'New' });
  expect(layoutLettering(reshaped, 't', '#123456')).toHaveLength(1);
  expect(() =>
    prepareOpenType({ ...bold, openType: { ...bold.openType, variations: { wght: 10000 } } }),
  ).toThrow('variation');
});
it('bends continuous outline geometry, reflows a guide with undo, and keeps fill commands', () => {
  const o = prepareOpenType({
    ...options('Luma'),
    baseline: polylineGeom([
      [0, 30],
      [100, 30],
    ]),
  });
  const id = setLettering(o, '#123456'),
    before = useDoc.getState().design!,
    group = before.lettering![id],
    sid = group.baselineShapeId!;
  expect(before.sequence).toHaveLength(1);
  setShapeGeom(sid, transformGeomM(before.shapes[sid].geom, translate(5, 7)));
  const after = useDoc.getState().design!;
  expect(after.lettering![id]).toBeDefined();
  expect(
    geomBBox(after.shapes[group.shapeIds[0]].geom).minY -
      geomBBox(before.shapes[group.shapeIds[0]].geom).minY,
  ).toBeCloseTo(7, 5);
  useDoc.getState().undo();
  expect(useDoc.getState().design).toEqual(before);
  const curved = { ...o, arcAngle: 45, baseline: undefined };
  expect(layoutLettering(curved, 't', '#123456')[0].geom).not.toEqual(
    layoutLettering(o, 't', '#123456')[0].geom,
  );
});
it('rejects malformed fonts, missing characters, stale shaping and non-digitized monograms', () => {
  expect(() => inspectFont(new Uint8Array(100), 'bad.ttf')).toThrow('TrueType');
  const truncated = bytes('NotoSans').slice(0, 2000);
  expect(() => inspectFont(truncated, 'bad.ttf')).toThrow('Truncated');
  expect(() => prepareOpenType(options('漢'))).toThrow('no glyph');
  const o = prepareOpenType(options('ABC'));
  expect(() => layoutLettering({ ...o, text: 'XYZ' }, 't', '#123456')).toThrow('Prepare');
  expect(() => layoutLettering({ ...o, monogram: true }, 't', '#123456')).toThrow('digitized');
});

it.each(['sans', 'serif', 'arabic', 'arabic-curve'])(
  '%s example reproduces its machine file and every needle point',
  (name) => {
    const base = `docs/opentype/${name}/${name}`;
    const design = parseProjectFile(readFileSync(`${base}.lumastitch`, 'utf8'));
    const plan = buildPlan(design),
      bytes = pesFormat.write(plan, design, { version: 6 });
    expect(bytes).toEqual(new Uint8Array(readFileSync(`${base}.pes`)));
    const expected = [];
    for (let i = 0; i < plan.flags.length; i++)
      if (!(plan.flags[i] & (F.JUMP | F.TRIM | F.STOP | F.COLOR_CHANGE | F.END)))
        expected.push([Math.round(plan.x[i] * 10) || 0, Math.round(plan.y[i] * 10) || 0]);
    expect(
      readPes(bytes)
        .commands.filter((c) => c.cmd === MC.STITCH)
        .map((c) => [c.x, c.y]),
    ).toEqual(expected);
  },
);
