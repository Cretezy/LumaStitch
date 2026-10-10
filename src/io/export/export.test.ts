// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import type { StitchPlan } from '@/engine/types';
import type { Design } from '@/model/types';
import { readPes } from '@/io/pes/pesReader';
import { planFromCommands, type SynthCommand } from '@/io/pes/testing';
import {
  getFormat,
  getMachineFormat,
  listFormats,
  listMachineFormats,
  registerFormat,
  writeFormat,
  type ExportFormat,
} from './registry';
import { hasErrors, validateMachineExport, validatePesExport } from './validation';

const RED = { color: '#ed171f', name: 'Red', code: '1147', chart: 'isacord-polyester' };

function codes(plan: StitchPlan) {
  return validatePesExport(plan).map((d) => `${d.severity}:${d.code}`);
}

function asDesign(d: Pick<Design, 'name' | 'threads'>): Design {
  return d as Design;
}

describe('validatePesExport', () => {
  it('accepts a normal plan', () => {
    const { plan } = planFromCommands([['STITCH', 0, 0], ['STITCH', 2, 0], ['STITCH', 4, 0], ['END']], [RED]);
    expect(validatePesExport(plan)).toEqual([]);
  });

  it('errors on an empty plan', () => {
    const { plan } = planFromCommands([['JUMP', 5, 5], ['END']], [RED]);
    expect(codes(plan)).toEqual(['error:export.empty']);
    expect(hasErrors(validatePesExport(plan))).toBe(true);
  });

  it('errors on zero colours', () => {
    const { plan } = planFromCommands(
      [
        ['STITCH', 0, 0],
        ['STITCH', 1, 0],
      ],
      [],
    );
    expect(codes(plan)).toEqual(['error:export.no-colors']);
  });

  it('errors when the design is outside the format range', () => {
    const { plan } = planFromCommands(
      [
        ['STITCH', 0, 0],
        ['STITCH', 3300, 0],
      ],
      [RED],
    );
    const d = validatePesExport(plan);
    expect(d.map((x) => x.code)).toContain('export.out-of-range');
    expect(d.find((x) => x.code === 'export.out-of-range')?.severity).toBe('error');
  });

  it('does not error on long moves that the exporter splits', () => {
    const { plan } = planFromCommands(
      [['STITCH', -200, 0], ['TRIM'], ['JUMP', 200, 0], ['STITCH', 200, 0], ['STITCH', 200, 5]],
      [RED],
    );
    expect(codes(plan)).toEqual([]);
  });

  it('warns on stitches longer than 12 mm (measured on the plan)', () => {
    const { plan } = planFromCommands(
      [
        ['STITCH', 0, 0],
        ['STITCH', 12, 0],
        ['STITCH', 25, 0],
        ['STITCH', 25, 13.5],
        ['TRIM'],
        ['JUMP', 60, 0],
        ['STITCH', 60, 0],
      ],
      [RED],
    );
    const d = validatePesExport(plan);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ severity: 'warning', code: 'export.long-stitches', at: [25, 0] });
    expect(d[0].message).toContain('2 stitches');
    expect(d[0].message).toContain('13.5 mm');
  });

  it('ignores jumps after trims when measuring stitch length', () => {
    const { plan } = planFromCommands(
      [['STITCH', 0, 0], ['STITCH', 1, 0], ['COLOR_CHANGE'], ['STITCH', 50, 0], ['STITCH', 51, 0]],
      [RED, { color: '#000000' }],
    );
    expect(codes(plan)).toEqual([]);
  });

  it('warns on more than 200 trims', () => {
    const cmds: SynthCommand[] = [];
    for (let i = 0; i < 201; i++) cmds.push(['STITCH', i % 50, 0], ['STITCH', (i % 50) + 1, 0], ['TRIM']);
    const { plan } = planFromCommands(cmds, [RED]);
    expect(codes(plan)).toEqual(['warning:export.many-trims']);
    const fewer = planFromCommands(cmds.slice(0, 600), [RED]).plan;
    expect(codes(fewer)).toEqual([]);
  });
});

