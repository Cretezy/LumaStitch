// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * k-means on interleaved 3-D points (CIELAB), typed arrays only. Greedy k-means++ initialisation with a
 * seeded PRNG, Lloyd iterations, automatic k search (SPEC §9.1 step 3).
 */
import { RASTER_CONFIG } from './config';
import { mulberry32 } from './prng';

export interface KMeansResult {
  /** Number of centres actually found (≤ requested when the data has fewer distinct points). */
  k: number;
  /** Interleaved centres, 3 per cluster. */
  centers: Float32Array;
  /** Sum of squared distances. */
  error: number;
  /** Number of points farther than `outlierDist` from their centre. */
  outliers: number;
  /** Points per cluster. */
  counts: Int32Array;
}

function d2(data: Float32Array, i: number, c: Float32Array, j: number): number {
  const a = data[i] - c[j];
  const b = data[i + 1] - c[j + 1];
  const e = data[i + 2] - c[j + 2];
  return a * a + b * b + e * e;
}

/** k-means with greedy k-means++ seeding. `data` has m points. Deterministic for a given seed. */
export function kmeans(
  data: Float32Array,
  m: number,
  k: number,
  seed: number,
  maxIter = RASTER_CONFIG.kmeans.maxIter,
): KMeansResult {
  const rand = mulberry32(seed ^ Math.imul(k, 0x9e3779b1));
  const centers = new Float32Array(k * 3);
  if (m === 0)
    return { k: 0, centers: new Float32Array(0), error: 0, outliers: 0, counts: new Int32Array(0) };
  const D = new Float64Array(m);
  // first centre
  const first = Math.min(m - 1, Math.floor(rand() * m));
  centers.set(data.subarray(first * 3, first * 3 + 3), 0);
  let total = 0;
  for (let i = 0; i < m; i++) {
    D[i] = d2(data, i * 3, centers, 0);
    total += D[i];
  }
  let found = 1;
  const candidates = 2 + Math.floor(Math.log(k));
  const tmp = new Float32Array(3);
  while (found < k) {
    if (total <= 1e-9) break; // no more distinct points
    let bestIdx = -1;
    let bestPot = Infinity;
    for (let c = 0; c < candidates; c++) {
      // sample ∝ D
      let r = rand() * total;
      let idx = 0;
      for (; idx < m - 1; idx++) {
        r -= D[idx];
        if (r <= 0) break;
      }
      if (D[idx] <= 0) {
        // landed on a zero due to rounding: walk to the next positive
        let j = idx;
        while (j < m && D[j] <= 0) j++;
        if (j >= m) continue;
        idx = j;
      }
      tmp[0] = data[idx * 3];
      tmp[1] = data[idx * 3 + 1];
      tmp[2] = data[idx * 3 + 2];
      let pot = 0;
      for (let i = 0; i < m; i++) {
        const dd = d2(data, i * 3, tmp, 0);
        pot += dd < D[i] ? dd : D[i];
      }
      if (pot < bestPot) {
        bestPot = pot;
        bestIdx = idx;
      }
    }
    if (bestIdx < 0) break;
    const o = found * 3;
    centers[o] = data[bestIdx * 3];
    centers[o + 1] = data[bestIdx * 3 + 1];
    centers[o + 2] = data[bestIdx * 3 + 2];
    total = 0;
    for (let i = 0; i < m; i++) {
      const dd = d2(data, i * 3, centers, o);
      if (dd < D[i]) D[i] = dd;
      total += D[i];
    }
    found++;
  }
  const K = found;
  const C = centers.slice(0, K * 3);
  const assign = new Int32Array(m).fill(-1);
  const sums = new Float64Array(K * 3);
  const counts = new Int32Array(K);
  for (let iter = 0; iter < maxIter; iter++) {
    let changed = 0;
    sums.fill(0);
    counts.fill(0);
    for (let i = 0; i < m; i++) {
      const p = i * 3;
      let best = 0;
      let bd = Infinity;
      for (let j = 0; j < K; j++) {
        const dd = d2(data, p, C, j * 3);
        if (dd < bd) {
          bd = dd;
          best = j;
        }
      }
      D[i] = bd;
      if (assign[i] !== best) {
        assign[i] = best;
        changed++;
      }
      counts[best]++;
      sums[best * 3] += data[p];
      sums[best * 3 + 1] += data[p + 1];
      sums[best * 3 + 2] += data[p + 2];
    }
    for (let j = 0; j < K; j++) {
      if (counts[j] > 0) {
        C[j * 3] = sums[j * 3] / counts[j];
        C[j * 3 + 1] = sums[j * 3 + 1] / counts[j];
        C[j * 3 + 2] = sums[j * 3 + 2] / counts[j];
      } else {
        // Empty cluster: move it to the worst-explained point.
        let far = 0;
        for (let i = 1; i < m; i++) if (D[i] > D[far]) far = i;
        C[j * 3] = data[far * 3];
        C[j * 3 + 1] = data[far * 3 + 1];
        C[j * 3 + 2] = data[far * 3 + 2];
        D[far] = 0;
        changed++;
      }
    }
    if (changed === 0) break;
  }
  // Final error with the final centres.
  let error = 0;
  let outliers = 0;
  const od2 = RASTER_CONFIG.autoK.outlierDist ** 2;
  counts.fill(0);
  for (let i = 0; i < m; i++) {
    const p = i * 3;
    let best = 0;
    let bd = Infinity;
    for (let j = 0; j < K; j++) {
      const dd = d2(data, p, C, j * 3);
      if (dd < bd) {
        bd = dd;
        best = j;
      }
    }
    counts[best]++;
    error += bd;
    if (bd > od2) outliers++;
  }
  return { k: K, centers: C, error, outliers, counts };
}

