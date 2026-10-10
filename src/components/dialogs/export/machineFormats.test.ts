// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { jefPalette, JEF_SETTINGS } from '@/io/formats/jef';
import { buildFormatPattern } from '@/io/formats/encoder';
import { planFromCommands } from '@/io/pes/testing';
import { MACHINE_FORMATS, isMachineFormat, jefColorMapping } from './machineFormats';

describe('machine format choices', () => {
  it('lists PES first, then DST, JEF, EXP, VP3', () => {
    expect(MACHINE_FORMATS.map((f) => f.id)).toEqual(['pes', 'dst', 'jef', 'exp', 'vp3']);
    expect(isMachineFormat('vp3')).toBe(true);
    expect(isMachineFormat('png')).toBe(false);
  });
});

describe('jefColorMapping', () => {
  it('follows the JEF writer palette, stops included', () => {
    const { plan, design } = planFromCommands(
      [
        ['STITCH', 0, 0],
        ['STITCH', 2, 0],
        ['TRIM'],
        ['COLOR_CHANGE'],
        ['STITCH', 2, 2],
        ['STITCH', 4, 2],
        ['TRIM'],
        ['STOP'],
        ['STITCH', 4, 4],
        ['STITCH', 6, 4],
        ['END'],
      ],
      [
        { color: '#ff0000', name: 'Red', code: '1' },
        { color: '#fe0101', name: 'Scarlet', code: '2' },
      ],
      { segmentThreads: [0, 1, 1] },
    );
    const rows = jefColorMapping(plan, design);
    const palette = jefPalette(buildFormatPattern(plan, design, JEF_SETTINGS));
    expect(rows.map((r) => r.jefIndex)).toEqual(palette.map((p) => p.index));
    expect(rows.map((r) => [r.slot, r.stop, r.threadName])).toEqual([
      [0, false, 'Red'],
      [1, false, 'Scarlet'],
      [1, true, 'Scarlet'],
    ]);
    // Two different threads never share a JEF colour in a row; the stop entry is the placeholder.
    expect(rows[0].jef?.name).toBe('Red');
    expect(rows[1].jefIndex).not.toBe(rows[0].jefIndex);
    expect(rows[2].jefIndex).toBe(0);
    expect(rows[2].jef).toBeNull();
    expect(rows[0].deltaE).toBeLessThan(1);
  });
});
