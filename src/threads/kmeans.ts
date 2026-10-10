// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Colour reduction in CIELAB:
 *  - `mergeCloseColors`: agglomerative (centroid-linkage) merge of colours closer
 *    than a ΔE2000 threshold (SPEC §9 step 2: ΔE00 5).
 *  - `kmeansLab`: weighted k-means with k-means++ seeding and a seeded PRNG.
 *    Distances are squared Euclidean in Lab (ΔE76), which keeps Lloyd's
 *    iterations convergent; ΔE2000 is used for merging and thread matching.
 *  - `reduceColors`: merge, then k-means if more than `maxColors` remain.
 * Everything is deterministic for a given input order and seed.
 */
import { deltaE2000, labToHex, normalizeHex, type Lab } from './color';
import { labOf } from './nearest';

export interface WeightedColor {
  color: string;
  /** Importance (e.g. area or pixel count). Default 1. Negative counts as 0. */
  weight?: number;
}

export interface ColorCluster {
  /** Representative colour (`#rrggbb`): the weighted Lab mean of the members. */
  color: string;
  lab: Lab;
  /** Sum of member weights. */
  weight: number;
  /** Indexes into the input array, ascending. */
  members: number[];
  /** Input index of the heaviest member (ties: lowest index). */
  dominant: number;
}

/** mulberry32: tiny, fast, seeded PRNG returning floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const effWeight = (w: number | undefined): number => (w === undefined ? 1 : w > 0 ? w : 0);

/** Weighted mean in Lab. Falls back to an unweighted mean when all weights are 0. */
function meanLab(labs: readonly Lab[], weights: readonly number[]): Lab {
  let W = 0;
  for (const w of weights) W += w;
  const useW = W > 0;
  const n = useW ? W : labs.length;
  let L = 0;
  let A = 0;
  let B = 0;
  for (let i = 0; i < labs.length; i++) {
    const w = useW ? weights[i] : 1;
    L += labs[i][0] * w;
    A += labs[i][1] * w;
    B += labs[i][2] * w;
  }
  return [L / n, A / n, B / n];
}

/**
 * Average of colours in Lab (e.g. gradient stops). Returns `#000000` for an
 * empty list.
 */
export function averageColor(hexes: readonly string[], weights?: readonly number[]): string {
  if (hexes.length === 0) return '#000000';
  if (hexes.length === 1) return normalizeHex(hexes[0]);
  const ws = hexes.map((_, i) => effWeight(weights?.[i]));
  return labToHex(meanLab(hexes.map(labOf), ws));
}

interface Group {
  lab: Lab;
  /** Effective (non-negative) weight used for means. */
  ew: number;
  /** Number of input items, for the all-zero-weight fallback. */
  n: number;
  weight: number;
  members: number[];
  /** Exact colour while the group holds a single distinct colour. */
  exact: string | null;
}

function mergeLab(a: Group, b: Group): Lab {
  const [wa, wb] = a.ew + b.ew > 0 ? [a.ew, b.ew] : [a.n, b.n];
  const W = wa + wb;
  return [
    (a.lab[0] * wa + b.lab[0] * wb) / W,
    (a.lab[1] * wa + b.lab[1] * wb) / W,
    (a.lab[2] * wa + b.lab[2] * wb) / W,
  ];
}

function groupDistinct(items: readonly WeightedColor[]): Group[] {
  const byHex = new Map<string, Group>();
  const groups: Group[] = [];
  items.forEach((it, i) => {
    const hex = normalizeHex(it.color);
    let g = byHex.get(hex);
    if (!g) {
      g = { lab: labOf(hex), ew: 0, n: 0, weight: 0, members: [], exact: hex };
      byHex.set(hex, g);
      groups.push(g);
    }
    g.ew += effWeight(it.weight);
    g.n += 1;
    g.weight += it.weight ?? 1;
    g.members.push(i);
  });
  return groups;
}

function toCluster(g: Group, items: readonly WeightedColor[]): ColorCluster {
  const members = [...g.members].sort((a, b) => a - b);
  let dominant = members[0];
  let best = -Infinity;
  for (const m of members) {
    const w = items[m].weight ?? 1;
    if (w > best) {
      best = w;
      dominant = m;
    }
  }
  const color = g.exact ?? labToHex(g.lab);
  return { color, lab: [g.lab[0], g.lab[1], g.lab[2]], weight: g.weight, members, dominant };
}

function sortClusters(cs: ColorCluster[]): ColorCluster[] {
  return cs.sort((a, b) => a.members[0] - b.members[0]);
}

/**
 * Agglomerative merge: repeatedly merge the two closest clusters (ΔE2000
 * between their weighted Lab means) while that distance is < `threshold`.
 * Identical colours are always merged. Clusters are returned in order of their
 * first member.
 */