/** Sum of squared distances to the mean (the 1-cluster error). */
export function totalVariance(data: Float32Array, m: number): number {
  if (m === 0) return 0;
  let a = 0;
  let b = 0;
  let c = 0;
  for (let i = 0; i < m; i++) {
    a += data[i * 3];
    b += data[i * 3 + 1];
    c += data[i * 3 + 2];
  }
  a /= m;
  b /= m;
  c /= m;
  let e = 0;
  for (let i = 0; i < m; i++) {
    const x = data[i * 3] - a;
    const y = data[i * 3 + 1] - b;
    const z = data[i * 3 + 2] - c;
    e += x * x + y * y + z * z;
  }
  return e;
}

/** Best (lowest error) of `restarts` k-means runs with consecutive seeds. */
export function kmeansBest(
  data: Float32Array,
  m: number,
  k: number,
  seed: number,
  restarts: number,
): KMeansResult {
  let best: KMeansResult | null = null;
  for (let r = 0; r < Math.max(1, restarts); r++) {
    const res = kmeans(data, m, k, seed + r * 7919);
    if (!best || res.k > best.k || (res.k === best.k && res.error < best.error)) best = res;
  }
  return best!;
}

/**
 * Automatic colour count in [minK, maxK].
 *
 * - Elbow rule (SPEC §9.1): the smallest k where adding colours gains less than `minGain` of the
 *   1-cluster error (and less than `maxRelGain` of the current error). The gain looks two steps ahead so
 *   a single poor local minimum at k+1 cannot stop the search early.
 * - Flat artwork (`flatArt`, sample drawn from flat pixels only): the smallest k that explains almost
 *   every sample point (fewer than `outlierFrac` farther than `outlierDist`). This keeps small but
 *   distinct colours that the elbow rule would merge. Falls back to the elbow if never reached.
 */
export function autoK(
  data: Float32Array,
  m: number,
  seed: number,
  flatArt: boolean,
): { k: number; runs: Map<number, KMeansResult> } {
  const { minK, maxK, autoRestarts } = RASTER_CONFIG.kmeans;
  const { minGain, maxRelGain, outlierFrac } = RASTER_CONFIG.autoK;
  const runs = new Map<number, KMeansResult>();
  const run = (k: number) => {
    let r = runs.get(k);
    if (!r) {
      r = kmeansBest(data, m, k, seed, autoRestarts);
      runs.set(k, r);
    }
    return r;
  };
  const e1 = totalVariance(data, m);
  let elbow = -1;
  for (let k = minK; k <= maxK; k++) {
    const rk = run(k);
    if (rk.k < k) return { k: Math.max(1, rk.k), runs }; // fewer distinct colours than k
    if (rk.outliers < outlierFrac * m) return { k, runs };
    if (elbow < 0) {
      if (k === maxK) elbow = k;
      else {
        let next = run(k + 1).error;
        if (k + 2 <= maxK) next = Math.min(next, run(k + 2).error);
        const gain = rk.error - next;
        if (gain < minGain * e1 && gain < maxRelGain * rk.error) elbow = k;
      }
      if (elbow >= 0 && !flatArt) return { k: elbow, runs };
    }
  }
  return { k: elbow >= 0 ? elbow : maxK, runs };
}

/** Nearest-centre assignment for `n` Lab pixels. */
export function assignNearest(
  lab: Float32Array,
  n: number,
  centers: Float32Array,
  k: number,
  out: Uint8Array,
  skip?: Uint8Array | null,
): void {
  for (let i = 0; i < n; i++) {
    if (skip && skip[i]) continue;
    const p = i * 3;
    let best = 0;
    let bd = Infinity;
    for (let j = 0; j < k; j++) {
      const dd = d2(lab, p, centers, j * 3);
      if (dd < bd) {
        bd = dd;
        best = j;
      }
    }
    out[i] = best;
  }
}
