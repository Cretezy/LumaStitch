// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * RGBA resampling with premultiplied alpha: area averaging when shrinking, bilinear when enlarging.
 * Separable, streaming over rows so the intermediate buffer is only a few rows.
 */
import { RASTER_CONFIG } from './config';

interface AxisWeights {
  /** offsets[i]..offsets[i+1] index into idx/w for destination i. */
  offsets: Int32Array;
  idx: Int32Array;
  w: Float32Array;
}

function axisWeights(srcN: number, dstN: number): AxisWeights {
  const offsets = new Int32Array(dstN + 1);
  const idx: number[] = [];
  const w: number[] = [];
  if (dstN < srcN) {
    const scale = srcN / dstN;
    for (let i = 0; i < dstN; i++) {
      offsets[i] = idx.length;
      const a = i * scale;
      const b = (i + 1) * scale;
      for (let s = Math.floor(a); s < Math.min(srcN, Math.ceil(b)); s++) {
        const overlap = Math.min(b, s + 1) - Math.max(a, s);
        if (overlap > 1e-9) {
          idx.push(s);
          w.push(overlap / scale);
        }
      }
    }
  } else {
    const scale = srcN / dstN;
    for (let i = 0; i < dstN; i++) {
      offsets[i] = idx.length;
      const x = Math.max(0, Math.min(srcN - 1, (i + 0.5) * scale - 0.5));
      const x0 = Math.floor(x);
      const fr = x - x0;
      idx.push(x0);
      w.push(1 - fr);
      if (fr > 1e-9 && x0 + 1 < srcN) {
        idx.push(x0 + 1);
        w.push(fr);
      }
    }
  }
  offsets[dstN] = idx.length;
  return { offsets, idx: Int32Array.from(idx), w: Float32Array.from(w) };
}

/** Resample RGBA `src` (sw×sh) to dw×dh. Returns a new buffer. */
export function resampleRGBA(
  src: Uint8ClampedArray,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): Uint8ClampedArray {
  if (sw === dw && sh === dh) return src.slice();
  const hx = axisWeights(sw, dw);
  const hy = axisWeights(sh, dh);
  const rows = new Map<number, Float32Array>();
  const getRow = (sy: number): Float32Array => {
    let row = rows.get(sy);
    if (row) return row;
    row = new Float32Array(dw * 4);
    const base = sy * sw * 4;
    for (let x = 0; x < dw; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let k = hx.offsets[x]; k < hx.offsets[x + 1]; k++) {
        const s = base + hx.idx[k] * 4;
        const wa = hx.w[k] * src[s + 3];
        r += wa * src[s];
        g += wa * src[s + 1];
        b += wa * src[s + 2];
        a += wa;
      }
      const o = x * 4;
      row[o] = r;
      row[o + 1] = g;
      row[o + 2] = b;
      row[o + 3] = a;
    }
    rows.set(sy, row);
    return row;
  };
  const out = new Uint8ClampedArray(dw * dh * 4);
  const acc = new Float32Array(dw * 4);
  for (let y = 0; y < dh; y++) {
    acc.fill(0);
    for (let k = hy.offsets[y]; k < hy.offsets[y + 1]; k++) {
      const row = getRow(hy.idx[k]);
      const wy = hy.w[k];
      for (let i = 0; i < acc.length; i++) acc[i] += wy * row[i];
    }
    const o = y * dw * 4;
    for (let x = 0; x < dw; x++) {
      const i = x * 4;
      const a = acc[i + 3];
      if (a > 1e-6) {
        out[o + i] = acc[i] / a;
        out[o + i + 1] = acc[i + 1] / a;
        out[o + i + 2] = acc[i + 2] / a;
        out[o + i + 3] = a;
      }
    }
    // Rows are needed in non-decreasing order: drop those no later destination row uses.
    if (y + 1 < dh) {
      const minNeeded = hy.idx[hy.offsets[y + 1]];
      for (const key of rows.keys()) if (key < minNeeded) rows.delete(key);
    }
  }
  return out;
}

export interface WorkSize {
  workWidth: number;
  workHeight: number;
  mmPerPx: number;
  widthMm: number;
  heightMm: number;
}

/** Working resolution: ≈0.1 mm/px at the target size, capped at `maxWorkPixels`. */
export function computeWorkSize(
  pxWidth: number,
  pxHeight: number,
  target: { width?: number; height?: number },
): WorkSize {
  const aspect = pxHeight / pxWidth;
  let widthMm: number;
  let byHeight = false;
  if (target.width && target.width > 0) widthMm = target.width;
  else if (target.height && target.height > 0) {
    widthMm = target.height / aspect;
    byHeight = true;
  } else {
    const longest = RASTER_CONFIG.defaultTargetMm;
    widthMm = pxWidth >= pxHeight ? longest : longest / aspect;
  }
  const heightMmIdeal = widthMm * aspect;
  let workWidth = Math.max(1, Math.round(widthMm / RASTER_CONFIG.targetMmPerPx));
  let workHeight = Math.max(1, Math.round(heightMmIdeal / RASTER_CONFIG.targetMmPerPx));
  const max = RASTER_CONFIG.maxWorkPixels;
  if (workWidth * workHeight > max) {
    const f = Math.sqrt(max / (workWidth * workHeight));
    workWidth = Math.max(1, Math.floor(workWidth * f));
    workHeight = Math.max(1, Math.floor(workHeight * f));
  }
  const mmPerPx = byHeight ? heightMmIdeal / workHeight : widthMm / workWidth;
  return { workWidth, workHeight, mmPerPx, widthMm: workWidth * mmPerPx, heightMm: workHeight * mmPerPx };
}

/** Preview resolution: about ¼ of the work pixels, capped at `previewMaxPixels`. */
export function computePreviewSize(workWidth: number, workHeight: number): { width: number; height: number } {
  const area = workWidth * workHeight;
  if (area <= RASTER_CONFIG.previewMaxPixels) return { width: workWidth, height: workHeight };
  const f = Math.min(RASTER_CONFIG.previewScale, Math.sqrt(RASTER_CONFIG.previewMaxPixels / area));
  return { width: Math.max(1, Math.round(workWidth * f)), height: Math.max(1, Math.round(workHeight * f)) };
}
