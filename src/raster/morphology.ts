// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Binary morphology with a (2r+1)² square structuring element, separable running counts: O(n) for any r.
 * `erode`/`dilate` clip windows at the image border; `open`/`close` work on an edge-replicated copy.
 */

function pass(
  src: Uint8Array,
  dst: Uint8Array,
  w: number,
  h: number,
  r: number,
  horizontal: boolean,
  erode: boolean,
): void {
  const lines = horizontal ? h : w;
  const len = horizontal ? w : h;
  const stride = horizontal ? 1 : w;
  // For erosion count unset pixels in the window; for dilation count set pixels.
  const want = erode ? 0 : 1;
  for (let line = 0; line < lines; line++) {
    const base = horizontal ? line * w : line;
    let count = 0;
    // window [pos - r, pos + r] ∩ [0, len)
    for (let q = 0; q < Math.min(r, len); q++) if (src[base + q * stride] === want) count++;
    for (let pos = 0; pos < len; pos++) {
      const add = pos + r;
      if (add < len && src[base + add * stride] === want) count++;
      const rem = pos - r - 1;
      if (rem >= 0 && src[base + rem * stride] === want) count--;
      dst[base + pos * stride] = erode ? (count === 0 ? 1 : 0) : count > 0 ? 1 : 0;
    }
  }
}

export function erode(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return mask.slice();
  const tmp = new Uint8Array(mask.length);
  const out = new Uint8Array(mask.length);
  pass(mask, tmp, w, h, r, true, true);
  pass(tmp, out, w, h, r, false, true);
  return out;
}

export function dilate(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return mask.slice();
  const tmp = new Uint8Array(mask.length);
  const out = new Uint8Array(mask.length);
  pass(mask, tmp, w, h, r, true, false);
  pass(tmp, out, w, h, r, false, false);
  return out;
}

/** Copy into a (w+2p)×(h+2p) buffer, replicating edge pixels outward. */
function padReplicate(mask: Uint8Array, w: number, h: number, p: number): Uint8Array {
  const pw = w + 2 * p;
  const ph = h + 2 * p;
  const out = new Uint8Array(pw * ph);
  for (let y = 0; y < ph; y++) {
    const sy = Math.min(h - 1, Math.max(0, y - p));
    for (let x = 0; x < pw; x++) {
      const sx = Math.min(w - 1, Math.max(0, x - p));
      out[y * pw + x] = mask[sy * w + sx];
    }
  }
  return out;
}

function unpad(buf: Uint8Array, w: number, h: number, p: number): Uint8Array {
  const pw = w + 2 * p;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) out.set(buf.subarray((y + p) * pw + p, (y + p) * pw + p + w), y * w);
  return out;
}

/**
 * Open (erode→dilate) or close (dilate→erode) on an edge-replicated padded copy, so the image border
 * behaves like a continuation of the edge pixels: regions touching the border are not eroded, and
 * regions near (but not touching) the border are not glued to it by closing.
 */
function compound(mask: Uint8Array, w: number, h: number, r: number, opening: boolean): Uint8Array {
  if (r <= 0) return mask.slice();
  const p = 2 * r;
  const pw = w + 2 * p;
  const ph = h + 2 * p;
  const padded = padReplicate(mask, w, h, p);
  const res = opening
    ? dilate(erode(padded, pw, ph, r), pw, ph, r)
    : erode(dilate(padded, pw, ph, r), pw, ph, r);
  return unpad(res, w, h, p);
}

/** Opening: removes features thinner than 2r+1 px. */
export function open(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  return compound(mask, w, h, r, true);
}

/** Closing: fills gaps and holes narrower than 2r+1 px. */
export function close(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  return compound(mask, w, h, r, false);
}
