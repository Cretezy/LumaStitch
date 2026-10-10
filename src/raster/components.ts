// SPDX-License-Identifier: GPL-3.0-or-later
/** Connected components of a label map (two-pass union-find) and small-region merging (§9.1 step 5). */

export interface Components {
  /** Component id per pixel (0..count-1). */
  comp: Int32Array;
  count: number;
  /** Pixels per component. */
  size: Int32Array;
  /** Label of each component. */
  label: Uint8Array;
}

function find(parent: Int32Array, x: number): number {
  let r = x;
  while (parent[r] !== r) r = parent[r];
  while (parent[x] !== r) {
    const n = parent[x];
    parent[x] = r;
    x = n;
  }
  return r;
}

/**
 * Two-pass connected-component labelling of pixels with equal labels.
 * `connectivity` 4 (default) or 8. If `only` is given, pixels where only[i] === 0 are ignored (comp = -1).
 */
export function connectedComponents(
  labels: Uint8Array,
  w: number,
  h: number,
  connectivity: 4 | 8 = 4,
  only?: Uint8Array,
): Components {
  const n = w * h;
  const comp = new Int32Array(n).fill(-1);
  // Provisional ids are pixel indices of the first pixel; union-find over a compact array.
  let parent = new Int32Array(Math.max(16, n >> 4));
  let next = 0;
  const newId = () => {
    if (next >= parent.length) {
      const p = new Int32Array(parent.length * 2);
      p.set(parent);
      parent = p;
    }
    parent[next] = next;
    return next++;
  };
  const union = (a: number, b: number) => {
    const ra = find(parent, a);
    const rb = find(parent, b);
    if (ra !== rb) {
      if (ra < rb) parent[rb] = ra;
      else parent[ra] = rb;
    }
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (only && !only[i]) continue;
      const l = labels[i];
      let id = -1;
      for (let k = 0; k < 4; k++) {
        let j: number;
        if (k === 0) j = x > 0 ? i - 1 : -1;
        else if (k === 1) j = y > 0 ? i - w : -1;
        else if (connectivity === 4) break;
        else if (k === 2) j = x > 0 && y > 0 ? i - w - 1 : -1;
        else j = x < w - 1 && y > 0 ? i - w + 1 : -1;
        if (j < 0) continue;
        const cj = comp[j];
        if (cj < 0 || labels[j] !== l) continue;
        if (id < 0) id = cj;
        else if (cj !== id) union(id, cj);
      }
      comp[i] = id >= 0 ? id : newId();
    }
  }
  // Compact roots.
  const remap = new Int32Array(next).fill(-1);
  let count = 0;
  for (let i = 0; i < next; i++) {
    const r = find(parent, i);
    if (remap[r] < 0) remap[r] = count++;
    remap[i] = remap[r];
  }
  const size = new Int32Array(count);
  const label = new Uint8Array(count);
  for (let i = 0; i < n; i++) {
    const c = comp[i];
    if (c < 0) continue;
    const r = remap[c];
    comp[i] = r;
    size[r]++;
    label[r] = labels[i];
  }
  return { comp, count, size, label };
}

/**
 * Merge regions smaller than `minArea` px into the neighbouring region with the longest shared border.
 * Returns the new label map and the number of merged regions.
 */
export function mergeSmallRegions(
  labels: Uint8Array,
  w: number,
  h: number,
  minArea: number,
): { labels: Uint8Array; merged: number } {
  const cc = connectedComponents(labels, w, h, 4);
  const { comp, count, size, label } = cc;
  const small: number[] = [];
  for (let c = 0; c < count; c++) if (size[c] < minArea) small.push(c);
  if (small.length === 0 || count <= 1) return { labels: labels.slice(), merged: 0 };
  const isSmall = new Uint8Array(count);
  for (const c of small) isSmall[c] = 1;
  const adj = new Map<number, Map<number, number>>();
  const addBorder = (a: number, b: number) => {
    let m = adj.get(a);
    if (!m) {
      m = new Map();
      adj.set(a, m);
    }
    m.set(b, (m.get(b) ?? 0) + 1);
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const a = comp[i];
      if (x + 1 < w) {
        const b = comp[i + 1];
        if (a !== b) {
          if (isSmall[a]) addBorder(a, b);
          if (isSmall[b]) addBorder(b, a);
        }
      }
      if (y + 1 < h) {
        const b = comp[i + w];
        if (a !== b) {
          if (isSmall[a]) addBorder(a, b);
          if (isSmall[b]) addBorder(b, a);
        }
      }
    }
  }
  const parent = new Int32Array(count);
  for (let c = 0; c < count; c++) parent[c] = c;
  const sz = Float64Array.from(size);
  small.sort((a, b) => size[a] - size[b] || a - b);
  let merged = 0;
  for (const c0 of small) {
    const c = find(parent, c0);
    if (c !== c0 || sz[c] >= minArea) continue;
    const nb = adj.get(c);
    if (!nb) continue;
    const totals = new Map<number, number>();
    for (const [k, v] of nb) {
      const r = find(parent, k);
      if (r !== c) totals.set(r, (totals.get(r) ?? 0) + v);
    }
    let best = -1;
    let bestLen = -1;
    for (const [r, v] of totals) {
      if (v > bestLen || (v === bestLen && sz[r] > sz[best])) {
        best = r;
        bestLen = v;
      }
    }
    if (best < 0) continue;
    parent[c] = best;
    sz[best] += sz[c];
    merged++;
    // Carry c's borders over to the target so later merges see them.
    let tm = adj.get(best);
    if (!tm) {
      tm = new Map();
      adj.set(best, tm);
    }
    for (const [k, v] of totals) if (k !== best) tm.set(k, (tm.get(k) ?? 0) + v);
    adj.delete(c);
  }
  const finalLabel = new Uint8Array(count);
  for (let c = 0; c < count; c++) finalLabel[c] = label[find(parent, c)];
  const out = new Uint8Array(labels.length);
  for (let i = 0; i < out.length; i++) out[i] = finalLabel[comp[i]];
  return { labels: out, merged };
}
