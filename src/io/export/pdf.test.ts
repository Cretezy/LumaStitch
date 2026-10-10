/// <reference types="node" />
// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { planFromCommands, type SynthCommand, type SynthThread } from '@/io/pes/testing';
import { buildWorksheetPdf, exportPdf, pdfFormat, worksheetData, worksheetDate } from './pdf';
import { fitText, pdfString, textWidth, winAnsi } from './pdfWriter';
import { getFormat } from './registry';
import type { Design } from '@/model/types';

const DATE = new Date(2026, 9, 10, 12, 0, 0);
/** Not a decodable JPEG; the writer embeds bytes verbatim, which is all these tests check. */
const FAKE_JPEG = {
  bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9]),
  width: 40,
  height: 30,
};

const THREADS: SynthThread[] = [
  { color: '#0a55a3', name: 'Blue', code: '3810', chart: 'isacord-polyester' },
  { color: '#ffd911', name: 'Harvest Gold', code: '0600', chart: 'isacord-polyester' },
];

function sample(extra: SynthCommand[] = []) {
  const cmds: SynthCommand[] = [
    ['STITCH', 0, 0],
    ['STITCH', 2, 0],
    ['STITCH', 4, 1],
    ['TRIM'],
    ['STOP'],
    ['JUMP', 10, 10],
    ['STITCH', 10, 10],
    ['STITCH', 12, 10],
    ['TRIM'],
    ['COLOR_CHANGE'],
    ['JUMP', 20, 5],
    ['STITCH', 20, 5],
    ['STITCH', 22, 7],
    ['STITCH', 30, 20],
    ...extra,
    ['END'],
  ];
  const { plan, design } = planFromCommands(cmds, THREADS, {
    name: 'Logo (front)',
    segmentThreads: [0, 0, 1],
  });
  return { plan, design: { ...design, fabric: 'woven' } as Pick<Design, 'name' | 'threads' | 'fabric'> };
}

const latin1 = (b: Uint8Array) => Buffer.from(b).toString('latin1');

/** Parses and checks the xref table / trailer; returns the object bodies by number. */
function parse(bytes: Uint8Array) {
  const s = latin1(bytes);
  expect(s.startsWith('%PDF-1.4\n%')).toBe(true);
  expect([...bytes.slice(10, 14)].every((b) => b >= 0x80)).toBe(true); // binary comment
  expect(s.endsWith('%%EOF\n')).toBe(true);
  const startxref = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(s)![1]);
  expect(s.slice(startxref, startxref + 5)).toBe('xref\n');
  const head = /^xref\n0 (\d+)\n/.exec(s.slice(startxref))!;
  const size = Number(head[1]);
  const table = s
    .slice(startxref + head[0].length)
    .split('\n')
    .slice(0, size);
  expect(table[0]).toBe('0000000000 65535 f ');
  const objects = new Map<number, string>();
  for (let i = 1; i < size; i++) {
    const m = /^(\d{10}) 00000 n $/.exec(table[i]);
    expect(m, `xref entry ${i}`).not.toBeNull();
    const off = Number(m![1]);
    expect(s.slice(off, off + `${i} 0 obj\n`.length)).toBe(`${i} 0 obj\n`);
    const end = s.indexOf('\nendobj\n', off);
    objects.set(i, s.slice(off + `${i} 0 obj\n`.length, end));
  }
  const trailer = /trailer\n<< \/Size (\d+) \/Root (\d+) 0 R \/Info (\d+) 0 R >>/.exec(s)!;
  expect(Number(trailer[1])).toBe(size);
  expect(objects.get(Number(trailer[2]))).toMatch(/\/Type \/Catalog \/Pages \d+ 0 R/);
  const pagesId = Number(/\/Pages (\d+) 0 R/.exec(objects.get(Number(trailer[2]))!)![1]);
  const pages = objects.get(pagesId)!;
  const count = Number(/\/Count (\d+)/.exec(pages)![1]);
  const kids = [...pages.matchAll(/(\d+) 0 R/g)].map((m) => Number(m[1]));
  expect(kids).toHaveLength(count);
  for (const k of kids)
    expect(objects.get(k)).toMatch(/^<< \/Type \/Page \/Parent \d+ 0 R \/MediaBox \[0 0 595\.28 841\.89\]/);
  // Stream lengths match their data.
  for (const body of objects.values()) {
    const m = /\/Length (\d+) >>\nstream\n/.exec(body);
    if (!m) continue;
    const data = body.slice(m.index + m[0].length);
    expect(data.endsWith('\nendstream')).toBe(true);
    expect(data.length - '\nendstream'.length).toBe(Number(m[1]));
  }
  return { s, objects, pageCount: count, info: objects.get(Number(trailer[3]))! };
}

