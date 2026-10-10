// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Line-art mode (SPEC FR-10.6 / §9.1 step 8): dark regions thinner than `maxWidthMm` everywhere are
 * skeletonised (Zhang–Suen), walked into polylines and simplified (Douglas–Peucker). The mean width
 * along the skeleton becomes the stroke width.
 */
import { connectedComponents } from './components';
import { RASTER_CONFIG } from './config';

const INF = 1e20;

/** 1-D squared distance transform (Felzenszwalb & Huttenlocher). */
function dt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dq = q - v[k];
    d[q] = dq * dq + f[v[k]];
  }
}

/** Exact squared Euclidean distance from each set pixel to the nearest unset pixel. */
export function distanceTransform2(mask: Uint8Array, w: number, h: number): Float64Array {
  const out = new Float64Array(w * h);
  const len = Math.max(w, h);
  const f = new Float64Array(len);
  const d = new Float64Array(len);
  const v = new Int32Array(len);
  const z = new Float64Array(len + 1);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = mask[y * w + x] ? INF : 0;
    dt1d(f, h, d, v, z);
    for (let y = 0; y < h; y++) out[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = out[y * w + x];
    dt1d(f, w, d, v, z);
    for (let x = 0; x < w; x++) out[y * w + x] = d[x];
  }
  return out;
}

/**
 * Zhang–Suen thinning, in place. The mask must have a 1-px unset border.
 * Followed by a staircase clean-up so the skeleton is 8-connected and 1 px wide.
 */
export function zhangSuen(mask: Uint8Array, w: number): void {
  let pts: number[] = [];
  for (let i = 0; i < mask.length; i++) if (mask[i]) pts.push(i);
  const del: number[] = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (let step = 0; step < 2; step++) {
      del.length = 0;
      for (const i of pts) {
        if (!mask[i]) continue;
        const p2 = mask[i - w];
        const p3 = mask[i - w + 1];
        const p4 = mask[i + 1];
        const p5 = mask[i + w + 1];
        const p6 = mask[i + w];
        const p7 = mask[i + w - 1];
        const p8 = mask[i - 1];
        const p9 = mask[i - w - 1];
        const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
        if (B < 2 || B > 6) continue;
        const A =
          (p2 === 0 && p3 === 1 ? 1 : 0) +
          (p3 === 0 && p4 === 1 ? 1 : 0) +
          (p4 === 0 && p5 === 1 ? 1 : 0) +
          (p5 === 0 && p6 === 1 ? 1 : 0) +
          (p6 === 0 && p7 === 1 ? 1 : 0) +
          (p7 === 0 && p8 === 1 ? 1 : 0) +
          (p8 === 0 && p9 === 1 ? 1 : 0) +
          (p9 === 0 && p2 === 1 ? 1 : 0);
        if (A !== 1) continue;
        if (step === 0) {
          if (p2 * p4 * p6 !== 0 || p4 * p6 * p8 !== 0) continue;
        } else if (p2 * p4 * p8 !== 0 || p2 * p6 * p8 !== 0) continue;
        del.push(i);
      }
      for (const i of del) mask[i] = 0;
      if (del.length) changed = true;
    }
    pts = pts.filter((i) => mask[i]);
  }
  // Staircase removal: drop a corner pixel whose two orthogonal neighbours already touch diagonally.
  for (const i of pts) {
    const n = mask[i - w];
    const e = mask[i + 1];
    const s = mask[i + w];
    const wv = mask[i - 1];
    if (
      (n && e && !s && !wv && !mask[i + w - 1]) ||
      (e && s && !n && !wv && !mask[i - w - 1]) ||
      (s && wv && !n && !e && !mask[i - w + 1]) ||
      (wv && n && !s && !e && !mask[i + w + 1])
    ) {
      mask[i] = 0;
    }
  }
}

export interface Polyline {
  /** Pixel indices in the mask grid. */
  pts: number[];
  closed: boolean;
}

const OFFS = (w: number) => [-w - 1, -w, -w + 1, -1, 1, w - 1, w, w + 1];

