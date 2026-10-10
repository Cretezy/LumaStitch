// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
  findByCode,
  getChart,
  hasChart,
  listCharts,
  peekChart,
  registerChart,
  searchChart,
  type ThreadChart,
} from './charts';
import { CHART_MANIFEST } from './charts/manifest';

const REQUIRED = [
  'brother-embroidery',
  'madeira-rayon',
  'madeira-polyneon',
  'isacord-polyester',
  'robison-anton-rayon',
  'robison-anton-polyester',
  'sulky-rayon',
  'gunold-polyester',
  'marathon-rayon',
  'janome',
];

describe('chart registry', () => {
  it('lists the required brands', () => {
    const ids = listCharts().map((c) => c.id);
    for (const id of REQUIRED) expect(ids).toContain(id);
  });

  it('lists every manifest entry (all JSON files are globbed)', () => {
    expect(listCharts()).toHaveLength(CHART_MANIFEST.length);
  });

  it('loads every chart with valid data matching the manifest', async () => {
    for (const meta of listCharts()) {
      const chart = await getChart(meta.id);
      expect(chart.id).toBe(meta.id);
      expect(chart.brand).toBe(meta.brand);
      expect(chart.threads).toHaveLength(meta.count);
      for (const t of chart.threads) {
        expect(t.color).toMatch(/^#[0-9a-f]{6}$/);
        expect(typeof t.code).toBe('string');
        expect(t.name.length).toBeGreaterThan(0);
      }
    }
  });

  it('caches loaded charts', async () => {
    const a = await getChart('madeira-rayon');
    expect(await getChart('madeira-rayon')).toBe(a);
    expect(peekChart('madeira-rayon')).toBe(a);
  });

  it('rejects unknown ids', async () => {
    await expect(getChart('nope')).rejects.toThrow(/Unknown thread chart/);
  });

  it('accepts runtime-registered charts', async () => {
    registerChart({
      id: 'test-chart',
      name: 'Test',
      brand: 'Test',
      threads: [{ code: '1', name: 'Red', color: '#F00' }],
    });
    expect(hasChart('test-chart')).toBe(true);
    expect((await getChart('test-chart')).threads[0].color).toBe('#ff0000');
    expect(listCharts().find((c) => c.id === 'test-chart')?.count).toBe(1);
  });

  it('has Madeira Rayon 1000 Black', async () => {
    const chart = await getChart('madeira-rayon');
    expect(findByCode(chart, '1000')).toMatchObject({ name: 'Black' });
  });
});

describe('searchChart', () => {
  const chart: ThreadChart = {
    id: 't',
    name: 'T',
    brand: 'T',
    threads: [
      { code: '1147', name: 'Royal Blue', color: '#0000ff' },
      { code: '0015', name: 'Black', color: '#000000' },
      { code: '1000', name: 'Blue Jay', color: '#3355ff' },
      { code: '2100', name: 'Light Blue', color: '#99aaff' },
      { code: '1001', name: 'White', color: '#ffffff' },
      { code: 'B10', name: 'Blueberry', color: '#223388' },
    ],
  };
  const codes = (q: string) => searchChart(chart, q).map((t) => t.code);

  it('returns everything for an empty query', () => {
    expect(searchChart(chart, '  ')).toHaveLength(6);
    expect(searchChart(chart, '', 2)).toHaveLength(2);
  });

  it('ranks exact code, then code prefix, then code substring', () => {
    expect(codes('1000')).toEqual(['1000']);
    expect(codes('100')).toEqual(['1000', '1001', '2100']);
    expect(codes('10')).toEqual(['1000', '1001', '2100', 'B10']);
  });

  it('ignores leading zeros in codes', () => {
    expect(codes('15')).toEqual(['0015']);
    expect(codes('0015')).toEqual(['0015']);
  });

  it('ranks name prefix before word prefix before substring, case-insensitively', () => {
    expect(codes('BLUE')).toEqual(['1000', 'B10', '1147', '2100']);
    expect(codes('lack')).toEqual(['0015']);
    expect(codes('blue j')).toEqual(['1000']);
  });

  it('works on a real chart', async () => {
    const c = await getChart('isacord-polyester');
    const r = searchChart(c, 'black');
    expect(r.length).toBeGreaterThan(0);
    expect(r[0].name.toLowerCase()).toContain('black');
  });
});