describe('PDF text helpers', () => {
  it('encodes WinAnsi and escapes literal strings', () => {
    expect(winAnsi('A×é€…')).toEqual([0x41, 0xd7, 0xe9, 0x80, 0x85]);
    expect(winAnsi('ő🙂')).toEqual([0x6f, 0x3f]); // accent stripped, emoji unsupported
    expect(pdfString('a(b)\\c · d')).toBe('(a\\(b\\)\\\\c \\267 d)');
  });

  it('measures Helvetica and truncates with an ellipsis', () => {
    expect(textWidth('Hello', 'regular', 10)).toBeCloseTo(((722 + 556 + 222 + 222 + 556) * 10) / 1000);
    expect(textWidth('Hello', 'bold', 10)).toBeGreaterThan(textWidth('Hello', 'regular', 10));
    const long = 'A very long thread name that will not fit';
    const fitted = fitText(long, 'regular', 10, 80);
    expect(fitted.endsWith('…')).toBe(true);
    expect(textWidth(fitted, 'regular', 10)).toBeLessThanOrEqual(80);
    expect(fitText('Short', 'regular', 10, 80)).toBe('Short');
  });
});

describe('worksheetData', () => {
  it('collects stats, fabric and the colour sequence with stops', () => {
    const { plan, design } = sample();
    const d = worksheetData(plan, design, DATE);
    expect(d.title).toBe('Logo (front)');
    expect(d.date).toBe('10 October 2026');
    expect(Object.fromEntries(d.stats)).toMatchObject({
      Stitches: '8',
      Colours: '2',
      'Colour changes': '1',
      Stops: '1',
      Trims: '2',
    });
    expect(d.fabric).toBe('Woven (cotton, twill, denim)');
    expect(d.stabilizer).toMatch(/stabiliser/);
    expect(d.rows.map((r) => [r.step, r.threadName, r.chartCode, r.stitches, r.stop])).toEqual([
      [1, 'Blue', 'Isacord Polyester 3810', 3, false],
      [2, 'Blue', 'Isacord Polyester 3810', 2, true],
      [3, 'Harvest Gold', 'Isacord Polyester 0600', 3, false],
    ]);
  });

  it('formats dates in English regardless of locale', () => {
    expect(worksheetDate(new Date(2026, 0, 2))).toBe('2 January 2026');
  });
});

