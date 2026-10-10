// SPDX-License-Identifier: GPL-3.0-or-later
/** Image file helpers for the image import dialog (backdrop data URL, decoding). No network. */

/** Files larger than this are re-encoded (and downscaled) before being stored as the backdrop. */
export const BACKDROP_MAX_BYTES = 8 * 1024 * 1024;
/** Longest side of a downscaled backdrop. */
export const BACKDROP_MAX_SIDE = 2000;

export interface Backdrop {
  dataUrl: string;
  /** Size of the stored image (may be smaller than the original). */
  pxWidth: number;
  pxHeight: number;
}

export interface PreparedImage {
  /** Original pixel size. */
  width: number;
  height: number;
  backdrop: Backdrop;
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error('Could not read the file.'));
    r.readAsDataURL(blob);
  });
}

/** Decodes a `data:` URL into a Blob locally (no fetch). */
export function dataUrlToBlob(dataUrl: string): Blob {
  const m = /^data:([^;,]*)((?:;[^;,]*)*?)(;base64)?,(.*)$/s.exec(dataUrl);
  if (!m) throw new Error('Invalid image data.');
  const type = m[1] || 'application/octet-stream';
  const payload = m[4];
  if (m[3]) {
    const bin = atob(payload);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type });
  }
  return new Blob([decodeURIComponent(payload)], { type });
}

async function canvasToBlob(bitmap: ImageBitmap, w: number, h: number, type: string): Promise<Blob> {
  if (typeof OffscreenCanvas !== 'undefined') {
    const c = new OffscreenCanvas(w, h);
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('Canvas unavailable');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, w, h);
    return c.convertToBlob({ type, quality: 0.9 });
  }
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, w, h);
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode the image.'))), type, 0.9),
  );
}

/**
 * Decodes the image once for its size and builds the backdrop data URL. Files over
 * `BACKDROP_MAX_BYTES` are re-encoded at most `BACKDROP_MAX_SIDE` px on the long side (PNG when the
 * source may have transparency, else JPEG).
 */
export async function prepareImage(blob: Blob): Promise<PreparedImage> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    throw new Error('This file could not be read as an image (PNG, JPG or WebP).');
  }
  try {
    const width = bitmap.width;
    const height = bitmap.height;
    if (!(width > 0 && height > 0)) throw new Error('The image is empty.');
    if (blob.size <= BACKDROP_MAX_BYTES) {
      return {
        width,
        height,
        backdrop: { dataUrl: await blobToDataUrl(blob), pxWidth: width, pxHeight: height },
      };
    }
    const s = Math.min(1, BACKDROP_MAX_SIDE / Math.max(width, height));
    const w = Math.max(1, Math.round(width * s));
    const h = Math.max(1, Math.round(height * s));
    const type = /png|webp|gif/i.test(blob.type) ? 'image/png' : 'image/jpeg';
    const small = await canvasToBlob(bitmap, w, h, type);
    return { width, height, backdrop: { dataUrl: await blobToDataUrl(small), pxWidth: w, pxHeight: h } };
  } finally {
    bitmap.close();
  }
}
