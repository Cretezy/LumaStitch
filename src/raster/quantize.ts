// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Colour quantisation (SPEC §9.1 step 3): flat-pixel sampling, k-means fit, full assignment into a
 * Uint8Array label map, and anti-aliasing blend absorption.
 */
import { labToHex, type Lab } from '@/threads/color';
import { RASTER_CONFIG } from './config';
import { assignNearest, autoK, kmeansBest, type KMeansResult } from './kmeans';
import { mulberry32 } from './prng';

/** One resolution level of the pre-filtered image. */
export interface LabLevel {
  width: number;
  height: number;
  /** Interleaved Lab, 3 per pixel. */
  lab: Float32Array;
  /** 1 = transparent (background), or null. */
  transparent: Uint8Array | null;
  mmPerPx: number;
  /** Work px per original px (> 1 when the image was enlarged). */
  upscale: number;
}

const WHITE_LAB: Lab = [100, 0, 0];

/** Pixels whose 4-neighbours are all within `flat.tol` (Lab). Anti-aliasing and edges are excluded. */
export function flatMask(level: LabLevel): { mask: Uint8Array; count: number; opaque: number } {
  const { width: w, height: h, lab, transparent } = level;
  const n = w * h;
  const mask = new Uint8Array(n);
  const t2 = RASTER_CONFIG.flat.tol ** 2;
  let count = 0;
  let opaque = 0;
  // Compare with neighbours one *original* pixel away, so enlarging the image doesn't fake flatness.
  const s = Math.max(1, Math.round(level.upscale));
  const near = (i: number, j: number) => {
    if (transparent && transparent[j]) return false;
    const a = lab[i * 3] - lab[j * 3];
    const b = lab[i * 3 + 1] - lab[j * 3 + 1];
    const c = lab[i * 3 + 2] - lab[j * 3 + 2];
    return a * a + b * b + c * c <= t2;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (transparent && transparent[i]) continue;
      opaque++;
      if (x >= s && !near(i, i - s)) continue;
      if (x < w - s && !near(i, i + s)) continue;
      if (y >= s && !near(i, i - s * w)) continue;
      if (y < h - s && !near(i, i + s * w)) continue;
      mask[i] = 1;
      count++;
    }
  }
  return { mask, count, opaque };
}

/** Deterministic pixel sample (Lab, without replacement, random order) from `include` (or all opaque) pixels. */
export function samplePixels(
  level: LabLevel,
  size: number,
  seed: number,
  include: Uint8Array | null,
): { data: Float32Array; m: number } {
  const n = level.width * level.height;
  const ok = (i: number) => (include ? include[i] === 1 : !(level.transparent && level.transparent[i]));
  let total = 0;
  for (let i = 0; i < n; i++) if (ok(i)) total++;
  const idx = new Int32Array(total);
  for (let i = 0, j = 0; i < n; i++) if (ok(i)) idx[j++] = i;
  const m = Math.min(size, total);
  const data = new Float32Array(m * 3);
  const rand = mulberry32(seed);
  // Partial Fisher–Yates: the first m entries become a uniform random sample in random order.
  for (let s = 0; s < m; s++) {
    const j = s + Math.floor(rand() * (total - s));
    const t = idx[s];
    idx[s] = idx[j];
    idx[j] = t;
    const i = idx[s];
    data[s * 3] = level.lab[i * 3];
    data[s * 3 + 1] = level.lab[i * 3 + 1];
    data[s * 3 + 2] = level.lab[i * 3 + 2];
  }
  return { data, m };
}

/** Everything needed to fit centres for any k on one level; cached by the digitizer. */
export class CenterFitter {
  readonly photoLike: boolean;
  private readonly sample: { data: Float32Array; m: number };
  private readonly autoSample: { data: Float32Array; m: number };
  private auto: { k: number; runs: Map<number, KMeansResult> } | null = null;
  private readonly fits = new Map<number, KMeansResult>();