describe('buildWorksheetPdf', () => {
  it('writes a valid single-page PDF with text, swatches and the embedded JPEG', () => {
    const { plan, design } = sample();
    const bytes = buildWorksheetPdf(worksheetData(plan, design, DATE), FAKE_JPEG, { creationDate: DATE });
    const { s, objects, pageCount, info } = parse(bytes);
    expect(pageCount).toBe(1);
    expect(info).toContain('/Title (Logo \\(front\\))');
    expect(info).toContain('/Producer (LumaStitch)');
    expect(info).toMatch(/\/CreationDate \(D:\d{14}Z\)/);
    for (const text of [
      '(Logo \\(front\\))',
      '(Production worksheet \\267 10 October 2026)',
      '(Stitches)',
      '(Estimated time)',
      '(Woven \\(cotton, twill, denim\\))',
      '(Colour sequence)',
      '(Harvest Gold)',
      '(Isacord Polyester 0600)',
      '(STOP)',
      '(Page 1 of 1)',
    ])
      expect(s).toContain(text);
    // Helvetica fonts with WinAnsi.
    expect(s).toContain('/BaseFont /Helvetica /Encoding /WinAnsiEncoding');
    expect(s).toContain('/BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding');
    // The image XObject holds the JPEG bytes verbatim and is drawn on the page.
    const img = [...objects.values()].find((b) => b.includes('/Subtype /Image'))!;
    expect(img).toContain(
      '/Width 40 /Height 30 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode',
    );
    const at = bytes.indexOf(0xff);
    expect([...bytes.slice(at, at + FAKE_JPEG.bytes.length)]).toEqual([...FAKE_JPEG.bytes]);
    expect(s).toMatch(/\/XObject << \/Im1 \d+ 0 R >>/);
    expect(s).toMatch(/cm \/Im1 Do Q/);
    // Vector swatches in the thread colours (#0a55a3 → 0.04 0.33 0.64).
    expect(s).toContain('0.04 0.33 0.64 rg');
    expect(s).toContain('1 0.85 0.07 rg');
  });

  it('continues the colour table on further pages', () => {
    const cmds: SynthCommand[] = [];
    const threads: SynthThread[] = [];
    for (let i = 0; i < 70; i++) {
      threads.push({ color: `#${(i * 3).toString(16).padStart(2, '0')}4080`, name: `Thread ${i + 1}` });
      if (i > 0) cmds.push(['TRIM'], ['COLOR_CHANGE']);
      cmds.push(['STITCH', i, 0], ['STITCH', i, 5]);
    }
    cmds.push(['END']);
    const { plan, design } = planFromCommands(cmds, threads, { name: 'Many' });
    const data = worksheetData(plan, { ...design, fabric: 'knit' }, DATE);
    expect(data.rows).toHaveLength(70);
    const { s, pageCount } = parse(buildWorksheetPdf(data, null, { creationDate: DATE }));
    expect(pageCount).toBe(3);
    expect(s).toContain('(Preview not available)');
    expect(s).toContain('(Page 3 of 3)');
    expect(s).toContain('(Many \\227 colour sequence \\(continued\\))');
    for (const i of [1, 35, 70]) expect(s).toContain(`(Thread ${i})`);
    // Every step appears exactly once.
    for (let i = 1; i <= 70; i++) expect(s.split(`(Thread ${i})`).length - 1).toBe(1);
    expect(s).not.toContain('(STOP)');
  });

  it('handles an empty design', () => {
    const { plan, design } = planFromCommands([['END']], [{ color: '#000000' }], { name: '' });
    const { s, pageCount } = parse(
      buildWorksheetPdf(worksheetData(plan, { ...design, fabric: 'pile' }, DATE), null, {
        creationDate: DATE,
      }),
    );
    expect(pageCount).toBe(1);
    expect(s).toContain('(Untitled)');
  });
});

describe('exportPdf / registry', () => {
  it('returns a PDF blob (injected JPEG)', async () => {
    const { plan, design } = sample();
    const blob = await exportPdf(plan, design, { jpeg: FAKE_JPEG, date: DATE });
    expect(blob.type).toBe('application/pdf');
    const { pageCount } = parse(new Uint8Array(await blob.arrayBuffer()));
    expect(pageCount).toBe(1);
  });

  it('is registered as a document export', async () => {
    const f = getFormat('pdf');
    expect(f).toBe(pdfFormat);
    expect(f).toMatchObject({ kind: 'document', ext: 'pdf', mime: 'application/pdf' });
    const { plan, design } = sample();
    expect(pdfFormat.validate(plan, design as Design)).toEqual([]);
    const empty = planFromCommands([['END']], THREADS).plan;
    expect(pdfFormat.validate(empty, design as Design).map((d) => d.code)).toEqual(['export.empty']);
    const bytes = await pdfFormat.write(plan, design as Design, { jpeg: null, date: DATE });
    expect(parse(bytes).s).toContain('(Preview not available)');
  });
});