describe('export registry', () => {
  it('registers PES', () => {
    const pes = getFormat('pes');
    expect(pes).toBeDefined();
    expect(pes).toMatchObject({ id: 'pes', ext: 'pes' });
    expect(listFormats().map((f) => f.id)).toContain('pes');
  });

  it('PES format validates and writes v1 / v6', () => {
    const pes = getMachineFormat('pes')!;
    const { plan, design } = planFromCommands(
      [['STITCH', 0, 0], ['STITCH', 2, 0], ['STITCH', 2, 2], ['END']],
      [RED],
      { name: 'Hello' },
    );
    expect(pes.validate(plan, asDesign(design))).toEqual([]);
    const v1 = readPes(pes.write(plan, asDesign(design), undefined));
    expect(v1.version).toBe(1);
    expect(v1.label).toBe('Hello');
    const v6 = readPes(pes.write(plan, asDesign(design), { version: 6 }));
    expect(v6.version).toBe(6);
    // Chart ids resolve to brand / chart names from the thread chart manifest.
    expect(v6.colors[0]).toMatchObject({ color: '#ed171f', name: 'Red', code: '1147', brand: 'Isacord' });
  });

  it('PES write refuses plans with errors', () => {
    const pes = getMachineFormat('pes')!;
    const { plan, design } = planFromCommands([['END']], [RED]);
    expect(() => pes.write(plan, asDesign(design), {})).toThrow(/no stitches/);
  });

  it('accepts additional formats', () => {
    const fake: ExportFormat = {
      id: 'fake',
      kind: 'machine',
      ext: 'fk',
      mime: 'application/octet-stream',
      label: 'Fake',
      validate: () => [],
      write: () => new Uint8Array([1]),
    };
    registerFormat(fake);
    expect(getFormat('fake')).toBe(fake);
    expect(listFormats().map((f) => f.id)).toEqual(['pes', 'dst', 'jef', 'exp', 'vp3', 'pdf', 'fake']);
  });

  it('registers DST, JEF, EXP, VP3 as machine formats and the PDF worksheet as a document', () => {
    expect(
      listMachineFormats()
        .filter((f) => f.id !== 'fake')
        .map((f) => [f.id, f.ext, f.label]),
    ).toEqual([
      ['pes', 'pes', 'Brother PES'],
      ['dst', 'dst', 'Tajima DST (commercial machines)'],
      ['jef', 'jef', 'Janome JEF'],
      ['exp', 'exp', 'Bernina / Melco EXP'],
      ['vp3', 'vp3', 'Husqvarna / Pfaff VP3'],
    ]);
    expect(getFormat('pdf')?.kind).toBe('document');
    expect(getMachineFormat('pdf')).toBeUndefined();
  });

  it('machine formats validate, write and refuse plans with errors', async () => {
    const { plan, design } = planFromCommands(
      [['STITCH', 0, 0], ['STITCH', 2, 0], ['STITCH', 2, 2], ['END']],
      [RED],
      { name: 'Hello' },
    );
    const empty = planFromCommands([['END']], [RED]);
    for (const id of ['dst', 'jef', 'exp', 'vp3']) {
      const f = getMachineFormat(id)!;
      expect(f.validate(plan, asDesign(design))).toEqual([]);
      const bytes = f.write(plan, asDesign(design), {});
      expect(bytes.length).toBeGreaterThanOrEqual(6);
      // (JEF embeds the current time, so compare lengths.)
      expect((await writeFormat(id, plan, asDesign(design))).length).toBe(bytes.length);
      expect(() => f.write(empty.plan, asDesign(empty.design), {})).toThrow(/no stitches/);
    }
    // Format signatures.
    expect(
      new TextDecoder().decode(getMachineFormat('dst')!.write(plan, asDesign(design), {}).slice(0, 8)),
    ).toBe('LA:Hello');
    expect(
      new TextDecoder().decode(getMachineFormat('vp3')!.write(plan, asDesign(design), {}).slice(0, 5)),
    ).toBe('%vsm%');
    // JEF accepts a fixed date.
    const jef = getMachineFormat('jef')!.write(plan, asDesign(design), { date: '20260102030405' });
    expect(new TextDecoder().decode(jef.slice(8, 22))).toBe('20260102030405');
    await expect(writeFormat('nope', plan, asDesign(design))).rejects.toThrow(/Unknown export format/);
  });
});

describe('validateMachineExport', () => {
  const ok = (id: 'dst' | 'jef' | 'exp' | 'vp3', plan: StitchPlan) =>
    validateMachineExport(plan, id).map((d) => `${d.severity}:${d.code}`);

  it('shares the PES basics: empty, no colours, long stitches', () => {
    const empty = planFromCommands([['JUMP', 5, 5], ['END']], [RED]).plan;
    const noColors = planFromCommands(
      [
        ['STITCH', 0, 0],
        ['STITCH', 1, 0],
      ],
      [],
    ).plan;
    const long = planFromCommands([['STITCH', 0, 0], ['STITCH', 20, 0], ['END']], [RED]).plan;
    for (const id of ['dst', 'jef', 'exp', 'vp3'] as const) {
      expect(ok(id, empty)).toEqual(['error:export.empty']);
      expect(ok(id, noColors)).toEqual(['error:export.no-colors']);
      expect(ok(id, long)).toEqual(['warning:export.long-stitches']);
    }
  });

  it('splits long moves instead of failing (no hoop checks)', () => {
    const { plan } = planFromCommands(
      [['STITCH', -400, 0], ['TRIM'], ['JUMP', 400, 0], ['STITCH', 400, 0], ['STITCH', 400, 5]],
      [RED],
    );
    for (const id of ['dst', 'exp', 'vp3'] as const) expect(ok(id, plan)).toEqual([]);
  });

  it('JEF warns when no Janome hoop fits', () => {
    const fits = planFromCommands(
      [
        ['STITCH', 0, 0],
        ['STITCH', 10, 0],
        ['STITCH', 190, 190],
      ],
      [RED],
    ).plan;
    expect(ok('jef', fits).filter((c) => c.includes('jef-hoop'))).toEqual([]);
    const big = planFromCommands(
      [
        ['STITCH', 0, 0],
        ['STITCH', 10, 0],
        ['STITCH', 10, 205],
      ],
      [RED],
    ).plan;
    const d = validateMachineExport(big, 'jef').find((x) => x.code === 'export.jef-hoop');
    expect(d?.severity).toBe('warning');
    expect(d?.message).toMatch(/200 × 200 mm/);
  });

  it('VP3 limits colour blocks to 255', () => {
    const cmds: SynthCommand[] = [];
    for (let i = 0; i < 300; i++) {
      if (i) cmds.push(['TRIM'], ['STOP']);
      cmds.push(['STITCH', i * 0.2, 0], ['STITCH', i * 0.2, 1]);
    }
    const { plan } = planFromCommands(cmds, [RED]);
    expect(ok('vp3', plan)).toContain('error:export.too-many-colors');
    expect(ok('dst', plan)).not.toContain('error:export.too-many-colors');
  });
});