/** Walk an 8-connected skeleton (with a 1-px unset border) into polylines. */
export function skeletonToPolylines(skel: Uint8Array, w: number): Polyline[] {
  const offs = OFFS(w);
  const deg = (i: number) => {
    let c = 0;
    for (const o of offs) if (skel[i + o]) c++;
    return c;
  };
  const visited = new Set<number>();
  const N = skel.length;
  const ek = (a: number, b: number) => (a < b ? a * N + b : b * N + a);
  const out: Polyline[] = [];
  const walk = (start: number, first: number): Polyline => {
    const pts = [start];
    let prev = start;
    let cur = first;
    visited.add(ek(start, first));
    for (;;) {
      if (cur === start) return { pts, closed: true };
      pts.push(cur);
      if (deg(cur) !== 2) break;
      let next = -1;
      for (const o of offs) {
        const j = cur + o;
        if (skel[j] && j !== prev && !visited.has(ek(cur, j))) {
          next = j;
          break;
        }
      }
      if (next < 0) break;
      visited.add(ek(cur, next));
      prev = cur;
      cur = next;
    }
    return { pts, closed: false };
  };
  const pixels: number[] = [];
  for (let i = 0; i < N; i++) if (skel[i]) pixels.push(i);
  for (const p of pixels) {
    if (deg(p) === 2) continue;
    for (const o of offs) {
      const q = p + o;
      if (skel[q] && !visited.has(ek(p, q))) out.push(walk(p, q));
    }
  }
  // Pure loops (every pixel has degree 2).
  for (const p of pixels) {
    if (deg(p) !== 2) continue;
    for (const o of offs) {
      const q = p + o;
      if (skel[q] && !visited.has(ek(p, q))) {
        out.push(walk(p, q));
      }
    }
  }
  return out;
}

