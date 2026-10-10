// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { planFromCommands } from '@/io/pes/testing';
import { exportPng, pngSize } from './png';
import { watermarkStrip } from './watermark';

const RED = { color: '#ff0000' };

function wideplan() {
  // 40 × 10 mm zig-zag.
  const cmds: [name: 'STITCH', x: number, y: number][] = [];
  for (let i = 0; i <= 40; i += 2) cmds.push(['STITCH', i, i % 4 === 0 ? 0 : 10]);
  return planFromCommands(cmds, [RED]).plan;
}

async function decode(blob: Blob) {
  const bmp = await createImageBitmap(blob);
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = c.getContext('2d')!;
  ctx.drawImage(bmp, 0, 0);
  return { width: bmp.width, height: bmp.height, data: ctx.getImageData(0, 0, bmp.width, bmp.height).data };
}

describe('exportPng', () => {
  it('produces a PNG whose longest side is maxSide with the design aspect ratio', async () => {
    const plan = wideplan();
    const blob = await exportPng(plan, { mode: 'flat' });
    expect(blob.type).toBe('image/png');
    const sig = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
    expect([...sig]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const img = await decode(blob);
    expect(img.width).toBe(2048);
    expect(img.height).toBe(pngSize(plan).height);
    // 40:10 drawing + padding.
    expect(img.height).toBeGreaterThan(2048 / 4);
    expect(img.height).toBeLessThan(2048 / 4 + 2 * 41 + 2);
    // Transparent background, red thread somewhere.
    expect(img.data[3]).toBe(0);
    let red = 0;
    for (let i = 0; i < img.data.length; i += 4)
      if (img.data[i + 3] > 200 && img.data[i] > 200 && img.data[i + 1] < 60) red++;
    expect(red).toBeGreaterThan(100);
  });

  it('honours maxSide, tall designs and an opaque background', async () => {
    const { plan } = planFromCommands(
      [
        ['STITCH', 0, 0],
        ['STITCH', 5, 30],
        ['STITCH', 10, 0],
      ],
      [RED],
    );
    const blob = await exportPng(plan, { mode: 'realistic', maxSide: 300, background: '#f5f3ef' });
    const img = await decode(blob);
    expect(img.height).toBe(300);
    expect(img.width).toBe(pngSize(plan, 300).width);
    expect(img.width).toBeLessThan(300);
    expect([...img.data.slice(0, 4)]).toEqual([0xf5, 0xf3, 0xef, 255]);
  });

  it('adds the watermark in a strip below the design only when asked', async () => {
    const plan = wideplan();
    const dark = async (watermark?: string) => {
      const img = await decode(await exportPng(plan, { mode: 'flat', maxSide: 600, watermark }));
      // Dark pixels in the bottom-right quarter (the red zig-zag has none).
      let n = 0;
      for (let y = Math.floor(img.height / 2); y < img.height; y++)
        for (let x = Math.floor(img.width / 2); x < img.width; x++) {
          const i = (y * img.width + x) * 4;
          if (img.data[i + 3] > 100 && img.data[i] < 100) n++;
        }
      return n;
    };
    expect(await dark()).toBe(0);
    expect(await dark('Made with LumaStitch')).toBeGreaterThan(50);
    const plain = await decode(await exportPng(plan, { mode: 'flat', maxSide: 600 }));
    const marked = await decode(await exportPng(plan, { mode: 'flat', maxSide: 600, watermark: 'x' }));
    expect(marked.width).toBe(plain.width);
    expect(marked.height).toBe(plain.height + watermarkStrip(600));
  });
});
