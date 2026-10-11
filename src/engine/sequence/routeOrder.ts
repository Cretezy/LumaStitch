// SPDX-License-Identifier: GPL-3.0-or-later
/** Deterministic open-path optimization. Costs are lexicographic: thread changes, then distance. */
export interface RouteProblem {
  size: number;
  start: (i: number) => number;
  /** Must be finite, nonnegative and symmetric (2-opt reverses internal edges). */
  distance: (i: number, j: number) => number;
  thread?: (i: number) => string;
  predecessors?: ReadonlySet<number>[];
  last?: number;
}

const EPS = 1e-9;
export const EXACT_ROUTE_LIMIT = 14;

export function routeCost(p: RouteProblem, order: number[]): [number, number] {
  let changes = 0;
  let length = order.length ? p.start(order[0]) : 0;
  for (let k = 1; k < order.length; k++) {
    if (p.thread && p.thread(order[k - 1]) !== p.thread(order[k])) changes++;
    length += p.distance(order[k - 1], order[k]);
  }
  return [changes, length];
}

const better = (a: [number, number], b: [number, number]) =>
  a[0] < b[0] || (a[0] === b[0] && a[1] < b[1] - EPS);

/** Returns null for contradictory precedence; never releases a constraint to break a cycle. */
export function routeOrder(p: RouteProblem, incumbent?: number[]): number[] | null {
  const n = p.size;
  if (!n) return [];
  if (n <= EXACT_ROUTE_LIMIT) return exact(p);
  if (n <= 512) {
    const original = p;
    const distances = new Float64Array(n * n).fill(NaN);
    p = {
      ...p,
      distance: (i, j) => {
        const at = Math.min(i, j) * n + Math.max(i, j);
        if (Number.isNaN(distances[at])) distances[at] = original.distance(i, j);
        return distances[at];
      },
    };
  }
  const valid = (o: number[]) => {
    if (o.length !== n || new Set(o).size !== n) return false;
    const pos = new Int32Array(n);
    for (let k = 0; k < n; k++) {
      if (o[k] < 0 || o[k] >= n) return false;
      pos[o[k]] = k;
    }
    return (
      (p.last === undefined || o[n - 1] === p.last) &&
      (!p.predecessors || p.predecessors.every((ps, i) => [...ps].every((j) => pos[j] < pos[i])))
    );
  };
  let best = incumbent && valid(incumbent) ? incumbent.slice() : null;
  let score: [number, number] = best ? routeCost(p, best) : [Infinity, Infinity];
  // Include a natural start plus diverse forced starts. Fixed work limits keep this browser-safe.
  const starts = Array.from({ length: n }, (_, i) => i)
    .filter((i) => i !== p.last && !p.predecessors?.[i].size)
    .sort((a, b) => p.start(a) - p.start(b) || a - b);
  const count = n <= 64 ? Math.min(n, 16) : n <= 300 ? 4 : 1;
  const seeds =
    starts.length <= count
      ? starts
      : Array.from({ length: count }, (_, k) => starts[Math.floor((k * starts.length) / count)]);
  for (const first of seeds) {
    const used = new Uint8Array(n);
    const o: number[] = [];
    while (o.length < n) {
      let pick = -1;
      let value: [number, number] = [Infinity, Infinity];
      for (let j = 0; j < n; j++) {
        if (used[j] || (j === p.last && o.length < n - 1)) continue;
        if (!o.length && j !== first) continue;
        if (p.predecessors && [...p.predecessors[j]].some((i) => !used[i])) continue;
        const prev = o.at(-1);
        const v: [number, number] = [
          prev !== undefined && p.thread && p.thread(prev) !== p.thread(j) ? 1 : 0,
          prev === undefined ? p.start(j) : p.distance(prev, j),
        ];
        if (better(v, value)) {
          value = v;
          pick = j;
        }
      }
      if (pick < 0) break;
      used[pick] = 1;
      o.push(pick);
    }
    if (o.length !== n) continue;
    // Optimize each seed, not just the nearest-neighbour winner.
    improve(p, o);
    const c = routeCost(p, o);
    if (better(c, score)) {
      best = o;
      score = c;
    }
  }
  if (best) improve(p, best);
  return best;
}

