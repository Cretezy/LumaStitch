// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { deltaEHex, hexToLab } from '@/threads/color';
import { RasterDigitizer } from './digitizer';
import { autoK, kmeans } from './kmeans';
import { mulberry32 } from './prng';
import { absorbBlends } from './quantize';
import { renderScene, type SynthShape } from './__tests__/synth';

function blobs(n: number, seed: number): { data: Float32Array; m: number } {
  const rand = mulberry32(seed);
  const centres = Array.from({ length: n }, (_, i) => [20 + i * 15, (i % 2) * 40 - 20, ((i * 37) % 60) - 30]);
  const m = 3000;
  const data = new Float32Array(m * 3);
  for (let i = 0; i < m; i++) {
    const c = centres[i % n];
    for (let d = 0; d < 3; d++) data[i * 3 + d] = c[d] + (rand() - 0.5) * 3;
  }
  return { data, m };
}

describe('k-means', () => {
  it('is deterministic for a seed', () => {
    const { data, m } = blobs(5, 7);
    const a = kmeans(data, m, 5, 123);
    const b = kmeans(data, m, 5, 123);
    expect(Array.from(a.centers)).toEqual(Array.from(b.centers));
    expect(a.error).toBe(b.error);
    expect(a.k).toBe(5);
    expect(a.outliers).toBe(0);
  });

  it('finds well-separated clusters and auto-k picks their count', () => {
    for (const n of [2, 3, 4, 6, 9]) {
      const { data, m } = blobs(n, n);
      expect(autoK(data, m, 1, true).k).toBe(n);
      if (n <= 4) expect(autoK(data, m, 1, false).k).toBe(n);
    }
  });

  it('returns fewer centres when there are fewer distinct points', () => {
    const data = new Float32Array([1, 2, 3, 1, 2, 3, 4, 5, 6]);
    const r = kmeans(data, 3, 5, 1);
    expect(r.k).toBe(2);
    expect(r.error).toBe(0);
  });
});

const PALETTE = ['#d62828', '#1d4ed8', '#2a9d4b', '#f4c430', '#7b2cbf', '#111111'];

/** Anti-aliased n-colour image: background + (n-1) shapes. */
function nColourImage(n: number) {
  const shapes: SynthShape[] = [];
  for (let i = 0; i < n - 1; i++) {
    const cx = 60 + (i % 3) * 100;
    const cy = 60 + Math.floor(i / 3) * 100;
    shapes.push(
      i % 2
        ? { kind: 'circle', cx: cx + 0.3, cy: cy + 0.7, r: 38.4, color: PALETTE[i] }
        : { kind: 'rect', x0: cx - 37.3, y0: cy - 30.6, x1: cx + 36.5, y1: cy + 33.2, color: PALETTE[i] },
    );
  }
  return renderScene(320, 220, '#ffffff', shapes, 2, n);
}

describe('quantize (auto colour count)', () => {
  for (const n of [2, 3, 4, 6]) {
    it(`suggests ${n} colours for an anti-aliased ${n}-colour image`, async () => {
      const d = new RasterDigitizer();
      await d.load(nColourImage(n), { width: 64 });
      const q = await d.quantize({ colors: 'auto', preview: true, background: 'auto' });
      expect(q.suggestedK).toBe(n);
      expect(q.palette).toHaveLength(n);
      expect(q.backgroundIndex).toBe(0);
      // every drawn colour is in the palette
      for (let i = 0; i < n - 1; i++) {
        expect(q.palette.some((p) => deltaEHex(p.color, PALETTE[i]) < 3)).toBe(true);
      }
      const total = q.palette.reduce((a, p) => a + p.pixelShare, 0);
      expect(total).toBeCloseTo(1, 6);
      const full = await d.quantize({ colors: 'auto', preview: false, background: 'auto' });
      expect(full.palette.map((p) => p.color)).toEqual(q.palette.map((p) => p.color));
    });
  }

  it('honours an explicit colour count and clamps to 2..16', async () => {
    const d = new RasterDigitizer();
    await d.load(nColourImage(4), { width: 64 });
    expect((await d.quantize({ colors: 3, preview: true, background: 'auto' })).palette).toHaveLength(3);
    const one = await d.quantize({ colors: 1, preview: true, background: 'auto' });
    expect(one.palette).toHaveLength(2);
    expect(one.suggestedK).toBe(4);
  });
});

describe('blend absorption', () => {
  it('an anti-aliased circle on white yields exactly 2 colours, without fringe labels', async () => {
    const img = renderScene(300, 300, '#ffffff', [
      { kind: 'circle', cx: 150.3, cy: 149.6, r: 100.2, color: '#1d4ed8' },
    ]);
    const d = new RasterDigitizer();
    await d.load(img, { width: 30 }); // 1:1 working resolution
    const q = await d.quantize({ colors: 'auto', preview: false, background: 'auto' });
    expect(q.suggestedK).toBe(2);
    expect(q.palette).toHaveLength(2);
    const area = (Math.PI * 100.2 * 100.2) / (300 * 300);
    expect(q.palette[1].pixelShare).toBeCloseTo(area, 2);
  });

  it('relabels thin blend runs between two clusters even when a third cluster is nearer', () => {
    // labels: 0 = black, 1 = white, 2 = mid grey. Row: black black grey grey white white
    const pal = new Float32Array([...hexToLab('#000000'), ...hexToLab('#ffffff'), ...hexToLab('#777777')]);
    const w = 6;
    const h = 1;
    const labels = new Uint8Array([0, 0, 2, 2, 1, 1]);
    const lab = new Float32Array(w * 3);
    const px = ['#000000', '#000000', '#555555', '#999999', '#ffffff', '#ffffff'];
    px.forEach((c, i) => lab.set(hexToLab(c), i * 3));
    const out = absorbBlends(labels, lab, w, h, pal, 2);
    expect(Array.from(out)).toEqual([0, 0, 0, 1, 1, 1]);
    // A 3 px run is real detail and is kept; so is a run bounded by the same label on both sides.
    expect(Array.from(absorbBlends(new Uint8Array([0, 2, 2, 2, 1, 1]), lab, w, h, pal, 2))).toEqual([
      0, 2, 2, 2, 1, 1,
    ]);
    expect(Array.from(absorbBlends(new Uint8Array([0, 0, 2, 2, 0, 0]), lab, w, h, pal, 2))).toEqual([
      0, 0, 2, 2, 0, 0,
    ]);
  });

  it('keeps a real third colour that is not between its neighbours', () => {
    const pal = new Float32Array([...hexToLab('#000000'), ...hexToLab('#ffffff'), ...hexToLab('#ff0000')]);
    const lab = new Float32Array(6 * 3);
    ['#000000', '#000000', '#ff0000', '#ff0000', '#ffffff', '#ffffff'].forEach((c, i) =>
      lab.set(hexToLab(c), i * 3),
    );
    const out = absorbBlends(new Uint8Array([0, 0, 2, 2, 1, 1]), lab, 6, 1, pal, 2);
    expect(Array.from(out)).toEqual([0, 0, 2, 2, 1, 1]);
  });
});