export function mergeCloseColors(items: readonly WeightedColor[], threshold = 5): ColorCluster[] {
  const g = groupDistinct(items);
  const n = g.length;
  const alive = new Uint8Array(n).fill(1);
  const nn = new Int32Array(n).fill(-1);
  const nnD = new Float64Array(n).fill(Infinity);

  const recompute = (i: number) => {
    nn[i] = -1;
    nnD[i] = Infinity;
    for (let j = 0; j < n; j++) {
      if (j === i || !alive[j]) continue;
      const d = deltaE2000(g[i].lab, g[j].lab);
      if (d < nnD[i]) {
        nnD[i] = d;
        nn[i] = j;
      }
    }
  };
  for (let i = 0; i < n; i++) recompute(i);

  for (;;) {
    let i = -1;
    let best = Infinity;
    for (let k = 0; k < n; k++) {
      if (alive[k] && nnD[k] < best) {
        best = nnD[k];
        i = k;
      }
    }
    if (i < 0 || !(best < threshold)) break;
    const a = Math.min(i, nn[i]);
    const b = Math.max(i, nn[i]);
    const ga = g[a];
    const gb = g[b];
    ga.lab = mergeLab(ga, gb);
    ga.ew += gb.ew;
    ga.n += gb.n;
    ga.weight += gb.weight;
    ga.members.push(...gb.members);
    ga.exact = null;
    alive[b] = 0;
    recompute(a);
    for (let k = 0; k < n; k++) {
      if (!alive[k] || k === a) continue;
      if (nn[k] === a || nn[k] === b) recompute(k);
      else {
        const d = deltaE2000(g[k].lab, ga.lab);
        if (d < nnD[k] || (d === nnD[k] && a < nn[k])) {
          nnD[k] = d;
          nn[k] = a;
        }
      }
    }
  }

  const out: ColorCluster[] = [];
  for (let i = 0; i < n; i++) if (alive[i]) out.push(toCluster(g[i], items));
  return sortClusters(out);
}

export interface KMeansOptions {
  /** Maximum Lloyd iterations (default 100). */
  maxIter?: number;
}

export interface KMeansResult {
  /** Cluster centres; fewer than k when there are fewer distinct points. */
  centers: Lab[];
  /** For each point, the index of its centre. */
  assignment: Int32Array;
  /** Weighted sum of squared Lab distances to the assigned centres. */
  inertia: number;
  iterations: number;
}

/**
 * Weighted k-means in Lab with k-means++ initialisation. `weights` may be
 * omitted (all 1). Deterministic for a given input and `seed`.
 */
