// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { deltaE2000, hexToLab, type Lab } from './color';
import { averageColor, kmeansLab, mergeCloseColors, mulberry32, reduceColors } from './kmeans';

/** Points scattered around fixed Lab centres. */
function synthetic(seed: number, perCluster = 200) {
  const centres: Lab[] = [
    [30, 40, 20],
    [70, -40, 50],
    [50, 10, -60],
    [85, 0, 5],
  ];
  const rnd = mulberry32(seed);
  const points: Lab[] = [];
  const truth: number[] = [];
  centres.forEach((c, ci) => {
    for (let i = 0; i < perCluster; i++) {
      points.push([c[0] + (rnd() - 0.5) * 6, c[1] + (rnd() - 0.5) * 6, c[2] + (rnd() - 0.5) * 6]);
      truth.push(ci);
    }
  });
  return { centres, points, truth };
}

describe('mulberry32', () => {
  it('is deterministic and in [0,1)', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 1000; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });
});

describe('kmeansLab', () => {
  it('recovers well-separated clusters', () => {
    const { centres, points, truth } = synthetic(7);
    const r = kmeansLab(points, undefined, 4, 123);
    expect(r.centers).toHaveLength(4);
    // Each true cluster maps to exactly one found cluster, and vice versa.
    const map = new Map<number, number>();
    truth.forEach((t, i) => {
      const a = r.assignment[i];
      if (!map.has(t)) map.set(t, a);
      expect(map.get(t)).toBe(a);
    });
    expect(new Set(map.values()).size).toBe(4);
    for (const [t, a] of map) {
      const c = r.centers[a];
      const d = Math.hypot(c[0] - centres[t][0], c[1] - centres[t][1], c[2] - centres[t][2]);
      expect(d).toBeLessThan(1);
    }
  });

  it('is deterministic for a seed', () => {
    const { points } = synthetic(3);
    const a = kmeansLab(points, undefined, 6, 99);
    const b = kmeansLab(points, undefined, 6, 99);
    expect(a.centers).toEqual(b.centers);
    expect(Array.from(a.assignment)).toEqual(Array.from(b.assignment));
    expect(a.inertia).toBe(b.inertia);
  });

  it('honours weights', () => {
    const points: Lab[] = [
      [50, 0, 0],
      [60, 0, 0],
    ];
    const r = kmeansLab(points, [3, 1], 1, 1);
    expect(r.centers[0][0]).toBeCloseTo(52.5, 9);
  });

  it('returns fewer centres when there are fewer distinct points', () => {
    const points: Lab[] = [
      [50, 0, 0],
      [50, 0, 0],
      [20, 5, 5],
    ];
    const r = kmeansLab(points, undefined, 3, 1);
    expect(r.centers).toHaveLength(2);
    expect(r.assignment[0]).toBe(r.assignment[1]);
    expect(r.assignment[0]).not.toBe(r.assignment[2]);
    expect(r.inertia).toBe(0);
  });

  it('handles empty input and k clamping', () => {
    expect(kmeansLab([], undefined, 3, 1).centers).toEqual([]);
    expect(kmeansLab([[1, 2, 3]], undefined, 5, 1).centers).toEqual([[1, 2, 3]]);
  });
});

