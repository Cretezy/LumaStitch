// SPDX-License-Identifier: GPL-3.0-or-later
/** Pre-filtering (SPEC §9.1 step 2): composite onto white, edge-preserving smoothing. */
import { RASTER_CONFIG } from './config';

export interface Composited {
  /** Interleaved RGB, 3 bytes per pixel, composited onto white. */
  rgb: Uint8Array;
  /** 1 where alpha < threshold, or null if there is no meaningful transparency. */
  transparent: Uint8Array | null;
}

export function compositeOnWhite(rgba: Uint8ClampedArray, n: number): Composited {
  const rgb = new Uint8Array(n * 3);
  const transparent = new Uint8Array(n);
  let count = 0;
  const thr = RASTER_CONFIG.alphaThreshold;
  for (let i = 0, s = 0, o = 0; i < n; i++, s += 4, o += 3) {
    const a = rgba[s + 3];
    if (a === 255) {
      rgb[o] = rgba[s];
      rgb[o + 1] = rgba[s + 1];
      rgb[o + 2] = rgba[s + 2];
    } else {
      const k = a / 255;
      const w = 255 * (1 - k);
      rgb[o] = rgba[s] * k + w + 0.5;
      rgb[o + 1] = rgba[s + 1] * k + w + 0.5;
      rgb[o + 2] = rgba[s + 2] * k + w + 0.5;
      if (a < thr) {
        transparent[i] = 1;
        count++;
      }
    }
  }
  const meaningful = count > 0 && count >= n * RASTER_CONFIG.minTransparentFraction;
  return { rgb, transparent: meaningful ? transparent : null };
}

let rangeLut: Float32Array | null = null;
let rangeLutSigma = -1;

function getRangeLut(sigma: number): Float32Array {
  if (rangeLut && rangeLutSigma === sigma) return rangeLut;
  const max = 3 * 255 * 255;
  const lut = new Float32Array(max + 1);
  const k = -1 / (2 * sigma * sigma);
  for (let d = 0; d <= max; d++) lut[d] = Math.exp(d * k);
  rangeLut = lut;
  rangeLutSigma = sigma;
  return lut;
}

function bilateralPass(src: Uint8Array, dst: Uint8Array, w: number, h: number, horizontal: boolean): void {
  const { radius, sigmaSpatial, sigmaRange } = RASTER_CONFIG.bilateral;
  const range = getRangeLut(sigmaRange);
  const sp = new Float32Array(radius + 1);
  for (let d = 0; d <= radius; d++) sp[d] = Math.exp(-(d * d) / (2 * sigmaSpatial * sigmaSpatial));
  const stepPx = horizontal ? 1 : w;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const o = i * 3;
      const r0 = src[o];
      const g0 = src[o + 1];
      const b0 = src[o + 2];
      const pos = horizontal ? x : y;
      const lim = horizontal ? w : h;
      const lo = Math.max(-radius, -pos);
      const hi = Math.min(radius, lim - 1 - pos);
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let sw = 0;
      for (let d = lo; d <= hi; d++) {
        const q = (i + d * stepPx) * 3;
        const r = src[q];
        const g = src[q + 1];
        const b = src[q + 2];
        const dr = r - r0;
        const dg = g - g0;
        const db = b - b0;
        const wt = sp[d < 0 ? -d : d] * range[dr * dr + dg * dg + db * db];
        sr += wt * r;
        sg += wt * g;
        sb += wt * b;
        sw += wt;
      }
      dst[o] = sr / sw + 0.5;
      dst[o + 1] = sg / sw + 0.5;
      dst[o + 2] = sb / sw + 0.5;
    }
  }
}

/** Separable bilateral approximation (horizontal then vertical pass). */
export function bilateralFilter(rgb: Uint8Array, w: number, h: number): Uint8Array {
  const tmp = new Uint8Array(rgb.length);
  const out = new Uint8Array(rgb.length);
  bilateralPass(rgb, tmp, w, h, true);
  bilateralPass(tmp, out, w, h, false);
  return out;
}

/** 3×3 median per channel (preview path). Edges replicate. */
export function median3(rgb: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(rgb.length);
  const v = new Uint8Array(9);
  for (let y = 0; y < h; y++) {
    const y0 = y > 0 ? y - 1 : 0;
    const y2 = y < h - 1 ? y + 1 : h - 1;
    for (let x = 0; x < w; x++) {
      const x0 = x > 0 ? x - 1 : 0;
      const x2 = x < w - 1 ? x + 1 : w - 1;
      for (let c = 0; c < 3; c++) {
        let k = 0;
        for (const yy of [y0, y, y2]) {
          const row = yy * w;
          v[k++] = rgb[(row + x0) * 3 + c];
          v[k++] = rgb[(row + x) * 3 + c];
          v[k++] = rgb[(row + x2) * 3 + c];
        }
        // insertion sort of 9
        for (let a = 1; a < 9; a++) {
          const t = v[a];
          let b = a - 1;
          while (b >= 0 && v[b] > t) {
            v[b + 1] = v[b];
            b--;
          }
          v[b + 1] = t;
        }
        out[(y * w + x) * 3 + c] = v[4];
      }
    }
  }
  return out;
}
