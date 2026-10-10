// SPDX-License-Identifier: GPL-3.0-or-later
/** Synthetic anti-aliased test images (no files needed). */
import type { PathGeom, Vec2 } from '@/model/types';
import { parseHex } from '@/threads/color';
import { mulberry32 } from '../prng';
import type { RawImage } from '../types';

export type RGBA = [number, number, number, number];

export type SynthShape =
  | { kind: 'rect'; x0: number; y0: number; x1: number; y1: number; color: string | RGBA }
  | { kind: 'circle'; cx: number; cy: number; r: number; color: string | RGBA };

function toRgba(c: string | RGBA): RGBA {
  if (typeof c === 'string') {
    const [r, g, b] = parseHex(c);
    return [r, g, b, 255];
  }
  return c;
}

/** Paint shapes in order with exact (rect) or 8×8 supersampled (circle) pixel coverage. */
export function renderScene(
  w: number,
  h: number,
  bg: string | RGBA,
  shapes: SynthShape[],
  noise = 0,
  seed = 1,
): RawImage {
  const data = new Uint8ClampedArray(w * h * 4);
  // float buffer of premultiplied colour for exact blending
  const buf = new Float32Array(w * h * 4);
  const b = toRgba(bg);
  for (let i = 0; i < w * h; i++) {
    const a = b[3] / 255;
    buf[i * 4] = b[0] * a;
    buf[i * 4 + 1] = b[1] * a;
    buf[i * 4 + 2] = b[2] * a;
    buf[i * 4 + 3] = a;
  }
  const paint = (i: number, cov: number, c: RGBA) => {
    if (cov <= 0) return;
    const a = (c[3] / 255) * cov;
    buf[i * 4] = c[0] * a + buf[i * 4] * (1 - a);
    buf[i * 4 + 1] = c[1] * a + buf[i * 4 + 1] * (1 - a);
    buf[i * 4 + 2] = c[2] * a + buf[i * 4 + 2] * (1 - a);
    buf[i * 4 + 3] = a + buf[i * 4 + 3] * (1 - a);
  };
  for (const s of shapes) {
    const c = toRgba(s.color);
    if (s.kind === 'rect') {
      for (let y = Math.max(0, Math.floor(s.y0)); y < Math.min(h, Math.ceil(s.y1)); y++) {
        const cy = Math.min(y + 1, s.y1) - Math.max(y, s.y0);
        for (let x = Math.max(0, Math.floor(s.x0)); x < Math.min(w, Math.ceil(s.x1)); x++) {
          const cx = Math.min(x + 1, s.x1) - Math.max(x, s.x0);
          paint(y * w + x, cx * cy, c);
        }
      }
    } else {
      const { cx, cy, r } = s;
      for (let y = Math.max(0, Math.floor(cy - r - 1)); y < Math.min(h, Math.ceil(cy + r + 1)); y++) {
        for (let x = Math.max(0, Math.floor(cx - r - 1)); x < Math.min(w, Math.ceil(cx + r + 1)); x++) {
          const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
          let cov: number;
          if (d < r - 0.8) cov = 1;
          else if (d > r + 0.8) cov = 0;
          else {
            let k = 0;
            for (let sy = 0; sy < 8; sy++) {
              for (let sx = 0; sx < 8; sx++) {
                if (Math.hypot(x + (sx + 0.5) / 8 - cx, y + (sy + 0.5) / 8 - cy) <= r) k++;
              }
            }
            cov = k / 64;
          }
          paint(y * w + x, cov, c);
        }
      }
    }
  }
  const rand = mulberry32(seed);
  for (let i = 0; i < w * h; i++) {
    const a = buf[i * 4 + 3];
    const nz = noise ? (rand() - 0.5) * 2 * noise : 0;
    if (a > 0) {
      data[i * 4] = buf[i * 4] / a + nz + 0.5;
      data[i * 4 + 1] = buf[i * 4 + 1] / a + nz + 0.5;
      data[i * 4 + 2] = buf[i * 4 + 2] / a + nz + 0.5;
    }
    data[i * 4 + 3] = a * 255 + 0.5;
  }
  return { data, width: w, height: h };
}

/** Flatten a PathGeom into rings of points (cubics sampled uniformly). */
export function flattenGeom(g: PathGeom, steps = 8): Vec2[][] {
  const rings: Vec2[][] = [];
  for (const sp of g.subpaths) {
    const pts: Vec2[] = [];
    const n = sp.nodes.length;
    const segs = sp.closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const a = sp.nodes[i];
      const b = sp.nodes[(i + 1) % n];
      const c1: Vec2 = a.out ? [a.p[0] + a.out[0], a.p[1] + a.out[1]] : a.p;
      const c2: Vec2 = b.in ? [b.p[0] + b.in[0], b.p[1] + b.in[1]] : b.p;
      const curved = !!(a.out || b.in);
      const st = curved ? steps : 1;
      for (let s = 0; s < st; s++) {
        const t = s / st;
        const mt = 1 - t;
        pts.push([
          mt * mt * mt * a.p[0] + 3 * mt * mt * t * c1[0] + 3 * mt * t * t * c2[0] + t * t * t * b.p[0],
          mt * mt * mt * a.p[1] + 3 * mt * mt * t * c1[1] + 3 * mt * t * t * c2[1] + t * t * t * b.p[1],
        ]);
      }
    }
    if (!sp.closed) pts.push(sp.nodes[n - 1].p);
    rings.push(pts);
  }
  return rings;
}

/** Even-odd point-in-polygon over all rings. */
export function insideRings(rings: Vec2[][], x: number, y: number): boolean {
  let inside = false;
  for (const r of rings) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i];
      const [xj, yj] = r[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

export function ringsBounds(rings: Vec2[][]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rings) {
    for (const [x, y] of r) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return { minX, minY, maxX, maxY };
}

/** Signed-area sum of rings (abs of each outer minus holes is not needed for evenodd: use sampling). */
export function ringArea(r: Vec2[]): number {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1];
  return a / 2;
}
