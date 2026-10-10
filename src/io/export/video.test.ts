// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { planFromCommands } from '@/io/pes/testing';
import { VIDEO_MAX_SECONDS, VIDEO_MIN_SECONDS, machineStitchSeconds, videoSeconds, videoSize } from './video';

function plan(n: number, w = 40, h = 10) {
  const cmds: [name: 'STITCH', x: number, y: number][] = [];
  for (let i = 0; i < n; i++) cmds.push(['STITCH', (i / (n - 1)) * w, i % 2 ? h : 0]);
  return planFromCommands(cmds, [{ color: '#ff0000' }]).plan;
}

describe('video timing', () => {
  it('derives the length from a speed and the machine rate', () => {
    const p = plan(600);
    const machine = machineStitchSeconds(p, 600);
    // 600 penetrations (plus the encoder's start stitch) at 10 per second.
    expect(machine).toBeGreaterThanOrEqual(60);
    expect(machine).toBeLessThan(61);
    expect(videoSeconds(p, { kind: 'speed', factor: 10 }, 600)).toBeCloseTo(machine / 10, 6);
    expect(videoSeconds(p, { kind: 'length', seconds: 12 }, 600)).toBe(12);
  });

  it('clamps the length', () => {
    const p = plan(600);
    expect(videoSeconds(p, { kind: 'speed', factor: 1e6 }, 600)).toBe(VIDEO_MIN_SECONDS);
    expect(videoSeconds(p, { kind: 'speed', factor: 0.001 }, 600)).toBe(VIDEO_MAX_SECONDS);
    expect(videoSeconds(p, { kind: 'length', seconds: 1e5 }, 600)).toBe(VIDEO_MAX_SECONDS);
  });
});

describe('videoSize', () => {
  it('keeps the aspect ratio with even dimensions and a minimum short side', () => {
    const wide = videoSize(plan(50, 100, 50), 1920);
    expect(wide.width).toBe(1920);
    expect(wide.height % 2).toBe(0);
    expect(wide.height).toBeGreaterThan(900);
    expect(wide.height).toBeLessThan(1100);
    const tall = videoSize(plan(50, 30, 90), 1280);
    expect(tall.height).toBe(1280);
    expect(tall.width % 2).toBe(0);
    // A thin strip still gets a watchable frame.
    const strip = videoSize(plan(50, 200, 2), 1280);
    expect(strip.height).toBeGreaterThanOrEqual(Math.round(1280 * 0.4) - 1);
  });
});
