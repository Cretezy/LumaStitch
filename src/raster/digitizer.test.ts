// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import type { TraceSettings } from '@/model/types';
import { deltaEHex } from '@/threads/color';
import { RasterDigitizer } from './digitizer';
import { flattenGeom, insideRings, renderScene, ringsBounds, type SynthShape } from './__tests__/synth';

const RED = '#d62828';
const BLUE = '#1d4ed8';
const GREEN = '#2a9d4b';
const INK = '#111111';

/** 400×300 logo on white: red rect, blue circle, green bar with a white hole and an ink dot on top. */
function logo(): SynthShape[] {
  return [
    { kind: 'rect', x0: 40.3, y0: 40.6, x1: 180.2, y1: 140.4, color: RED },
    { kind: 'circle', cx: 280.4, cy: 90.2, r: 60, color: BLUE },
    { kind: 'rect', x0: 60.5, y0: 180.3, x1: 340.2, y1: 260.6, color: GREEN },
    { kind: 'circle', cx: 300.2, cy: 220.4, r: 18, color: '#ffffff' },
    { kind: 'circle', cx: 200.3, cy: 220.1, r: 25, color: INK },
  ];
}

const baseTrace: TraceSettings = {
  colors: 'auto',
  palette: [],
  background: 'auto',
  detail: 0.5,
  smoothness: 0.5,
  lineArt: false,
};

