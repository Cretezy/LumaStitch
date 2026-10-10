// SPDX-License-Identifier: GPL-3.0-or-later
/** Background detection (SPEC §9.1 step 4): transparency, else the colour dominating the border. */
import { deltaE2000, hexToLab, type Lab } from '@/threads/color';
import { RASTER_CONFIG } from './config';

/** Label counts on the outer border ring. Returns [index, share] of the dominant label. */
export function dominantBorderLabel(labels: Uint8Array, w: number, h: number, K: number): [number, number] {
  const ring = Math.max(1, Math.min(RASTER_CONFIG.background.borderPx, Math.floor(Math.min(w, h) / 2)));
  const counts = new Float64Array(K);
  let total = 0;
  for (let y = 0; y < h; y++) {
    const edgeRow = y < ring || y >= h - ring;
    for (let x = 0; x < w; x++) {
      if (!edgeRow && x >= ring && x < w - ring) {
        x = w - ring - 1;
        continue;
      }
      counts[labels[y * w + x]]++;
      total++;
    }
  }
  let best = 0;
  for (let i = 1; i < K; i++) if (counts[i] > counts[best]) best = i;
  return [best, total ? counts[best] / total : 0];
}

/**
 * Resolve the background palette index.
 * - 'none' → null
 * - '#rrggbb' → the palette entry nearest that colour (ΔE00)
 * - 'auto' → the transparency entry if any, else the dominant border colour (if dominant enough)
 */
export function detectBackground(
  setting: 'auto' | 'none' | string,
  labels: Uint8Array,
  w: number,
  h: number,
  colors: string[],
  transparentIndex: number | null,
): number | null {
  const K = colors.length;
  if (K === 0 || setting === 'none') return null;
  if (setting !== 'auto') {
    let target: Lab;
    try {
      target = hexToLab(setting);
    } catch {
      return null;
    }
    let best = 0;
    let bd = Infinity;
    colors.forEach((c, i) => {
      const d = deltaE2000(hexToLab(c), target);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  }
  if (transparentIndex !== null) return transparentIndex;
  const [idx, share] = dominantBorderLabel(labels, w, h, K);
  return share >= RASTER_CONFIG.background.minShare ? idx : null;
}
