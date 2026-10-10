// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import type { ThreadChart } from './charts';
import {
  fromChart,
  fromDesignColors,
  mergeMyThreads,
  normalizeMyThreads,
  removeMyThreads,
} from '@/library/myThreads';

const chart: ThreadChart = {
  id: 'c',
  name: 'C',
  brand: 'B',
  threads: [
    { code: '1000', name: 'Black', color: '#000000' },
    { code: '1001', name: 'White', color: '#FFFFFF' },
    { code: '1001', name: 'White (alt)', color: '#fefefe' },
  ],
};

describe('My threads helpers', () => {
  it('builds from a whole chart with unique stable ids', () => {
    const t = fromChart(chart);
    expect(t).toHaveLength(3);
    expect(new Set(t.map((x) => x.id)).size).toBe(3);
    expect(t[1]).toEqual({ id: 'c:1001:ffffff', name: 'White', color: '#ffffff', code: '1001', chart: 'c' });
  });

  it('builds from selected codes in the given order', () => {
    expect(fromChart(chart, ['1001', 'nope', '1000']).map((t) => t.name)).toEqual(['White', 'Black']);
  });

  it('builds from design colours, deduplicated', () => {
    const t = fromDesignColors([
      '#FF0000',
      { color: '#ff0000', name: 'dup' },
      { color: '#00ff00', name: 'Leaf', code: '42', chart: 'c' },
      'not a colour',
    ]);
    expect(t).toEqual([
      { id: 'color:#ff0000', name: '#ff0000', color: '#ff0000' },
      { id: 'c:42:00ff00', name: 'Leaf', color: '#00ff00', code: '42', chart: 'c' },
    ]);
  });

  it('merges and removes by id', () => {
    const a = mergeMyThreads({ threads: [] }, fromChart(chart));
    const b = mergeMyThreads(a, fromChart(chart, ['1000']));
    expect(b.threads).toHaveLength(3);
    expect(removeMyThreads(b, ['c:1000:000000']).threads).toHaveLength(2);
  });

  it('normalises untrusted stored data', () => {
    expect(normalizeMyThreads(undefined)).toEqual({ threads: [] });
    expect(normalizeMyThreads({ threads: 'x' })).toEqual({ threads: [] });
    expect(
      normalizeMyThreads({
        threads: [
          { id: 'a', name: 'A', color: '#ABC', code: '' },
          { id: 'a', name: 'dup', color: '#000000' },
          { id: 'b', color: 'red' },
          null,
          { id: 'c', color: '#123456', chart: 'x' },
        ],
      }),
    ).toEqual({
      threads: [
        { id: 'a', name: 'A', color: '#aabbcc' },
        { id: 'c', name: '#123456', color: '#123456', chart: 'x' },
      ],
    });
  });
});