  constructor(level: LabLevel) {
    const flat = flatMask(level);
    this.photoLike = flat.opaque === 0 || flat.count < flat.opaque * RASTER_CONFIG.flat.minFraction;
    const include = this.photoLike ? null : flat.mask;
    const { seed, sampleSize, autoSampleSize } = RASTER_CONFIG.kmeans;
    this.sample = samplePixels(level, sampleSize, seed, include);
    this.autoSample =
      autoSampleSize >= this.sample.m
        ? this.sample
        : { data: this.sample.data.subarray(0, autoSampleSize * 3), m: autoSampleSize };
  }

  suggestedK(): number {
    if (!this.auto) {
      this.auto = autoK(this.autoSample.data, this.autoSample.m, RASTER_CONFIG.kmeans.seed, !this.photoLike);
    }
    return this.auto.k;
  }

  /** Centres for `k` colours (fit on the full sample). */
  fit(k: number): KMeansResult {
    let r = this.fits.get(k);
    if (!r) {
      r = kmeansBest(
        this.sample.data,
        this.sample.m,
        k,
        RASTER_CONFIG.kmeans.seed,
        RASTER_CONFIG.kmeans.fitRestarts,
      );
      this.fits.set(k, r);
    }
    return r;
  }
}

/** A quantised palette in display order (largest share first). */
export interface PaletteModel {
  /** Number of palette entries (opaque clusters + transparency entry). */
  K: number;
  /** Lab per palette index (transparency = white). */
  lab: Float32Array;
  colors: string[];
  transparentIndex: number | null;
  /** Opaque centres and the palette index of each. */
  opaqueLab: Float32Array;
  opaqueIndex: Uint8Array;
}

/** Order the fitted centres by their pixel share on `level` and build the palette. */
export function buildPalette(level: LabLevel, fit: KMeansResult): PaletteModel {
  const n = level.width * level.height;
  const k = fit.k;
  const tmp = new Uint8Array(n);
  assignNearest(level.lab, n, fit.centers, k, tmp, level.transparent);
  const counts = new Float64Array(k + 1);
  for (let i = 0; i < n; i++) {
    if (level.transparent && level.transparent[i]) counts[k]++;
    else counts[tmp[i]]++;
  }
  const entries: number[] = [];
  for (let j = 0; j < k; j++) entries.push(j);
  if (level.transparent) entries.push(k);
  entries.sort((a, b) => counts[b] - counts[a] || a - b);
  const K = entries.length;
  const lab = new Float32Array(K * 3);
  const colors: string[] = [];
  const opaqueLab = new Float32Array(k * 3);
  const opaqueIndex = new Uint8Array(k);
  let transparentIndex: number | null = null;
  entries.forEach((e, idx) => {
    const L: Lab = e === k ? WHITE_LAB : [fit.centers[e * 3], fit.centers[e * 3 + 1], fit.centers[e * 3 + 2]];
    lab.set(L, idx * 3);
    colors.push(labToHex(L));
    if (e === k) transparentIndex = idx;
    else {
      opaqueLab.set(L, e * 3);
      opaqueIndex[e] = idx;
    }
  });
  return { K, lab, colors, transparentIndex, opaqueLab, opaqueIndex };
}

/** Full assignment of a level into palette indices, followed by blend absorption. */
export function labelLevel(level: LabLevel, pal: PaletteModel): Uint8Array {
  const n = level.width * level.height;
  const labels = new Uint8Array(n);
  // Without a transparency entry (e.g. only a few transparent pixels), transparent pixels are treated
  // as their composited colour (white).
  const transparent = pal.transparentIndex !== null ? level.transparent : null;
  assignNearest(level.lab, n, pal.opaqueLab, pal.opaqueIndex.length, labels, transparent);
  for (let i = 0; i < n; i++) {
    if (transparent && transparent[i]) labels[i] = pal.transparentIndex!;
    else labels[i] = pal.opaqueIndex[labels[i]];
  }
  const maxRun = Math.max(RASTER_CONFIG.blend.maxRun, Math.ceil(RASTER_CONFIG.blend.maxRun * level.upscale));
  return absorbBlends(labels, level.lab, level.width, level.height, pal.lab, maxRun);
}

