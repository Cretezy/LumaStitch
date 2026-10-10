// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { detectBackground, dominantBorderLabel } from './background';
import { cleanLabels, morphLabels } from './clean';
import { connectedComponents, mergeSmallRegions } from './components';
import { minAreaForDetail, morphRadiusForDetail, potraceParamsFor } from './config';
import { compositeOnWhite, median3 } from './filter';
import { distanceTransform2, douglasPeucker, skeletonToPolylines, zhangSuen } from './lineArt';
import { close, dilate, erode, open } from './morphology';
import { remapLabels, resolvePalette } from './palette';
import { computePreviewSize, computeWorkSize, resampleRGBA } from './resample';

/** Parse an ASCII grid: '.' = 0, digits = labels, '#' = 1. */
function grid(rows: string[]): { a: Uint8Array; w: number; h: number } {
  const h = rows.length;
  const w = rows[0].length;
  const a = new Uint8Array(w * h);
  rows.forEach((r, y) =>
    [...r].forEach((c, x) => (a[y * w + x] = c === '.' ? 0 : c === '#' ? 1 : Number(c))),
  );
  return { a, w, h };
}

function show(a: Uint8Array, w: number): string[] {
  const rows: string[] = [];
  for (let y = 0; y < a.length / w; y++) rows.push(Array.from(a.subarray(y * w, y * w + w)).join(''));
  return rows;
}

describe('morphology', () => {
  it('opening removes thin lines and specks, closing fills small holes', () => {
    const { a, w, h } = grid([
      '..........',
      '.####.....',
      '.####..#..',
      '.####.....',
      '.####.....',
      '..........',
      '##########',
      '..........',
    ]);
    const o = open(a, w, h, 1);
    expect(o[2 * w + 7]).toBe(0); // speck
    expect(o[6 * w + 4]).toBe(0); // 1-px line
    expect(o[1 * w + 1]).toBe(1); // block corner survives (square SE)
    expect(o[4 * w + 4]).toBe(1);
    const holed = grid(['.......', '.#####.', '.#####.', '.##.##.', '.#####.', '.#####.', '.......']);
    const c = close(holed.a, holed.w, holed.h, 1);
    expect(c[3 * 7 + 3]).toBe(1); // hole filled
    expect(c[0]).toBe(0);
    expect(close(a, w, h, 1)[6 * w]).toBe(1); // line kept (touches border)
  });

  it('erosion does not eat regions from the image border; dilation grows by r', () => {
    const { a, w, h } = grid(['###..', '###..', '###..']);
    expect(show(erode(a, w, h, 1), w)).toEqual(['11000', '11000', '11000']);
    expect(show(dilate(a, w, h, 1), w)).toEqual(['11110', '11110', '11110']);
  });

  it('morphLabels keeps a partition (every pixel labelled exactly once)', () => {
    const { a, w, h } = grid([
      '0000000000000000',
      '0000000000000000',
      '0011111110000000',
      '0011111110002200',
      '0011111110002200',
      '0011101110000000',
      '0011111110000000',
      '0011111110000000',
      '0011111110000000',
      '0000000000000000',
      '0000000000000000',
    ]);
    const out = morphLabels(a, w, h, 3, 1);
    expect(out.length).toBe(a.length);
    for (const v of out) expect(v).toBeLessThan(3);
    expect(out[5 * w + 5]).toBe(1); // the 1-px hole in label 1 is closed
    expect(out[3 * w + 12]).toBe(0); // the 2-px wide speck of label 2 is opened away
    expect(out[4 * w + 13]).toBe(0);
    expect(out[2 * w + 2]).toBe(1); // corners kept
    expect(out[1 * w + 2]).toBe(0); // not glued to the border
  });
});