describe('RasterDigitizer end-to-end', () => {
  it('traces a 4-colour logo on white into 4 stitched colours of non-overlapping cutouts', async () => {
    const img = renderScene(400, 300, '#ffffff', logo());
    const d = new RasterDigitizer();
    const info = await d.load(img, { width: 90 });
    expect(info.workWidth).toBe(900);
    expect(info.workHeight).toBe(675);
    expect(info.widthMm).toBeCloseTo(90, 6);
    expect(info.heightMm).toBeCloseTo(67.5, 6);
    expect(info.hasAlpha).toBe(false);

    const q = await d.quantize({ colors: 'auto', preview: true, background: 'auto' });
    expect(q.suggestedK).toBe(5);
    expect(q.palette).toHaveLength(5);
    expect(q.backgroundIndex).toBe(0); // white dominates
    expect(deltaEHex(q.palette[0].color, '#ffffff')).toBeLessThan(2);
    expect(q.labelPreview.rgba.length).toBe(q.labelPreview.width * q.labelPreview.height * 4);

    const t0 = performance.now();
    const res = await d.trace(baseTrace, false);
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(5000);
    const colors = new Set(res.shapes.map((s) => s.paletteIndex));
    expect(colors.size).toBe(4);
    expect(res.shapes.some((s) => s.paletteIndex === q.backgroundIndex)).toBe(false);
    for (const want of [RED, BLUE, GREEN, INK]) {
      expect(res.shapes.some((s) => deltaEHex(s.color, want) < 3)).toBe(true);
    }
    expect(res.widthMm).toBeCloseTo(90);

    // Bounds: original px → mm is (p - centre) * 0.225
    const s = 90 / 400;
    const mm = (px: number, c: number) => (px - c) * s;
    const all = res.shapes.flatMap((sh) => flattenGeom(sh.geom));
    const b = ringsBounds(all);
    expect(b.minX).toBeCloseTo(mm(40.3, 200), 0);
    expect(b.maxX).toBeCloseTo(mm(340.5, 200), 0);
    expect(b.minY).toBeCloseTo(mm(30.2, 150), 0);
    expect(b.maxY).toBeCloseTo(mm(260.6, 150), 0);

    // Regions must not overlap: sample a grid and count containment.
    const flat = res.shapes.map((sh) => ({ idx: sh.paletteIndex, rings: flattenGeom(sh.geom) }));
    const bbs = flat.map((f) => ringsBounds(f.rings));
    let inside = 0;
    let overlap = 0;
    const perColour = new Map<number, number>();
    const step = 0.25;
    for (let y = -33.75 + step / 2; y < 33.75; y += step) {
      for (let x = -45 + step / 2; x < 45; x += step) {
        let hits = 0;
        let hitIdx = -1;
        for (let k = 0; k < flat.length; k++) {
          const bb = bbs[k];
          if (x < bb.minX || x > bb.maxX || y < bb.minY || y > bb.maxY) continue;
          if (insideRings(flat[k].rings, x, y)) {
            hits++;
            hitIdx = flat[k].idx;
          }
        }
        if (hits > 0) inside++;
        if (hits > 1) overlap++;
        if (hits === 1) perColour.set(hitIdx, (perColour.get(hitIdx) ?? 0) + 1);
      }
    }
    expect(overlap / inside).toBeLessThan(0.005);

    // The white hole in the green bar stays a hole; the ink dot is not covered by green.
    const holeX = mm(300.2, 200);
    const holeY = mm(220.4, 150);
    const dotX = mm(200.3, 200);
    const dotY = mm(220.1, 150);
    const containing = (x: number, y: number) =>
      flat.filter((f) => insideRings(f.rings, x, y)).map((f) => f.idx);
    expect(containing(holeX, holeY)).toEqual([]);
    const atDot = containing(dotX, dotY);
    expect(atDot).toHaveLength(1);
    expect(deltaEHex(q.palette[atDot[0]].color, INK)).toBeLessThan(3);

    // Areas per colour roughly match the drawn shapes (in mm²).
    const area = (idx: number) => (perColour.get(idx) ?? 0) * step * step;
    const idxOf = (hex: string) => q.palette.findIndex((p) => deltaEHex(p.color, hex) < 3);
    const redArea = (180.2 - 40.3) * (140.4 - 40.6) * s * s;
    const blueArea = Math.PI * 60 * 60 * s * s;
    const inkArea = Math.PI * 25 * 25 * s * s;
    const greenArea = (340.2 - 60.5) * (260.6 - 180.3) * s * s - Math.PI * (18 * 18 + 25 * 25) * s * s;
    expect(area(idxOf(RED)) / redArea).toBeCloseTo(1, 1);
    expect(area(idxOf(BLUE)) / blueArea).toBeCloseTo(1, 1);
    expect(area(idxOf(INK)) / inkArea).toBeCloseTo(1, 1);
    expect(area(idxOf(GREEN)) / greenArea).toBeCloseTo(1, 1);
  });

  it('caches stages: detail changes do not re-quantise, repeated calls hit the cache', async () => {
    const d = new RasterDigitizer();
    await d.load(renderScene(200, 150, '#ffffff', logo().map(scaleShape(0.5))), { width: 60 });
    const a = await d.trace(baseTrace, true);
    const t0 = performance.now();
    const b = await d.trace(baseTrace, true);
    expect(performance.now() - t0).toBeLessThan(50);
    expect(b).toEqual(a);
    const c = await d.trace({ ...baseTrace, detail: 0.9 }, true);
    expect(new Set(c.shapes.map((s) => s.paletteIndex)).size).toBe(4);
  });

  it('palette indices do not depend on the target size (re-trace is reproducible)', async () => {
    const img = renderScene(200, 150, '#ffffff', logo().map(scaleShape(0.5)));
    const a = new RasterDigitizer();
    await a.load(img, { width: 30 });
    const b = new RasterDigitizer();
    await b.load(img, { width: 150 });
    const qa = await a.quantize({ colors: 'auto', preview: false, background: 'auto' });
    const qb = await b.quantize({ colors: 'auto', preview: true, background: 'auto' });
    expect(qb.palette.map((p) => p.color)).toEqual(qa.palette.map((p) => p.color));
    expect(qb.backgroundIndex).toBe(qa.backgroundIndex);
  });

  it('applies palette edits: merge, recolour and skip', async () => {
    const d = new RasterDigitizer();
    await d.load(renderScene(200, 150, '#ffffff', logo().map(scaleShape(0.5))), { width: 60 });
    const q = await d.quantize({ colors: 'auto', preview: true, background: 'auto' });
    const idx = (hex: string) => q.palette.findIndex((p) => deltaEHex(p.color, hex) < 3);
    const red = idx(RED);
    const blue = idx(BLUE);
    const green = idx(GREEN);
    const ink = idx(INK);
    const res = await d.trace(
      {
        ...baseTrace,
        palette: [
          { index: blue, mergeInto: red },
          { index: red, color: '#ff00ff' },
          { index: green, skip: true },
        ],
      },
      true,
    );
    const used = new Set(res.shapes.map((s) => s.paletteIndex));
    expect([...used].sort()).toEqual([red, ink].sort());
    expect(res.shapes.filter((s) => s.paletteIndex === red).every((s) => s.color === '#ff00ff')).toBe(true);
    // background can be toggled back on
    const all = await d.trace({ ...baseTrace, background: 'none' }, true);
    expect(new Set(all.shapes.map((s) => s.paletteIndex)).size).toBe(5);
  });

  it('treats transparency as background', async () => {
    const shapes = logo().filter((s) => s.color !== '#ffffff');
    const img = renderScene(400, 300, [0, 0, 0, 0], shapes);
    const d = new RasterDigitizer();
    const info = await d.load(img, { height: 50 });
    expect(info.hasAlpha).toBe(true);
    expect(info.heightMm).toBeCloseTo(50, 6);
    const q = await d.quantize({ colors: 'auto', preview: true, background: 'auto' });
    expect(q.backgroundIndex).not.toBeNull();
    expect(q.palette[q.backgroundIndex!].color).toBe('#ffffff');
    expect(q.suggestedK).toBe(4);
    const res = await d.trace(baseTrace, true);
    expect(new Set(res.shapes.map((s) => s.paletteIndex)).size).toBe(4);
  });

  it('flags photo-like images and still produces a bounded palette quickly', async () => {
    const w = 240;
    const h = 180;
    const data = new Uint8ClampedArray(w * h * 4);
    let seed = 3;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32 - 0.5) * 70;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        data[i] = (x / w) * 255 + rnd();
        data[i + 1] = (y / h) * 255 + rnd();
        data[i + 2] = 128 + 100 * Math.sin(x / 15) + rnd();
        data[i + 3] = 255;
      }
    }
    const d = new RasterDigitizer();
    await d.load({ data, width: w, height: h }, { width: 40 });
    const t0 = performance.now();
    const q = await d.quantize({ colors: 'auto', preview: true, background: 'auto' });
    expect(performance.now() - t0).toBeLessThan(1500);
    expect(q.suggestedK).toBeGreaterThanOrEqual(2);
    expect(q.suggestedK).toBeLessThanOrEqual(16);
    const res = await d.trace({ ...baseTrace, detail: 0.2 }, true);
    expect(res.warnings.some((w) => /photo/i.test(w))).toBe(true);
  });

  it('line-art mode turns thin dark lines into centreline strokes', async () => {
    // A 4 px (0.4 mm at 0.1 mm/px) dark ring and a thin cross on white, at 1 px = 0.1 mm.
    const shapes: SynthShape[] = [
      { kind: 'circle', cx: 100, cy: 100, r: 60, color: INK },
      { kind: 'circle', cx: 100, cy: 100, r: 56, color: '#ffffff' },
      { kind: 'rect', x0: 30, y0: 98, x1: 170, y1: 102, color: INK },
      { kind: 'rect', x0: 150, y0: 150, x1: 190, y1: 190, color: RED },
    ];
    const d = new RasterDigitizer();
    await d.load(renderScene(200, 200, '#ffffff', shapes), { width: 20 });
    const res = await d.trace({ ...baseTrace, lineArt: true }, false);
    const strokes = res.shapes.filter((s) => s.lineArt);
    expect(strokes.length).toBe(1);
    expect(strokes[0].strokeWidth!).toBeGreaterThan(0.25);
    expect(strokes[0].strokeWidth!).toBeLessThan(0.6);
    expect(strokes[0].geom.subpaths.length).toBeGreaterThanOrEqual(2);
    // The red square is still a fill; no ink fill remains.
    const fills = res.shapes.filter((s) => !s.lineArt);
    expect(fills.every((s) => deltaEHex(s.color, RED) < 3)).toBe(true);
  });
});

function scaleShape(k: number) {
  return (s: SynthShape): SynthShape =>
    s.kind === 'rect'
      ? { ...s, x0: s.x0 * k, y0: s.y0 * k, x1: s.x1 * k, y1: s.y1 * k }
      : { ...s, cx: s.cx * k, cy: s.cy * k, r: s.r * k };
}