/**
 * Blend absorption: runs of ≤ maxRun pixels (horizontally or vertically) of label c between two
 * different labels a ≠ b, whose colour lies on the Lab segment a–b, are relabelled to the nearer of a, b.
 */
export function absorbBlends(
  labels: Uint8Array,
  lab: Float32Array,
  w: number,
  h: number,
  paletteLab: Float32Array,
  maxRun: number,
): Uint8Array {
  const out = labels.slice();
  const changed = new Uint8Array(labels.length);
  const { segTol, tMin, tMax } = RASTER_CONFIG.blend;
  const seg2 = segTol * segTol;
  const test = (p: number, a: number, b: number): number => {
    const ax = paletteLab[a * 3];
    const ay = paletteLab[a * 3 + 1];
    const az = paletteLab[a * 3 + 2];
    const dx = paletteLab[b * 3] - ax;
    const dy = paletteLab[b * 3 + 1] - ay;
    const dz = paletteLab[b * 3 + 2] - az;
    const len2 = dx * dx + dy * dy + dz * dz;
    if (len2 < 1e-9) return -1;
    const px = lab[p * 3] - ax;
    const py = lab[p * 3 + 1] - ay;
    const pz = lab[p * 3 + 2] - az;
    const t = (px * dx + py * dy + pz * dz) / len2;
    if (t < tMin || t > tMax) return -1;
    const ex = px - t * dx;
    const ey = py - t * dy;
    const ez = pz - t * dz;
    if (ex * ex + ey * ey + ez * ez > seg2) return -1;
    return t < 0.5 ? a : b;
  };
  const scan = (count: number, len: number, index: (line: number, pos: number) => number) => {
    for (let line = 0; line < count; line++) {
      let pos = 0;
      while (pos < len) {
        const c = labels[index(line, pos)];
        const start = pos;
        while (pos < len && labels[index(line, pos)] === c) pos++;
        const runLen = pos - start;
        if (runLen > maxRun || start === 0 || pos >= len) continue;
        const a = labels[index(line, start - 1)];
        const b = labels[index(line, pos)];
        if (a === b || a === c || b === c) continue;
        for (let q = start; q < pos; q++) {
          const p = index(line, q);
          if (changed[p]) continue;
          const r = test(p, a, b);
          if (r >= 0) {
            out[p] = r;
            changed[p] = 1;
          }
        }
      }
    }
  };
  scan(h, w, (y, x) => y * w + x);
  scan(w, h, (x, y) => y * w + x);
  return out;
}

/** Pixel share per palette index. */
export function labelShares(labels: Uint8Array, K: number): number[] {
  const counts = new Float64Array(K);
  for (let i = 0; i < labels.length; i++) counts[labels[i]]++;
  return Array.from(counts, (c) => (labels.length ? c / labels.length : 0));
}

/** Colour the label map for display. */
export function renderLabels(labels: Uint8Array, colors: string[]): Uint8ClampedArray {
  const lut = new Uint8Array(colors.length * 3);
  colors.forEach((c, i) => {
    const v = parseInt(c.slice(1), 16);
    lut[i * 3] = (v >> 16) & 255;
    lut[i * 3 + 1] = (v >> 8) & 255;
    lut[i * 3 + 2] = v & 255;
  });
  const out = new Uint8ClampedArray(labels.length * 4);
  for (let i = 0; i < labels.length; i++) {
    const l = labels[i] * 3;
    out[i * 4] = lut[l];
    out[i * 4 + 1] = lut[l + 1];
    out[i * 4 + 2] = lut[l + 2];
    out[i * 4 + 3] = 255;
  }
  return out;
}
