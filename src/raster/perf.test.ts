// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Performance check (ARCHITECTURE §19 / task target): 2000×2000 px, 8 colours, full trace < 5 s and the
 * preview path < 1 s. Skipped by default; run with `RASTER_PERF=1 npx vitest run --project unit src/raster/perf`.
 */
import { describe, expect, it } from 'vitest';
import type { TraceSettings } from '@/model/types';
import { RasterDigitizer } from './digitizer';
import { mulberry32 } from './prng';
import { renderScene, type SynthShape } from './__tests__/synth';

const run = typeof process !== 'undefined' && process.env.RASTER_PERF === '1';

function scene(): SynthShape[] {
  const colors = ['#e63946', '#1d3557', '#2a9d8f', '#e9c46a', '#f4a261', '#6a4c93', '#111111'];
  const rand = mulberry32(42);
  const shapes: SynthShape[] = [];
  for (let i = 0; i < 60; i++) {
    const color = colors[i % colors.length];
    if (i % 2) {
      const x0 = rand() * 1800;
      const y0 = rand() * 1800;
      shapes.push({ kind: 'rect', x0, y0, x1: x0 + 40 + rand() * 300, y1: y0 + 40 + rand() * 300, color });
    } else {
      shapes.push({
        kind: 'circle',
        cx: 100 + rand() * 1800,
        cy: 100 + rand() * 1800,
        r: 20 + rand() * 150,
        color,
      });
    }
  }
  return shapes;
}

describe.skipIf(!run)('raster performance', () => {
  it('2000×2000 px, 8 colours', async () => {
    const img = renderScene(2000, 2000, '#ffffff', scene(), 3);
    const opts: TraceSettings = {
      colors: 'auto',
      palette: [],
      background: 'auto',
      detail: 0.5,
      smoothness: 0.5,
      lineArt: false,
    };
    const d = new RasterDigitizer();
    const t0 = performance.now();
    const info = await d.load(img, { width: 200 });
    const t1 = performance.now();
    const q = await d.quantize({ colors: 'auto', preview: true, background: 'auto' });
    const t2 = performance.now();
    const pv = await d.trace(opts, true);
    const t3 = performance.now();
    const full = await d.trace(opts, false);
    const t4 = performance.now();
    const detail = await d.trace({ ...opts, detail: 0.8 }, false);
    const t5 = performance.now();
    console.log(
      JSON.stringify(
        {
          work: `${info.workWidth}×${info.workHeight}`,
          suggestedK: q.suggestedK,
          loadMs: Math.round(t1 - t0),
          quantizePreviewMs: Math.round(t2 - t1),
          tracePreviewMs: Math.round(t3 - t2),
          previewTotalMs: Math.round(t3 - t0),
          traceFullMs: Math.round(t4 - t3),
          fullTotalMs: Math.round(t4 - t0),
          retraceDetailMs: Math.round(t5 - t4),
          previewShapes: pv.shapes.length,
          fullShapes: full.shapes.length,
          detailShapes: detail.shapes.length,
        },
        null,
        2,
      ),
    );
    expect(q.suggestedK).toBe(8);
    expect(t3 - t1).toBeLessThan(1000);
    expect(t4 - t0).toBeLessThan(5000);
  });
});