describe('mergeCloseColors', () => {
  it('merges near-identical colours and keeps distinct ones', () => {
    const items = [
      { color: '#ff0000', weight: 3 },
      { color: '#0000ff', weight: 1 },
      { color: '#fe0101', weight: 1 },
      { color: '#FF0000', weight: 2 },
      { color: '#00ff00', weight: 1 },
    ];
    const cs = mergeCloseColors(items);
    expect(cs).toHaveLength(3);
    expect(cs[0].members).toEqual([0, 2, 3]);
    expect(cs[0].weight).toBe(6);
    expect(cs[0].dominant).toBe(0);
    expect(deltaE2000(cs[0].lab, hexToLab('#ff0000'))).toBeLessThan(1);
    expect(cs[1]).toMatchObject({ color: '#0000ff', members: [1] });
    expect(cs[2]).toMatchObject({ color: '#00ff00', members: [4] });
  });

  it('keeps exact colours for unmerged and identical-only clusters', () => {
    const cs = mergeCloseColors([{ color: '#123456' }, { color: '#123456' }, { color: '#ABCDEF' }]);
    expect(cs.map((c) => c.color)).toEqual(['#123456', '#abcdef']);
    expect(cs[0].weight).toBe(2);
  });

  it('respects the threshold', () => {
    const items = [{ color: '#808080' }, { color: '#888888' }];
    const d = deltaE2000(hexToLab('#808080'), hexToLab('#888888'));
    expect(mergeCloseColors(items, d - 0.01)).toHaveLength(2);
    expect(mergeCloseColors(items, d + 0.01)).toHaveLength(1);
  });

  it('uses the weighted Lab mean', () => {
    const cs = mergeCloseColors(
      [
        { color: '#808080', weight: 1 },
        { color: '#888888', weight: 3 },
      ],
      10,
    );
    const a = hexToLab('#808080');
    const b = hexToLab('#888888');
    expect(cs[0].lab[0]).toBeCloseTo((a[0] + 3 * b[0]) / 4, 9);
    expect(cs[0].dominant).toBe(1);
  });

  it('is deterministic and order-independent in membership for a gradient', () => {
    const items = Array.from({ length: 40 }, (_, i) => {
      const v = (100 + i * 3).toString(16).padStart(2, '0');
      return { color: `#${v}${v}${v}`, weight: 1 + (i % 3) };
    });
    const a = mergeCloseColors(items);
    const b = mergeCloseColors(items);
    expect(a).toEqual(b);
    // Every item lands in exactly one cluster.
    const all = a.flatMap((c) => c.members).sort((x, y) => x - y);
    expect(all).toEqual(items.map((_, i) => i));
    expect(a.length).toBeGreaterThan(1);
    expect(a.length).toBeLessThan(items.length);
  });

  it('handles empty input and zero weights', () => {
    expect(mergeCloseColors([])).toEqual([]);
    const cs = mergeCloseColors([
      { color: '#808080', weight: 0 },
      { color: '#828282', weight: 0 },
    ]);
    expect(cs).toHaveLength(1);
    expect(cs[0].weight).toBe(0);
  });
});

describe('reduceColors', () => {
  it('only merges when under the limit', () => {
    const r = reduceColors([{ color: '#ff0000' }, { color: '#fe0000' }, { color: '#0000ff' }]);
    expect(r.clusters).toHaveLength(2);
    expect(r.mapping).toEqual([0, 0, 1]);
  });

  it('clusters down to maxColors and maps every input', () => {
    const items = [
      { color: '#ff0000', weight: 5 },
      { color: '#e00010', weight: 5 },
      { color: '#0000ff', weight: 5 },
      { color: '#1010d0', weight: 5 },
      { color: '#00ff00', weight: 5 },
      { color: '#10d010', weight: 5 },
    ];
    const r = reduceColors(items, 3, { seed: 4 });
    expect(r.clusters).toHaveLength(3);
    expect(r.mapping[0]).toBe(r.mapping[1]);
    expect(r.mapping[2]).toBe(r.mapping[3]);
    expect(r.mapping[4]).toBe(r.mapping[5]);
    expect(new Set(r.mapping).size).toBe(3);
    for (const [i, it] of items.entries()) {
      expect(r.clusters[r.mapping[i]].members).toContain(i);
      expect(deltaE2000(hexToLab(it.color), r.clusters[r.mapping[i]].lab)).toBeLessThan(15);
    }
    expect(reduceColors(items, 3, { seed: 4 })).toEqual(r);
  });

  it('reduces to one colour', () => {
    const r = reduceColors([{ color: '#ff0000' }, { color: '#00ff00' }], 1);
    expect(r.clusters).toHaveLength(1);
    expect(r.mapping).toEqual([0, 0]);
  });
});

describe('averageColor', () => {
  it('averages in Lab', () => {
    expect(averageColor([])).toBe('#000000');
    expect(averageColor(['#ABCDEF'])).toBe('#abcdef');
    expect(averageColor(['#336699', '#336699'])).toBe('#336699');
    const avg = hexToLab(averageColor(['#000000', '#ffffff']));
    expect(avg[0]).toBeCloseTo(50, 0);
    const w = hexToLab(averageColor(['#000000', '#ffffff'], [0, 1]));
    expect(w[0]).toBeCloseTo(100, 1);
  });
});
