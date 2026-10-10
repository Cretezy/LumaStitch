// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { planFromCommands, type SynthCommand } from '@/io/pes/testing';
import type { Design } from '@/model/types';
import { exportPdf, renderPlanJpeg } from './pdf';

function sample() {
  const cmds: SynthCommand[] = [];
  for (let i = 0; i <= 40; i += 2) cmds.push(['STITCH', i, i % 4 === 0 ? 0 : 20]);
  cmds.push(['TRIM'], ['COLOR_CHANGE'], ['JUMP', 0, 30]);
  for (let i = 0; i <= 40; i += 2) cmds.push(['STITCH', i, i % 4 === 0 ? 30 : 40]);
  cmds.push(['END']);
  const { plan, design } = planFromCommands(
    cmds,
    [
      { color: '#c1121f', name: 'Red', code: '1902', chart: 'isacord-polyester' },
      { color: '#003049', name: 'Navy' },
    ],
    { name: 'Browser PDF' },
  );
  return { plan, design: { ...design, fabric: 'woven' } as Pick<Design, 'name' | 'threads' | 'fabric'> };
}

function latin1(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
}

describe('exportPdf (browser)', () => {
  it('renders the realistic preview as a JPEG', async () => {
    const { plan } = sample();
    const jpeg = await renderPlanJpeg(plan, { maxSide: 600 });
    expect(jpeg).not.toBeNull();
    expect(jpeg!.width).toBe(600);
    expect([...jpeg!.bytes.slice(0, 2)]).toEqual([0xff, 0xd8]);
    // Decodes, and the thread colour is there on a white background.
    const bmp = await createImageBitmap(new Blob([jpeg!.bytes.slice()], { type: 'image/jpeg' }));
    expect([bmp.width, bmp.height]).toEqual([jpeg!.width, jpeg!.height]);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0);
    const data = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
    expect(data[0]).toBeGreaterThan(240); // white corner
    let reddish = 0;
    for (let i = 0; i < data.length; i += 4)
      if (data[i] > 120 && data[i + 1] < 80 && data[i + 2] < 80) reddish++;
    expect(reddish).toBeGreaterThan(200);
  });

  it('produces a PDF with the JPEG preview embedded', async () => {
    const { plan, design } = sample();
    const blob = await exportPdf(plan, design, { date: new Date(2026, 9, 10) });
    expect(blob.type).toBe('application/pdf');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const s = latin1(bytes);
    expect(s.startsWith('%PDF-1.4')).toBe(true);
    expect(s).toContain('/Count 1');
    expect(s).toContain('(Browser PDF)');
    expect(s).toContain('(Isacord Polyester 1902)');
    const m =
      /\/Width (\d+) \/Height (\d+) \/ColorSpace \/DeviceRGB \/BitsPerComponent 8 \/Filter \/DCTDecode \/Length (\d+) >>\nstream\n/.exec(
        s,
      );
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(1400);
    const start = m!.index + m![0].length;
    const len = Number(m![3]);
    expect([bytes[start], bytes[start + 1]]).toEqual([0xff, 0xd8]);
    expect([bytes[start + len - 2], bytes[start + len - 1]]).toEqual([0xff, 0xd9]);
    // The embedded image decodes at the declared size.
    const bmp = await createImageBitmap(new Blob([bytes.slice(start, start + len)], { type: 'image/jpeg' }));
    expect([bmp.width, bmp.height]).toEqual([Number(m![1]), Number(m![2])]);
  });
});