describe('connected components', () => {
  it('labels 4- and 8-connected regions with union-find', () => {
    const { a, w, h } = grid(['1100', '0100', '0011', '1001']);
    const c4 = connectedComponents(a, w, h, 4);
    // label-1 groups (4-conn): {(0,0),(1,0),(1,1)}, {(2,2),(3,2),(3,3)}, {(0,3)}; label-0 groups too
    const ones = Array.from({ length: c4.count }, (_, i) => i).filter((i) => c4.label[i] === 1);
    expect(ones.map((i) => c4.size[i]).sort()).toEqual([1, 3, 3]);
    const c8 = connectedComponents(a, w, h, 8);
    const ones8 = Array.from({ length: c8.count }, (_, i) => i).filter((i) => c8.label[i] === 1);
    expect(ones8.map((i) => c8.size[i]).sort()).toEqual([1, 6]);
    // U-shape needs the union step
    const u = grid(['1.1', '1.1', '111']);
    const cu = connectedComponents(u.a, u.w, u.h, 4);
    expect(cu.count).toBe(2);
  });

  it('merges small regions into the neighbour with the longest shared border', () => {
    const { a, w, h } = grid([
      '1111222222',
      '1111222222',
      '1113322222', // region 3 (2 px) borders 1 on one side and 2 on two sides
      '1111222222',
    ]);
    const res = mergeSmallRegions(a, w, h, 3);
    expect(res.merged).toBe(1);
    expect(res.labels[2 * w + 3]).toBe(2);
    expect(res.labels[2 * w + 4]).toBe(2);
    // chains: a speck inside a speck
    const g = grid(['00000', '01110', '01210', '01110', '00000']);
    const r2 = mergeSmallRegions(g.a, g.w, g.h, 10);
    expect(new Set(r2.labels)).toEqual(new Set([0]));
  });

  it('cleanLabels combines morphology and min-area merge', () => {
    const { a, w, h } = grid(['0000000', '0111000', '0111020', '0111000', '0000000']);
    const res = cleanLabels(a, w, h, 3, 0, 2);
    expect(res.labels[2 * w + 5]).toBe(0);
    expect(res.labels[2 * w + 2]).toBe(1);
  });
});

describe('background detection', () => {
  it('picks the dominant border colour', () => {
    const { a, w, h } = grid(['00000', '01110', '01210', '01110', '00000']);
    expect(dominantBorderLabel(a, w, h, 3)).toEqual([0, 16 / 24]); // 2-px ring
    expect(detectBackground('auto', a, w, h, ['#ffffff', '#ff0000', '#000000'], null)).toBe(0);
    expect(detectBackground('none', a, w, h, ['#ffffff', '#ff0000', '#000000'], null)).toBeNull();
    expect(detectBackground('#fe0101', a, w, h, ['#ffffff', '#ff0000', '#000000'], null)).toBe(1);
  });

  it('prefers transparency, and returns null when no colour dominates the border', () => {
    const { a, w, h } = grid(['01010', '10101', '01010']);
    expect(detectBackground('auto', a, w, h, ['#ffffff', '#000000', '#ffffff'], 2)).toBe(2);
    const mixed = grid(['0123', '1..2', '2..1', '3210']);
    expect(
      detectBackground('auto', mixed.a, mixed.w, mixed.h, ['#000', '#111', '#222', '#333'], null),
    ).toBeNull();
  });

  it('composites transparent pixels onto white and flags them', () => {
    const rgba = new Uint8ClampedArray([0, 0, 0, 0, 255, 0, 0, 255, 0, 0, 255, 64, 0, 0, 0, 200]);
    const c = compositeOnWhite(rgba, 4);
    expect(Array.from(c.transparent!)).toEqual([1, 0, 1, 0]);
    expect(Array.from(c.rgb.subarray(0, 3))).toEqual([255, 255, 255]);
    expect(Array.from(c.rgb.subarray(3, 6))).toEqual([255, 0, 0]);
    expect(compositeOnWhite(new Uint8ClampedArray([1, 2, 3, 255]), 1).transparent).toBeNull();
  });
});

describe('palette edits', () => {
  it('resolves merges (chains, cycles), recolours and skips, background skipped by default', () => {
    const base = ['#ffffff', '#ff0000', '#00ff00', '#0000ff', '#000000'];
    const r = resolvePalette(
      base,
      [
        { index: 1, mergeInto: 2 },
        { index: 2, mergeInto: 3 },
        { index: 3, color: '#123456' },
        { index: 4, skip: true },
      ],
      0,
    );
    expect(Array.from(r.remap)).toEqual([0, 3, 3, 3, 4]);
    expect(r.colors[3]).toBe('#123456');
    expect(r.skip).toEqual([true, false, false, false, true]);
    const cyc = resolvePalette(
      base,
      [
        { index: 1, mergeInto: 2 },
        { index: 2, mergeInto: 1 },
      ],
      null,
    );
    expect(Array.from(cyc.remap)).toEqual([0, 1, 1, 3, 4]);
    const unskipBg = resolvePalette(base, [{ index: 0, skip: false }], 0);
    expect(unskipBg.skip[0]).toBe(false);
    expect(Array.from(remapLabels(new Uint8Array([0, 1, 2, 3, 4]), r.remap))).toEqual([0, 3, 3, 3, 4]);
  });
});

