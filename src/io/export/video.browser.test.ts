// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { planFromCommands } from '@/io/pes/testing';
import { exportVideo, videoSize } from './video';

function zigzag() {
  const cmds: [name: 'STITCH', x: number, y: number][] = [];
  for (let i = 0; i <= 200; i++) cmds.push(['STITCH', (i / 200) * 40, i % 2 ? 10 : 0]);
  return planFromCommands(cmds, [{ color: '#ff0000' }]).plan;
}

async function metadata(blob: Blob) {
  const v = document.createElement('video');
  v.muted = true;
  v.src = URL.createObjectURL(blob);
  await new Promise((resolve, reject) => {
    v.onloadedmetadata = resolve;
    v.onerror = () => reject(v.error);
  });
  // Some containers report Infinity until the end has been seen.
  if (!Number.isFinite(v.duration)) {
    v.currentTime = 1e6;
    await new Promise((r) => (v.ontimeupdate = r));
  }
  return { width: v.videoWidth, height: v.videoHeight, duration: v.duration };
}

describe('exportVideo', () => {
  it('encodes a playable video of the requested length and size', async () => {
    const plan = zigzag();
    let progress = 0;
    const res = await exportVideo(plan, {
      mode: 'flat',
      background: '#ffffff',
      maxSide: 1280,
      timing: { kind: 'length', seconds: 2 },
      machineSpm: 600,
      holdEnd: 1,
      onProgress: (p) => (progress = p),
    });
    expect(['mp4', 'webm']).toContain(res.ext);
    expect(res.blob.type).toBe(res.mime);
    expect(progress).toBe(1);
    const m = await metadata(res.blob);
    const size = videoSize(plan, 1280);
    expect(m.width).toBe(size.width);
    expect(m.height).toBe(size.height);
    expect(m.duration).toBeGreaterThan(2.8);
    expect(m.duration).toBeLessThan(3.2);
  });

  it('stops when aborted', async () => {
    const ctrl = new AbortController();
    const run = exportVideo(zigzag(), {
      mode: 'realistic',
      background: '#ffffff',
      maxSide: 1280,
      timing: { kind: 'length', seconds: 30 },
      machineSpm: 600,
      signal: ctrl.signal,
      onProgress: (p) => p > 0.05 && ctrl.abort(),
    });
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
  });
});