/** Held–Karp DP, including precedence and a reserved final node. ~3 MB at 14 nodes. */
function exact(p: RouteProblem): number[] | null {
  const n = p.size;
  const full = (1 << n) - 1;
  const size = (full + 1) * n;
  const lengths = new Float64Array(size).fill(Infinity);
  const changes = new Uint8Array(size).fill(255);
  const previous = new Int8Array(size).fill(-1);
  const preds = Array.from({ length: n }, (_, i) =>
    [...(p.predecessors?.[i] ?? [])].reduce((m, j) => m | (1 << j), 0),
  );
  const distances = Float64Array.from({ length: n * n }, (_, k) => p.distance(Math.floor(k / n), k % n));
  const threads = Array.from({ length: n }, (_, i) => p.thread?.(i));
  for (let j = 0; j < n; j++) {
    if (preds[j] || (j === p.last && n > 1)) continue;
    const at = (1 << j) * n + j;
    lengths[at] = p.start(j);
    changes[at] = 0;
  }
  for (let mask = 1; mask <= full; mask++) {
    for (let i = 0; i < n; i++) {
      const at = mask * n + i;
      if (changes[at] === 255) continue;
      for (let j = 0; j < n; j++) {
        const bit = 1 << j;
        if (mask & bit || (preds[j] & mask) !== preds[j]) continue;
        const next = mask | bit;
        if (j === p.last && next !== full) continue;
        const to = next * n + j;
        const c = changes[at] + (threads[i] !== threads[j] ? 1 : 0);
        const d = lengths[at] + distances[i * n + j];
        if (c < changes[to] || (c === changes[to] && d < lengths[to] - EPS)) {
          changes[to] = c;
          lengths[to] = d;
          previous[to] = i;
        }
      }
    }
  }
  let last = -1;
  let score: [number, number] = [Infinity, Infinity];
  for (let i = 0; i < n; i++) {
    const at = full * n + i;
    const c: [number, number] = [changes[at], lengths[at]];
    if (changes[at] !== 255 && better(c, score)) {
      last = i;
      score = c;
    }
  }
  if (last < 0) return null;
  const out: number[] = [];
  let mask = full;
  while (last >= 0) {
    out.push(last);
    const prev = previous[mask * n + last];
    mask ^= 1 << last;
    last = prev;
  }
  out.reverse();
  // Stable tie-breaking for an unanchored symmetric route and its equally cheap reverse.
  if (
    !p.predecessors &&
    !p.thread &&
    p.last === undefined &&
    out[0] > out[n - 1] &&
    Math.abs(p.start(out[0]) - p.start(out[n - 1])) < EPS
  )
    out.reverse();
  return out;
}

/** 2-opt and single-node relocation with constant-time distance deltas, respecting every edge. */
function improve(p: RouteProblem, o: number[]): void {
  const n = o.length;
  const threads = Array.from({ length: n }, (_, i) => p.thread?.(i));
  const change = (a: number | undefined, b: number | undefined) =>
    a !== undefined && b !== undefined && threads[a] !== threads[b] ? 1 : 0;
  const distance = (a: number | undefined, b: number | undefined) =>
    b === undefined ? 0 : a === undefined ? p.start(b) : p.distance(a, b);
  const end = p.last === undefined ? n : n - 1;
  // Larger routes still improve, using a bounded index neighbourhood instead of skipping 2-opt.
  const window = n <= 300 ? n : 32;
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    const pos = new Int32Array(n);
    const positions = () =>
      o.forEach((v, k) => {
        pos[v] = k;
      });
    positions();
    for (let i = 0; i < end - 1; i++) {
      for (let j = i + 1; j < Math.min(end, i + window); j++) {
        const dc =
          change(o[i - 1], o[j]) + change(o[i], o[j + 1]) - change(o[i - 1], o[i]) - change(o[j], o[j + 1]);
        if (
          dc > 0 ||
          (dc === 0 &&
            distance(o[i - 1], o[j]) + distance(o[i], o[j + 1]) >=
              distance(o[i - 1], o[i]) + distance(o[j], o[j + 1]) - EPS)
        )
          continue;
        let allowed = true;
        if (p.predecessors)
          for (let k = i; k <= j && allowed; k++)
            for (const pred of p.predecessors[o[k]])
              if (pos[pred] >= i && pos[pred] <= j) {
                allowed = false;
                break;
              }
        if (!allowed) continue;
        for (let a = i, b = j; a < b; a++, b--) [o[a], o[b]] = [o[b], o[a]];
        positions();
        changed = true;
      }
    }
    for (let i = 0; i < end; i++) {
      const v = o[i];
      for (let j = Math.max(0, i - window); j < Math.min(end, i + window); j++) {
        if (j === i) continue;
        // Move v to final index j. Only relations with crossed nodes can change.
        let allowed = true;
        if (p.predecessors) {
          if (j < i) {
            for (const pred of p.predecessors[v]) if (pos[pred] >= j) allowed = false;
          } else for (let k = i + 1; k <= j; k++) if (p.predecessors[o[k]].has(v)) allowed = false;
        }
        if (!allowed) continue;
        const a = j < i ? o[j - 1] : o[j];
        const b = j < i ? o[j] : o[j + 1];
        const dc =
          change(o[i - 1], o[i + 1]) +
          change(a, v) +
          change(v, b) -
          change(o[i - 1], v) -
          change(v, o[i + 1]) -
          change(a, b);
        if (
          dc > 0 ||
          (dc === 0 &&
            distance(o[i - 1], o[i + 1]) + distance(a, v) + distance(v, b) >=
              distance(o[i - 1], v) + distance(v, o[i + 1]) + distance(a, b) - EPS)
        )
          continue;
        o.splice(i, 1);
        o.splice(j, 0, v);
        positions();
        changed = true;
        break;
      }
    }
    if (!changed) break;
  }
}