describe('line art helpers', () => {
  it('distance transform gives squared distance to the background', () => {
    const { a, w, h } = grid(['.......', '.#####.', '.#####.', '.#####.', '.......']);
    const dt = distanceTransform2(a, w, h);
    expect(dt[2 * w + 3]).toBe(4);
    expect(dt[1 * w + 1]).toBe(1);
    expect(dt[0]).toBe(0);
  });

  it('Zhang–Suen thins a thick bar to a 1-px line walked as one polyline', () => {
    const rows = ['..............', ...Array.from({ length: 5 }, () => '.############.'), '..............'];
    const { a, w } = grid(rows);
    zhangSuen(a, w);
    const count = a.reduce((s, v) => s + v, 0);
    expect(count).toBeGreaterThan(5);
    expect(count).toBeLessThan(14);
    // every skeleton pixel sits on the middle row ± 1
    a.forEach((v, i) => v && expect(Math.abs(Math.floor(i / w) - 3)).toBeLessThanOrEqual(1));
    const pls = skeletonToPolylines(a, w);
    expect(pls).toHaveLength(1);
    expect(pls[0].closed).toBe(false);
  });

  it('walks rings as closed polylines and simplifies with Douglas–Peucker', () => {
    const { a, w } = grid(['.......', '.#####.', '.#...#.', '.#...#.', '.#####.', '.......']);
    zhangSuen(a, w); // also removes the staircase corners
    const pls = skeletonToPolylines(a, w);
    expect(pls).toHaveLength(1);
    expect(pls[0].closed).toBe(true);
    expect(pls[0].pts.length).toBeGreaterThanOrEqual(8);
    const xy = [0, 0, 1, 0.01, 2, -0.01, 3, 0, 3, 1, 3, 2];
    expect(douglasPeucker(xy, 0.1)).toEqual([0, 0, 3, 0, 3, 2]);
  });
});

describe('resampling and filters', () => {
  it('area-averages when shrinking and keeps exact colours of flat regions', () => {
    const src = new Uint8ClampedArray(4 * 4 * 4);
    for (let i = 0; i < 16; i++) src.set(i % 4 < 2 ? [255, 0, 0, 255] : [0, 0, 255, 255], i * 4);
    const out = resampleRGBA(src, 4, 4, 2, 2);
    expect(Array.from(out.subarray(0, 4))).toEqual([255, 0, 0, 255]);
    expect(Array.from(out.subarray(4, 8))).toEqual([0, 0, 255, 255]);
    const half = resampleRGBA(src, 4, 4, 1, 1);
    expect(half[0]).toBe(128);
    expect(half[2]).toBe(128);
  });

  it('uses premultiplied alpha (no dark fringes from transparent black)', () => {
    const src = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 0]);
    const out = resampleRGBA(src, 2, 1, 1, 1);
    expect(Array.from(out)).toEqual([255, 0, 0, 128]);
    const up = resampleRGBA(src, 2, 1, 4, 1);
    expect(up[0]).toBe(255);
    expect(up[3]).toBe(255);
  });

  it('computes the working and preview sizes', () => {
    const s = computeWorkSize(400, 300, { width: 90 });
    expect([s.workWidth, s.workHeight, s.mmPerPx]).toEqual([900, 675, 0.1]);
    const big = computeWorkSize(4000, 4000, { width: 400 });
    expect(big.workWidth * big.workHeight).toBeLessThanOrEqual(4_000_000);
    expect(big.widthMm).toBeCloseTo(400, 6);
    const byH = computeWorkSize(200, 100, { height: 25 });
    expect(byH.heightMm).toBeCloseTo(25, 9);
    expect(byH.widthMm).toBeCloseTo(50, 9);
    const p = computePreviewSize(2000, 2000);
    expect(p.width * p.height).toBeLessThanOrEqual(1_000_000);
    expect(computePreviewSize(300, 200)).toEqual({ width: 300, height: 200 });
  });

  it('median filter removes salt noise', () => {
    const w = 3;
    const rgb = new Uint8Array(9 * 3).fill(10);
    rgb.set([250, 250, 250], 4 * 3);
    const out = median3(rgb, w, 3);
    expect(Array.from(out.subarray(12, 15))).toEqual([10, 10, 10]);
  });
});

describe('slider mappings', () => {
  it('maps detail and smoothness monotonically', () => {
    expect(minAreaForDetail(0.5)).toBeCloseTo(1);
    expect(minAreaForDetail(0)).toBeGreaterThan(minAreaForDetail(1));
    expect(morphRadiusForDetail(1)).toBe(0);
    const lo = potraceParamsFor(0, 0.1);
    const hi = potraceParamsFor(1, 0.1);
    expect(hi.alphamax).toBeGreaterThan(lo.alphamax);
    expect(hi.opttolerance).toBeGreaterThan(lo.opttolerance);
    expect(potraceParamsFor(1, 0.4).turdsize).toBeLessThan(hi.turdsize);
  });
});
