// SPDX-License-Identifier: GPL-3.0-or-later
/** Worker round trip in a real browser: ImageBitmap transfer, OffscreenCanvas decode, potrace wasm. */
import { describe, expect, it } from 'vitest';
import { createRasterClient, loadImage, terminateRasterClient } from '@/worker/rasterClient';

describe('raster worker', () => {
  it('loads an ImageBitmap, quantises and traces in the worker', async () => {
    const canvas = new OffscreenCanvas(200, 150);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 200, 150);
    ctx.fillStyle = '#d62828';
    ctx.fillRect(20, 20, 70, 50);
    ctx.fillStyle = '#1d4ed8';
    ctx.beginPath();
    ctx.arc(140, 75, 40, 0, Math.PI * 2);
    ctx.fill();
    const bitmap = await createImageBitmap(canvas);
    const raster = createRasterClient();
    try {
      const info = await loadImage(raster, bitmap, { width: 40 });
      expect(info.workWidth).toBe(400);
      expect(bitmap.width).toBe(0); // transferred
      const q = await raster.quantize({ colors: 'auto', preview: true, background: 'auto' });
      expect(q.suggestedK).toBe(3);
      expect(q.labelPreview.rgba.length).toBe(q.labelPreview.width * q.labelPreview.height * 4);
      const traced = await raster.trace(
        { colors: 'auto', palette: [], background: 'auto', detail: 0.5, smoothness: 0.5, lineArt: false },
        false,
      );
      expect(new Set(traced.shapes.map((s) => s.paletteIndex)).size).toBe(2);
      expect(traced.widthMm).toBeCloseTo(40);
    } finally {
      terminateRasterClient(raster);
    }
  });
});
