// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { deltaE2000, hexToLab } from './color';
import { getChart } from './charts';
import { mapColorsToChart, nearestThread } from './nearest';

const candidates = [{ color: '#ff0000' }, { color: '#00ff00' }, { color: '#0000ff' }, { color: '#ffffff' }];

describe('nearestThread', () => {
  it('finds exact matches with ΔE 0', () => {
    expect(nearestThread('#00ff00', candidates)).toEqual({ index: 1, deltaE: 0 });
  });

  it('finds the perceptually nearest colour', () => {
    expect(nearestThread('#ee1111', candidates).index).toBe(0);
    expect(nearestThread('#f0f0f8', candidates).index).toBe(3);
    expect(nearestThread(hexToLab('#2020c0'), candidates).index).toBe(2);
  });

  it('agrees with brute force over a real chart', async () => {
    const chart = await getChart('madeira-rayon');
    for (const hex of ['#123456', '#c0ffee', '#808080', '#ff8800']) {
      const r = nearestThread(hex, chart.threads);
      const lab = hexToLab(hex);
      const min = Math.min(...chart.threads.map((t) => deltaE2000(lab, hexToLab(t.color))));
      expect(r.deltaE).toBeCloseTo(min, 12);
      expect(deltaE2000(lab, hexToLab(chart.threads[r.index].color))).toBeCloseTo(min, 12);
    }
  });

  it('returns -1 for no candidates', () => {
    expect(nearestThread('#123456', [])).toEqual({ index: -1, deltaE: Infinity });
  });

  it('breaks ties by lowest index', () => {
    expect(nearestThread('#000000', [{ color: '#111111' }, { color: '#111111' }]).index).toBe(0);
  });
});

describe('mapColorsToChart', () => {
  it('maps colours to chart threads', async () => {
    const chart = await getChart('brother-embroidery');
    const res = mapColorsToChart(['#000000', '#ffffff', '#000000'], chart);
    expect(res).toHaveLength(3);
    expect(res[0].thread?.name).toMatch(/black/i);
    expect(res[2]).toEqual(res[0]);
    expect(res[1].deltaE).toBeLessThan(10);
  });

  it('accepts a plain list and an empty list', () => {
    const res = mapColorsToChart(['#fe0000'], candidates);
    expect(res[0]).toMatchObject({ color: '#fe0000', index: 0, thread: candidates[0] });
    expect(mapColorsToChart(['#fe0000'], [])[0]).toMatchObject({ thread: null, index: -1 });
  });
});
