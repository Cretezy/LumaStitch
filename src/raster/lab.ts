// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Fast sRGB → CIELAB for whole images. Same constants as `threads/color.ts` (D65), so distances are
 * comparable with `rgbToLab`. Uses a 256-entry linearisation LUT and a direct-mapped colour cache,
 * which makes flat artwork (few distinct colours) nearly free.
 */

const LIN = new Float64Array(256);
for (let i = 0; i < 256; i++) {
  const v = i / 255;
  LIN[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

const Xn = 0.95047;
const Zn = 1.08883;
const EPS = 216 / 24389;
const KAPPA = 24389 / 27;

function f(t: number): number {
  return t > EPS ? Math.cbrt(t) : (KAPPA * t + 16) / 116;
}

/** Convert one colour into out[o..o+2]. */
export function rgbToLabInto(r: number, g: number, b: number, out: Float32Array, o: number): void {
  const R = LIN[r];
  const G = LIN[g];
  const B = LIN[b];
  const X = 0.4124564 * R + 0.3575761 * G + 0.1804375 * B;
  const Y = 0.2126729 * R + 0.7151522 * G + 0.072175 * B;
  const Z = 0.0193339 * R + 0.119192 * G + 0.9503041 * B;
  const fx = f(X / Xn);
  const fy = f(Y);
  const fz = f(Z / Zn);
  out[o] = 116 * fy - 16;
  out[o + 1] = 500 * (fx - fy);
  out[o + 2] = 200 * (fy - fz);
}

const CACHE_BITS = 16;
const CACHE_SIZE = 1 << CACHE_BITS;

/** RGB (3 or 4 channels) → interleaved Lab Float32Array (3 per pixel). */
export function imageToLab(px: Uint8ClampedArray | Uint8Array, n: number, channels: 3 | 4 = 4): Float32Array {
  const out = new Float32Array(n * 3);
  const keys = new Int32Array(CACHE_SIZE).fill(-1);
  const vals = new Float32Array(CACHE_SIZE * 3);
  for (let i = 0, s = 0, o = 0; i < n; i++, s += channels, o += 3) {
    const r = px[s];
    const g = px[s + 1];
    const b = px[s + 2];
    const key = (r << 16) | (g << 8) | b;
    const h = (Math.imul(key, 0x9e3779b1) >>> (32 - CACHE_BITS)) & (CACHE_SIZE - 1);
    const h3 = h * 3;
    if (keys[h] !== key) {
      keys[h] = key;
      rgbToLabInto(r, g, b, vals, h3);
    }
    out[o] = vals[h3];
    out[o + 1] = vals[h3 + 1];
    out[o + 2] = vals[h3 + 2];
  }
  return out;
}
