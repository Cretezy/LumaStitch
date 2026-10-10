// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { readPes, writePes } from '@/io/pes';
import { planFromCommands } from '@/io/pes/testing';
import { pecColorMapping } from './colorMapping';

describe('pecColorMapping', () => {
  it('matches the PEC colours the v1 writer stores, stops included', () => {
    const { plan, design } = planFromCommands(
      [
        ['STITCH', 0, 0],
        ['STITCH', 2, 0],
        ['STOP'],
        ['STITCH', 2, 2],
        ['COLOR_CHANGE'],
        ['STITCH', 4, 2],
        ['COLOR_CHANGE'],
        ['STITCH', 5, 5],
        ['END'],
      ],
      [
        { color: '#e3242b', name: 'Red', code: '1902' },
        { color: '#e5262d', name: 'Red too' }, // same nearest PEC colour → gets the next free one
        { color: '#123456' },
      ],
    );
    const rows = pecColorMapping(plan, design);
    const read = readPes(writePes(plan, design, { version: 1 }));
    expect(rows.map((r) => r.pecIndex)).toEqual(read.pecColorIndexes);
    expect(rows.map((r) => r.stop)).toEqual([false, true, false, false]);
    expect(rows[0]).toMatchObject({ threadName: 'Red', threadCode: '1902', designColor: '#e3242b' });
    expect(rows[1].pecIndex).toBe(rows[0].pecIndex);
    expect(rows[2].pecIndex).not.toBe(rows[0].pecIndex);
    expect(rows[0].deltaE).toBeLessThan(10);
    expect(rows[0].pec?.name).toBe('Red');
  });
});
