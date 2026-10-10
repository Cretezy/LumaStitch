// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Mask cleaning on the whole label map (§9.1 step 5). Each label is opened then closed; the results are
 * recombined so labels stay a partition of the image (no overlaps, no gaps):
 *   1. a pixel keeps its label if it survives that label's opening;
 *   2. otherwise it goes to the first label whose closing covers it;
 *   3. anything left is filled from its neighbours.
 * Then regions smaller than the minimum area are merged into their longest-border neighbour.
 */
import { mergeSmallRegions } from './components';
import { close, open } from './morphology';

export const UNASSIGNED = 255;

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function labelBoxes(labels: Uint8Array, w: number, h: number, K: number): (Box | null)[] {
  const boxes: (Box | null)[] = Array.from({ length: K }, () => null);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const l = labels[y * w + x];
      if (l >= K) continue;
      const b = boxes[l];
      if (!b) boxes[l] = { x0: x, y0: y, x1: x + 1, y1: y + 1 };
      else {
        if (x < b.x0) b.x0 = x;
        if (x + 1 > b.x1) b.x1 = x + 1;
        if (y + 1 > b.y1) b.y1 = y + 1;
      }
    }
  }
  return boxes;
}

/** Fill UNASSIGNED pixels from their assigned 4-neighbours (multi-source BFS). In place. */
export function fillUnassigned(labels: Uint8Array, w: number, h: number): void {
  const n = w * h;
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  const queued = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (labels[i] !== UNASSIGNED) continue;
    const x = i % w;
    if (
      (x > 0 && labels[i - 1] !== UNASSIGNED) ||
      (x < w - 1 && labels[i + 1] !== UNASSIGNED) ||
      (i >= w && labels[i - w] !== UNASSIGNED) ||
      (i + w < n && labels[i + w] !== UNASSIGNED)
    ) {
      queue[tail++] = i;
      queued[i] = 1;
    }
  }
  const nb = new Int32Array(4);
  while (head < tail) {
    const i = queue[head++];
    const x = i % w;
    nb[0] = x > 0 ? i - 1 : -1;
    nb[1] = x < w - 1 ? i + 1 : -1;
    nb[2] = i >= w ? i - w : -1;
    nb[3] = i + w < n ? i + w : -1;
    // Majority label among assigned neighbours (first wins ties).
    let best = UNASSIGNED;
    let bestCount = 0;
    for (let a = 0; a < 4; a++) {
      const ja = nb[a];
      if (ja < 0 || labels[ja] === UNASSIGNED) continue;
      const la = labels[ja];
      let c = 0;
      for (let b = 0; b < 4; b++) if (nb[b] >= 0 && labels[nb[b]] === la) c++;
      if (c > bestCount) {
        bestCount = c;
        best = la;
      }
    }
    labels[i] = best;
    for (let a = 0; a < 4; a++) {
      const j = nb[a];
      if (j >= 0 && labels[j] === UNASSIGNED && !queued[j]) {
        queued[j] = 1;
        queue[tail++] = j;
      }
    }
  }
  // Whole image unassigned (nothing to grow from): fall back to label 0.
  for (let i = 0; i < n; i++) if (labels[i] === UNASSIGNED) labels[i] = 0;
}

/** Open then close every label with radius r (px), keeping a partition. */
export function morphLabels(labels: Uint8Array, w: number, h: number, K: number, r: number): Uint8Array {
  if (r <= 0) return labels.slice();
  const out = new Uint8Array(labels.length).fill(UNASSIGNED);
  const boxes = labelBoxes(labels, w, h, K);
  const margin = 2 * r + 1;
  const closed: { label: number; box: Box; bw: number; mask: Uint8Array }[] = [];
  for (let l = 0; l < K; l++) {
    const b = boxes[l];
    if (!b) continue;
    const box = {
      x0: Math.max(0, b.x0 - margin),
      y0: Math.max(0, b.y0 - margin),
      x1: Math.min(w, b.x1 + margin),
      y1: Math.min(h, b.y1 + margin),
    };
    const bw = box.x1 - box.x0;
    const bh = box.y1 - box.y0;
    const mask = new Uint8Array(bw * bh);
    for (let y = 0; y < bh; y++) {
      const row = (y + box.y0) * w + box.x0;
      for (let x = 0; x < bw; x++) if (labels[row + x] === l) mask[y * bw + x] = 1;
    }
    const opened = open(mask, bw, bh, r);
    for (let y = 0; y < bh; y++) {
      const row = (y + box.y0) * w + box.x0;
      for (let x = 0; x < bw; x++) if (opened[y * bw + x]) out[row + x] = l;
    }
    closed.push({ label: l, box, bw, mask: close(opened, bw, bh, r) });
  }
  for (const c of closed) {
    const l = c.label;
    const bh = c.box.y1 - c.box.y0;
    for (let y = 0; y < bh; y++) {
      const row = (y + c.box.y0) * w + c.box.x0;
      for (let x = 0; x < c.bw; x++) {
        if (c.mask[y * c.bw + x] && out[row + x] === UNASSIGNED) out[row + x] = l;
      }
    }
  }
  fillUnassigned(out, w, h);
  return out;
}

export interface CleanResult {
  labels: Uint8Array;
  /** Number of small regions merged away. */
  merged: number;
}

/** Morphology + small-region merge. */
export function cleanLabels(
  labels: Uint8Array,
  w: number,
  h: number,
  K: number,
  radiusPx: number,
  minAreaPx: number,
): CleanResult {
  const morphed = morphLabels(labels, w, h, K, radiusPx);
  if (minAreaPx <= 1) return { labels: morphed, merged: 0 };
  return mergeSmallRegions(morphed, w, h, minAreaPx);
}
