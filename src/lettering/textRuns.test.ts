// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, it } from 'vitest';
import { textRuns } from './textRuns';
import { getEmbeddingLevels, getReorderedIndices } from './vendor/bidi/index.js';
import cases from '../../tests/fixtures/bidi/unicode17.json';
import { inspectFont, prepareOpenType } from './shapeFont';
import { readFileSync } from 'node:fs';
import { DEFAULT_LETTERING, layoutLettering } from './layout';
import { stitchExamples } from '../../tests/bidi/examples';
import { buildPlan } from '@/engine/plan';
import { pesFormat } from '@/io/export/pesFormat';
import { parseProjectFile, serializeProject } from '@/model/schema';
import type { LetteringOptions } from '@/model/types';
const font = (name: string) =>
  inspectFont(new Uint8Array(readFileSync(`src/lettering/fonts/opentype/${name}.ttf`)), name);
function options(text: string, name = 'NotoSansArabic'): LetteringOptions {
  return {
    ...DEFAULT_LETTERING,
    font: 'opentype',
    text,
    height: 25,
    openType: { ...font(name), direction: 'auto', language: '', variations: {}, stitch: 'tatami' },
  };
}
it('passes a reproducible 481-case sample of official Unicode 17 bidi conformance vectors', () => {
  expect(cases).toHaveLength(481);
  for (const test of cases) {
    const text = String.fromCodePoint(...test.codes),
      levels = getEmbeddingLevels(text, test.direction as 'ltr' | 'rtl' | 'auto');
    expect(levels.paragraphs[0].level).toBe(test.base);
    test.levels.forEach((v, i) => {
      if (v !== null) expect(levels.levels[i]).toBe(v);
    });
    expect(getReorderedIndices(text, levels).filter((i) => test.levels[i] !== null)).toEqual(test.order);
  }
});
it('keeps supplementary-plane RTL scalars intact while reporting UTF-16 shaping offsets', () => {
  const text = 'A 𞤀𞤁 12',
    runs = textRuns(text, 'auto'),
    adlam = runs.find((r) => text.slice(r.start, r.end).includes('𞤀'))!;
  expect(adlam.direction).toBe('rtl');
  expect(text.slice(adlam.start, adlam.end)).toContain('𞤀𞤁');
  expect(runs.every((r) => !/[\udc00-\udfff]/u.test(text.slice(r.start, r.start + 1)))).toBe(true);
  const shaped = prepareOpenType(options('\u{1df00} Ω12', 'NotoSans')).openType!.prepared!.lines[0];
  expect(shaped.glyphs.map((g) => g.cluster)).toEqual([0, 2, 3, 4, 5]);
  expect(shaped.glyphs.every((g) => g.id > 0)).toBe(true);
});
it('itemizes scripts and adopts shared marks without splitting Arabic joins', () => {
  const text = 'AV سَلَام 123',
    runs = textRuns(text, 'auto');
  expect(runs.map((r) => r.script)).toContain('Latn');
  expect(runs.map((r) => r.script)).toContain('Arab');
  const arabic = runs.find((r) => r.direction === 'rtl')!;
  expect(text.slice(arabic.start, arabic.end)).toContain('سَلَام');
  const p = prepareOpenType(options(text)).openType!.prepared!.lines[0];
  expect(p.glyphs.filter((g) => g.cluster >= 10).map((g) => g.cluster)).toEqual([10, 11, 12]);
  expect(p.glyphs.some((g) => g.y !== 0)).toBe(true);
});
it.each(['Hello שלום 123', 'שלום (ABC) 123', 'ABC \u2067שלום 123\u2069 XYZ'])(
  'shapes mixed Hebrew text: %s',
  (text) => {
    const p = prepareOpenType(options(text, 'NotoSansHebrew'));
    expect(p.openType!.prepared!.lines[0].advance).toBeGreaterThan(0);
    expect(p.openType!.prepared!.lines[0].glyphs.every((g) => g.id > 0)).toBe(true);
    expect(layoutLettering(p, 'thread', '#123456')).toHaveLength(1);
  },
);
it('treats explicit direction as the paragraph base, retaining Latin and number reading order', () => {
  const o = options('ABC سلام 123'),
    rtl = prepareOpenType({ ...o, openType: { ...o.openType!, direction: 'rtl' } }).openType!.prepared!
      .lines[0];
  expect(rtl.glyphs.filter((g) => g.cluster < 3).map((g) => g.cluster)).toEqual([0, 1, 2]);
  expect(rtl.glyphs.filter((g) => g.cluster >= 9).map((g) => g.cluster)).toEqual([9, 10, 11]);
  expect(rtl.glyphs.findIndex((g) => g.cluster === 9)).toBeLessThan(
    rtl.glyphs.findIndex((g) => g.cluster === 0),
  );
});
it('handles trailing whitespace on a nonzero paragraph slice', () => {
  const text = 'a\nאב  ',
    levels = getEmbeddingLevels(text, 'ltr');
  expect(getReorderedIndices(text, levels, 2, 5)).toEqual([0, 1, 3, 2, 4, 5]);
});

it.each(stitchExamples())(
  'reproduces the $name mixed-script project and illustrated PES program',
  ({ name, design }) => {
    expect(parseProjectFile(serializeProject(design))).toEqual(JSON.parse(JSON.stringify(design)));
    const plan = buildPlan(design);
    expect(plan.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(pesFormat.write(plan, design, { version: 6 })).toEqual(
      new Uint8Array(readFileSync(`docs/bidi/${name}/${name}.pes`)),
    );
  },
);
