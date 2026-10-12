// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { DIGITIZED_FONTS, type DigitizedFontId } from './digitizedFonts';
import { DEFAULT_LETTERING, layoutLettering } from './layout';
import { letteringBatch } from './batch';
import { archiveLetteringDesigns } from './archive';
import { buildPlan } from '@/engine/plan';
import { parseProjectFile, serializeProject } from '@/model/schema';
import { pesFormat } from '@/io/export/pesFormat';
import { unzipFiles } from '@/library/zip';

it.each(['geneva-rounded', 'chopin'] as DigitizedFontId[])(
  'generates every %s glyph at both supported size limits',
  (id) => {
    const font = DIGITIZED_FONTS[id];
    for (const height of [font.min, font.max])
      for (const char of Object.keys(font.glyphs)) {
        const d = letteringBatch([char], { ...DEFAULT_LETTERING, font: id, height }, '#234567')[0];
        const p = buildPlan(d);
        expect(
          p.diagnostics.filter((d) => d.severity === 'error'),
          `${id} ${char} ${height}`,
        ).toEqual([]);
        expect(p.stats.stitches, `${id} ${char} ${height}`).toBeGreaterThan(2);
      }
  },
);
it('separates per-font geometry caches and enforces glyph, size and monogram limits', () => {
  const a = layoutLettering({ ...DEFAULT_LETTERING, text: 'AB', height: 12 }, 't', '#123456');
  const b = layoutLettering(
    { ...DEFAULT_LETTERING, text: 'AB', height: 12, font: 'geneva-rounded' },
    't',
    '#123456',
  );
  const c = layoutLettering({ ...DEFAULT_LETTERING, text: 'AB', height: 12 }, 't', '#123456');
  expect(a.map((s) => s.geom)).toEqual(c.map((s) => s.geom));
  expect(a.map((s) => s.geom)).not.toEqual(b.map((s) => s.geom));
  for (const [font, f] of Object.entries(DIGITIZED_FONTS)) {
    const options = { ...DEFAULT_LETTERING, font: font as DigitizedFontId };
    expect(() => layoutLettering({ ...options, height: f.min - 0.01 }, 't', '#123456')).toThrow(/height/);
    expect(() => layoutLettering({ ...options, height: f.max + 0.01 }, 't', '#123456')).toThrow(/height/);
    expect(() =>
      layoutLettering({ ...options, height: f.min, text: 'ABC', monogram: true }, 't', '#123456'),
    ).toThrow(/Monograms/);
    expect(() => layoutLettering({ ...options, height: f.min, text: '你好' }, 't', '#123456')).toThrow(
      /no glyph/,
    );
  }
});
it('saves each font choice and carries correct full source licenses in batch archives', async () => {
  const designs = (
    Object.entries(DIGITIZED_FONTS) as [DigitizedFontId, typeof DIGITIZED_FONTS.chopin][]
  ).flatMap(([font, f]) =>
    letteringBatch(['Ada'], { ...DEFAULT_LETTERING, font, height: f.defaultHeight }, '#234567'),
  );
  const files = await unzipFiles(archiveLetteringDesigns(designs));
  for (const d of designs) {
    const id = d.lettering!.text.options.font as DigitizedFontId;
    expect(parseProjectFile(serializeProject(d)).lettering!.text.options.font).toBe(id);
    const license = new TextDecoder().decode(files.find((f) => f.name === `licenses/${id}.txt`)!.data);
    expect(license).toContain(DIGITIZED_FONTS[id].license);
    expect(license).toContain(DIGITIZED_FONTS[id].source);
  }
});
it.each(['rounded', 'script', 'script-monogram'])(
  'reproduces the %s editable example and PES file',
  (name) => {
    const base = `docs/digitized-fonts/${name}/${name}`;
    const d = parseProjectFile(readFileSync(`${base}.lumastitch`, 'utf8'));
    expect(pesFormat.write(buildPlan(d), d, { version: 6 })).toEqual(
      new Uint8Array(readFileSync(`${base}.pes`)),
    );
  },
);
