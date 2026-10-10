// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
  buildUniquePalette,
  cpythonSetOrder,
  colorDistanceRedMean,
  nearestPecIndex,
  nearestPecIndexRedMean,
  PEC_PALETTE,
  PEC_PALETTE_SIZE,
} from './pecPalette';

describe('PEC palette', () => {
  it('keeps pyembroidery index semantics (0 unused, 1..64 colours)', () => {
    expect(PEC_PALETTE_SIZE).toBe(65);
    expect(PEC_PALETTE[0]).toBeNull();
    expect(PEC_PALETTE[1]).toMatchObject({ index: 1, color: '#0e1f7c', name: 'Prussian Blue', code: '1' });
    expect(PEC_PALETTE[20]).toMatchObject({ color: '#000000', name: 'Black' });
    expect(PEC_PALETTE[29]).toMatchObject({ color: '#f0f0f0', name: 'White' });
    expect(PEC_PALETTE[64]).toMatchObject({ color: '#ffc8c8', name: 'Applique' });
  });

  it('maps every palette colour to itself', () => {
    for (let i = 1; i < PEC_PALETTE_SIZE; i++) {
      const p = PEC_PALETTE[i]!;
      expect(nearestPecIndex(p.color)).toBe(i);
      expect(nearestPecIndexRedMean(p.color)).toBe(i);
    }
  });

  it('finds sensible nearest colours by CIEDE2000', () => {
    expect(nearestPecIndex('#000000')).toBe(20); // Black
    expect(nearestPecIndex('#FFFFFF')).toBe(29); // White (case-insensitive)
    expect(nearestPecIndex('#ff0000')).toBe(28); // Vermilion (254,55,15) is perceptually closest to pure red
    expect(nearestPecIndex('#e81820')).toBe(5); // Red
    expect(nearestPecIndex('#ffff00')).toBe(13); // Yellow
    expect(nearestPecIndex('#808080')).toBe(39); // Gray
    expect(nearestPecIndex('#0b3c90')).toBe(21); // Ultramarine
    // Never index 0, always in range, stable (cached).
    for (const c of ['#123456', '#abcdef', '#7f7f00', '#00ffff']) {
      const i = nearestPecIndex(c);
      expect(i).toBeGreaterThanOrEqual(1);
      expect(i).toBeLessThanOrEqual(64);
      expect(nearestPecIndex(c)).toBe(i);
    }
  });

  it('red-mean distance matches pyembroidery (integer maths)', () => {
    expect(colorDistanceRedMean([0, 0, 0], [0, 0, 0])).toBe(0);
    // red_mean = round(127.5) = 128 (half to even), r = 255: ((512+128)*65025)>>8 = 162562
    expect(colorDistanceRedMean([255, 0, 0], [0, 0, 0])).toBe(162562);
    expect(colorDistanceRedMean([0, 10, 0], [0, 0, 0])).toBe(400);
  });

  it('builds a unique palette: distinct colours never share a PEC index', () => {
    const reds = ['#ed171f', '#ee1820', '#ed171f', '#ec161e'];
    const idx = buildUniquePalette(reds, 'ciede2000');
    expect(idx[0]).toBe(5); // exact Red
    expect(idx[2]).toBe(5); // same colour → same index
    expect(new Set([idx[0], idx[1], idx[3]]).size).toBe(3);
    expect(buildUniquePalette([], 'ciede2000')).toEqual([]);
  });

  it('falls back to the nearest claimed entry once the 64 colours are used up', () => {
    const many = Array.from({ length: 70 }, (_, i) => `#${(i * 3).toString(16).padStart(2, '0')}4080`);
    for (const match of ['pyembroidery', 'ciede2000'] as const) {
      const idx = buildUniquePalette(many, match);
      expect(new Set(idx).size).toBe(64); // every PEC entry claimed once
      if (match === 'ciede2000') expect(new Set(idx.slice(0, 64)).size).toBe(64); // first come, first served
      for (const i of idx) {
        expect(i).toBeGreaterThanOrEqual(1);
        expect(i).toBeLessThanOrEqual(64);
      }
    }
  });

  it('emulates CPython set() iteration order (vector generated with CPython 3.14)', () => {
    // [hash, key]; includes duplicates and equal hashes with different keys.
    const ITEMS: [number, string][] = [
      [10866024, 'a'],
      [5061658, 'a'],
      [13248078, 'a'],
      [1620223, 'a'],
      [2430558, 'a'],
      [3158480, 'a'],
      [12270483, 'a'],
      [1946120, 'a'],
      [7204075, 'a'],
      [1258145, 'a'],
      [2883910, 'a'],
      [14550734, 'a'],
      [14031529, 'a'],
      [2343959, 'a'],
      [8075310, 'a'],
      [3043823, 'a'],
      [14244500, 'a'],
      [1983419, 'a'],
      [4154104, 'a'],
      [7490656, 'a'],
      [2075745, 'a'],
      [13310388, 'a'],
      [1663941, 'a'],
      [7418275, 'a'],
      [1563055, 'a'],
      [4468605, 'a'],
      [9717675, 'a'],
      [14063972, 'a'],
      [4840397, 'a'],
      [3952451, 'a'],
      [10350932, 'a'],
      [6064171, 'a'],
      [3457975, 'a'],
      [6303905, 'a'],
      [12495588, 'a'],
      [3269227, 'a'],
      [2106848, 'a'],
      [1999883, 'a'],
      [6910827, 'a'],
      [16656906, 'a'],
      [1620223, 'a'],
      [3158480, 'b'],
      [2883910, 'a'],
      [0, 'a'],
      [8, 'a'],
      [16, 'a'],
    ];
    const ORDER = [
      43, 7, 44, 39, 37, 45, 6, 16, 13, 1, 9, 33, 23, 12, 26, 31, 14, 24, 21, 32, 17, 29, 22, 10, 28, 2, 11,
      5, 41, 30, 4, 19, 20, 36, 27, 34, 0, 8, 35, 38, 15, 18, 25, 3,
    ];
    const order = cpythonSetOrder(
      ITEMS,
      (t) => t[0],
      (a, b) => a[0] === b[0] && a[1] === b[1],
    );
    expect(order.map((t) => ITEMS.indexOf(t))).toEqual(ORDER);
  });
});