/** Douglas–Peucker on interleaved xy. Returns a new interleaved array. */
export function douglasPeucker(xy: number[], tol: number, closed = false): number[] {
  const n = xy.length / 2;
  if (n <= 2) return xy.slice();
  if (closed) {
    // Split a ring at its farthest point from the start so both halves simplify independently.
    let far = 1;
    let fd = -1;
    for (let i = 1; i < n; i++) {
      const d = (xy[i * 2] - xy[0]) ** 2 + (xy[i * 2 + 1] - xy[1]) ** 2;
      if (d > fd) {
        fd = d;
        far = i;
      }
    }
    const a = douglasPeucker(xy.slice(0, far * 2 + 2), tol);
    const b = douglasPeucker([...xy.slice(far * 2), xy[0], xy[1]], tol);
    return [...a.slice(0, -2), ...b.slice(0, -2)];
  }
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  const t2 = tol * tol;
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const ax = xy[a * 2];
    const ay = xy[a * 2 + 1];
    const dx = xy[b * 2] - ax;
    const dy = xy[b * 2 + 1] - ay;
    const len2 = dx * dx + dy * dy;
    let idx = -1;
    let md = t2;
    for (let i = a + 1; i < b; i++) {
      const px = xy[i * 2] - ax;
      const py = xy[i * 2 + 1] - ay;
      let d: number;
      if (len2 < 1e-12) d = px * px + py * py;
      else {
        const t = Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
        const ex = px - t * dx;
        const ey = py - t * dy;
        d = ex * ex + ey * ey;
      }
      if (d > md) {
        md = d;
        idx = i;
      }
    }
    if (idx >= 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(xy[i * 2], xy[i * 2 + 1]);
  return out;
}

export interface LineArtStroke {
  label: number;
  /** Polylines in image px (pixel centres), interleaved xy. */
  polylines: { xy: number[]; closed: boolean }[];
  /** Mean stroke width in px. */
  widthPx: number;
}

export interface LineArtResult {
  strokes: LineArtStroke[];
  /** 1 for pixels that became centrelines (to be given to neighbouring regions). */
  lineMask: Uint8Array;
}

/**
 * Find candidate-label components that are thin everywhere and convert them to centrelines.
 * `candidate[label]` marks dark, stitched labels.
 */
export function extractLineArt(
  labels: Uint8Array,
  w: number,
  h: number,
  candidate: boolean[],
  mmPerPx: number,
): LineArtResult {
  const n = w * h;
  const lineMask = new Uint8Array(n);
  const strokes: LineArtStroke[] = [];
  const only = new Uint8Array(n);
  let any = false;
  for (let i = 0; i < n; i++) {
    if (candidate[labels[i]]) {
      only[i] = 1;
      any = true;
    }
  }
  if (!any) return { strokes, lineMask };
  const cc = connectedComponents(labels, w, h, 8, only);
  const boxes = new Int32Array(cc.count * 4);
  for (let c = 0; c < cc.count; c++) {
    boxes[c * 4] = w;
    boxes[c * 4 + 1] = h;
    boxes[c * 4 + 2] = -1;
    boxes[c * 4 + 3] = -1;
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = cc.comp[y * w + x];
      if (c < 0) continue;
      const b = c * 4;
      if (x < boxes[b]) boxes[b] = x;
      if (y < boxes[b + 1]) boxes[b + 1] = y;
      if (x > boxes[b + 2]) boxes[b + 2] = x;
      if (y > boxes[b + 3]) boxes[b + 3] = y;
    }
  }
  const cfg = RASTER_CONFIG.lineArt;
  const maxWidthPx = cfg.maxWidthMm / mmPerPx;
  const minLenPx = cfg.minLengthMm / mmPerPx;
  const tolPx = cfg.simplifyMm / mmPerPx;
  for (let c = 0; c < cc.count; c++) {
    const x0 = boxes[c * 4];
    const y0 = boxes[c * 4 + 1];
    const bw = boxes[c * 4 + 2] - x0 + 1;
    const bh = boxes[c * 4 + 3] - y0 + 1;
    if (bw < 1 || bh < 1) continue;
    // Quick reject: a component whose area could not fit a long enough thin line.
    if (Math.max(bw, bh) < minLenPx) continue;
    const cw = bw + 2;
    const ch = bh + 2;
    const mask = new Uint8Array(cw * ch);
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        if (cc.comp[(y + y0) * w + x + x0] === c) mask[(y + 1) * cw + x + 1] = 1;
      }
    }
    const dt = distanceTransform2(mask, cw, ch);
    let maxD2 = 0;
    for (let i = 0; i < dt.length; i++) if (mask[i] && dt[i] > maxD2) maxD2 = dt[i];
    const maxWidth = 2 * Math.sqrt(maxD2) - 1;
    if (maxWidth >= maxWidthPx) continue;
    const skel = mask.slice();
    zhangSuen(skel, cw);
    let widthSum = 0;
    let widthN = 0;
    for (let i = 0; i < skel.length; i++) {
      if (skel[i]) {
        widthSum += Math.max(1, 2 * Math.sqrt(dt[i]) - 1);
        widthN++;
      }
    }
    if (widthN === 0) continue;
    const widthPx = widthSum / widthN;
    const raw = skeletonToPolylines(skel, cw);
    const spur = Math.max(2, widthPx);
    const polylines: { xy: number[]; closed: boolean }[] = [];
    const offs = OFFS(cw);
    const deg = (i: number) => offs.reduce((a, o) => a + (skel[i + o] ? 1 : 0), 0);
    for (const pl of raw) {
      const first = pl.pts[0];
      const last = pl.pts[pl.pts.length - 1];
      const len = polyLength(pl.pts, cw);
      if (!pl.closed) {
        const d0 = deg(first);
        const d1 = deg(last);
        // Spur: dangling branch off a junction, shorter than the line width.
        if (((d0 === 1 && d1 >= 3) || (d1 === 1 && d0 >= 3)) && len < spur) continue;
        // Internal edge of a junction cluster.
        if (d0 >= 3 && d1 >= 3 && len < 1.5) continue;
      }
      const xy: number[] = [];
      for (const p of pl.pts) xy.push((p % cw) - 1 + x0 + 0.5, Math.floor(p / cw) - 1 + y0 + 0.5);
      polylines.push({ xy: douglasPeucker(xy, tolPx, pl.closed), closed: pl.closed });
    }
    const total = polylines.reduce((a, p) => a + xyLength(p.xy, p.closed), 0);
    if (total < minLenPx) continue;
    strokes.push({ label: cc.label[c], polylines, widthPx });
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        const i = (y + y0) * w + x + x0;
        if (cc.comp[i] === c) lineMask[i] = 1;
      }
    }
  }
  return { strokes, lineMask };
}

function polyLength(pts: number[], w: number): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    const dx = (pts[i] % w) - (pts[i - 1] % w);
    const dy = Math.floor(pts[i] / w) - Math.floor(pts[i - 1] / w);
    len += Math.hypot(dx, dy);
  }
  return len;
}

function xyLength(xy: number[], closed: boolean): number {
  let len = 0;
  const n = xy.length / 2;
  for (let i = 1; i < n; i++) len += Math.hypot(xy[i * 2] - xy[i * 2 - 2], xy[i * 2 + 1] - xy[i * 2 - 1]);
  if (closed && n > 2) len += Math.hypot(xy[0] - xy[n * 2 - 2], xy[1] - xy[n * 2 - 1]);
  return len;
}