export function kmeansLab(
  points: readonly Lab[],
  weights: ArrayLike<number> | undefined,
  k: number,
  seed = 1,
  opts: KMeansOptions = {},
): KMeansResult {
  const n = points.length;
  const maxIter = opts.maxIter ?? 100;
  const assignment = new Int32Array(n);
  k = Math.max(0, Math.min(Math.floor(k), n));
  if (n === 0 || k === 0) return { centers: [], assignment, inertia: 0, iterations: 0 };

  const P = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    P[i * 3] = points[i][0];
    P[i * 3 + 1] = points[i][1];
    P[i * 3 + 2] = points[i][2];
  }
  const W = new Float64Array(n);
  let wsum = 0;
  for (let i = 0; i < n; i++) {
    const w = weights ? weights[i] : 1;
    W[i] = w > 0 ? w : 0;
    wsum += W[i];
  }
  if (wsum === 0) W.fill(1);

  const rand = mulberry32(seed);
  const C: number[] = []; // flat centres
  const d2 = (i: number, c: number) => {
    const dx = P[i * 3] - C[c * 3];
    const dy = P[i * 3 + 1] - C[c * 3 + 1];
    const dz = P[i * 3 + 2] - C[c * 3 + 2];
    return dx * dx + dy * dy + dz * dz;
  };
  const pick = (score: Float64Array): number => {
    let total = 0;
    for (let i = 0; i < n; i++) total += score[i];
    if (!(total > 0)) return -1;
    let r = rand() * total;
    let last = -1;
    for (let i = 0; i < n; i++) {
      if (score[i] <= 0) continue;
      last = i;
      r -= score[i];
      if (r < 0) return i;
    }
    return last;
  };

  // k-means++ seeding.
  const minD = new Float64Array(n).fill(Infinity);
  const score = new Float64Array(n);
  let first = pick(W);
  if (first < 0) first = 0;
  C.push(P[first * 3], P[first * 3 + 1], P[first * 3 + 2]);
  while (C.length / 3 < k) {
    const c = C.length / 3 - 1;
    for (let i = 0; i < n; i++) {
      const d = d2(i, c);
      if (d < minD[i]) minD[i] = d;
      score[i] = W[i] * minD[i];
    }
    const next = pick(score);
    if (next < 0) break; // every remaining point coincides with a centre
    C.push(P[next * 3], P[next * 3 + 1], P[next * 3 + 2]);
  }
  const K = C.length / 3;

  // Lloyd iterations.
  const dist = new Float64Array(n);
  const assign = () => {
    let changed = false;
    for (let i = 0; i < n; i++) {
      let best = 0;
      let bd = d2(i, 0);
      for (let c = 1; c < K; c++) {
        const d = d2(i, c);
        if (d < bd) {
          bd = d;
          best = c;
        }
      }
      dist[i] = bd;
      if (assignment[i] !== best) {
        assignment[i] = best;
        changed = true;
      }
    }
    return changed;
  };
  assign();
  let iterations = 0;
  const sums = new Float64Array(K * 4);
  const counts = new Int32Array(K);
  while (iterations < maxIter) {
    iterations++;
    let reseeded = false;
    sums.fill(0);
    counts.fill(0);
    for (let i = 0; i < n; i++) {
      const c = assignment[i];
      const w = W[i];
      sums[c * 4] += P[i * 3] * w;
      sums[c * 4 + 1] += P[i * 3 + 1] * w;
      sums[c * 4 + 2] += P[i * 3 + 2] * w;
      sums[c * 4 + 3] += w;
      counts[c]++;
    }
    for (let c = 0; c < K; c++) {
      if (counts[c] === 0) {
        // Empty cluster: move it to the point that is worst served.
        let worst = -1;
        let wd = -1;
        for (let i = 0; i < n; i++) {
          const s = W[i] * dist[i];
          if (s > wd && counts[assignment[i]] > 1) {
            wd = s;
            worst = i;
          }
        }
        if (worst >= 0) {
          counts[assignment[worst]]--;
          counts[c] = 1;
          assignment[worst] = c;
          dist[worst] = 0;
          C[c * 3] = P[worst * 3];
          C[c * 3 + 1] = P[worst * 3 + 1];
          C[c * 3 + 2] = P[worst * 3 + 2];
          reseeded = true;
        }
        continue;
      }
      if (sums[c * 4 + 3] > 0) {
        C[c * 3] = sums[c * 4] / sums[c * 4 + 3];
        C[c * 3 + 1] = sums[c * 4 + 1] / sums[c * 4 + 3];
        C[c * 3 + 2] = sums[c * 4 + 2] / sums[c * 4 + 3];
      }
    }
    if (!assign() && !reseeded) break;
  }

  let inertia = 0;
  for (let i = 0; i < n; i++) inertia += W[i] * dist[i];
  const centers: Lab[] = [];
  for (let c = 0; c < K; c++) centers.push([C[c * 3], C[c * 3 + 1], C[c * 3 + 2]]);
  return { centers, assignment, inertia, iterations };
}

export interface ReduceOptions {
  /** ΔE2000 merge threshold (default 5). */
  threshold?: number;
  /** k-means seed (default 1). */
  seed?: number;
}

export interface ReduceResult {
  /** Output palette, ordered by first member. */
  clusters: ColorCluster[];
  /** For each input item, the index of its output cluster. */
  mapping: number[];
}

/**
 * SPEC §9 step 2: merge colours closer than ΔE00 `threshold`, then, if more
 * than `maxColors` remain, cluster them in Lab down to `maxColors` (weighted
 * k-means). Each input is mapped to its output colour.
 */
export function reduceColors(
  items: readonly WeightedColor[],
  maxColors = Infinity,
  opts: ReduceOptions = {},
): ReduceResult {
  let clusters = mergeCloseColors(items, opts.threshold ?? 5);
  const max = Math.max(1, Math.floor(maxColors));
  if (clusters.length > max) {
    const km = kmeansLab(
      clusters.map((c) => c.lab),
      clusters.map((c) => c.members.reduce((s, m) => s + effWeight(items[m].weight), 0)),
      max,
      opts.seed ?? 1,
    );
    const parts: ColorCluster[][] = km.centers.map(() => []);
    clusters.forEach((c, i) => parts[km.assignment[i]].push(c));
    const out: ColorCluster[] = [];
    km.centers.forEach((center, ci) => {
      const ps = parts[ci];
      if (ps.length === 0) return;
      if (ps.length === 1) {
        out.push(ps[0]);
        return;
      }
      const members = ps.flatMap((p) => p.members).sort((a, b) => a - b);
      let dominant = members[0];
      let best = -Infinity;
      for (const m of members) {
        const w = items[m].weight ?? 1;
        if (w > best) {
          best = w;
          dominant = m;
        }
      }
      out.push({
        color: labToHex(center),
        lab: center,
        weight: ps.reduce((s, p) => s + p.weight, 0),
        members,
        dominant,
      });
    });
    clusters = sortClusters(out);
  }
  const mapping = new Array<number>(items.length).fill(-1);
  clusters.forEach((c, ci) => {
    for (const m of c.members) mapping[m] = ci;
  });
  return { clusters, mapping };
}
