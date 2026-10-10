// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Approximate medial axis (skeleton) via the Voronoi diagram of densely sampled boundary points.
 * Voronoi vertices are Delaunay circumcentres; we keep Voronoi edges between non-adjacent boundary
 * samples whose endpoints both lie inside the polygon. Node radius ≈ distance to the boundary.
 */
import { Delaunay } from 'd3-delaunay';
import { createPointTester, ringPerimeter } from './polygon';
import { resampleFixed } from './polyline';
import type { PolyShape, Ring } from './types';

export interface Skeleton {
  x: Float64Array;
  y: Float64Array;
  /** Inscribed-circle radius at each node. */
  r: Float64Array;
  adj: number[][];
  alive: Uint8Array;
}

export interface MedialInfo {
  skeleton: Skeleton;
  maxRadius: number;
  /** 2 × max inscribed radius. */
  maxWidth: number;
  leaves: number;
  junctions: number;
  /** Significant extra branches beyond a simple column (leaves − 2, ≥ 0). */
  branches: number;
  /** Node indices of the longest path. */
  diameter: number[];
  diameterLength: number;
  holes: number;
}

export interface MedialOptions {
  /** Boundary sample spacing in mm. */
  step?: number;
  /** Cap on total boundary samples. */
  maxSamples?: number;
  /** Prune leaf branches shorter than pruneFactor × junction radius + pruneMin. */
  pruneFactor?: number;
  pruneMin?: number;
}

function closeRing(r: Ring): Float64Array {
  const c = new Float64Array(r.length + 2);
  c.set(r);
  c[r.length] = r[0];
  c[r.length + 1] = r[1];
  return c;
}

export function medialAxis(ps: PolyShape, opts: MedialOptions = {}): MedialInfo {
  const maxSamples = opts.maxSamples ?? 6000;
  const rings: Ring[] = [];
  let holes = 0;
  for (const p of ps) {
    rings.push(p.outer);
    for (const h of p.holes) {
      rings.push(h);
      holes++;
    }
  }
  let perim = 0;
  for (const r of rings) perim += ringPerimeter(r);
  const step = Math.max(opts.step ?? 0.3, perim / maxSamples);

  // Sample boundary.
  const pts: number[] = [];
  const ringOf: number[] = [];
  const idxInRing: number[] = [];
  const ringCount: number[] = [];
  rings.forEach((r, ri) => {
    const s = resampleFixed(closeRing(r), step);
    const n = s.length / 2 - 1; // drop closing duplicate
    ringCount.push(n);
    for (let i = 0; i < n; i++) {
      pts.push(s[i * 2], s[i * 2 + 1]);
      ringOf.push(ri);
      idxInRing.push(i);
    }
  });
  const empty: MedialInfo = {
    skeleton: {
      x: new Float64Array(),
      y: new Float64Array(),
      r: new Float64Array(),
      adj: [],
      alive: new Uint8Array(),
    },
    maxRadius: 0,
    maxWidth: 0,
    leaves: 0,
    junctions: 0,
    branches: 0,
    diameter: [],
    diameterLength: 0,
    holes,
  };
  if (pts.length < 6) return empty;

  const del = new Delaunay(Float64Array.from(pts));
  const { triangles, halfedges } = del;
  const nt = triangles.length / 3;
  const cx = new Float64Array(nt),
    cy = new Float64Array(nt),
    cr = new Float64Array(nt);
  const inside = createPointTester(ps);
  const ok = new Uint8Array(nt);
  for (let t = 0; t < nt; t++) {
    const a = triangles[t * 3],
      b = triangles[t * 3 + 1],
      c = triangles[t * 3 + 2];
    const ax = pts[a * 2],
      ay = pts[a * 2 + 1],
      bx = pts[b * 2],
      by = pts[b * 2 + 1],
      qx = pts[c * 2],
      qy = pts[c * 2 + 1];
    const d = 2 * (ax * (by - qy) + bx * (qy - ay) + qx * (ay - by));
    if (Math.abs(d) < 1e-12) continue;
    const a2 = ax * ax + ay * ay,
      b2 = bx * bx + by * by,
      c2 = qx * qx + qy * qy;
    const ux = (a2 * (by - qy) + b2 * (qy - ay) + c2 * (ay - by)) / d;
    const uy = (a2 * (qx - bx) + b2 * (ax - qx) + c2 * (bx - ax)) / d;
    cx[t] = ux;
    cy[t] = uy;
    cr[t] = Math.hypot(ux - ax, uy - ay);
    if (inside(ux, uy)) ok[t] = 1;
  }

  const adjacentSites = (s1: number, s2: number) => {
    if (ringOf[s1] !== ringOf[s2]) return false;
    const n = ringCount[ringOf[s1]];
    const d = Math.abs(idxInRing[s1] - idxInRing[s2]);
    return d <= 1 || d >= n - 1;
  };

  // Compact node ids.
  const nodeOf = new Int32Array(nt).fill(-1);
  const X: number[] = [],
    Y: number[] = [],
    R: number[] = [];
  const adj: number[][] = [];
  const node = (t: number) => {
    if (nodeOf[t] < 0) {
      nodeOf[t] = X.length;
      X.push(cx[t]);
      Y.push(cy[t]);
      R.push(cr[t]);
      adj.push([]);
    }
    return nodeOf[t];
  };
  for (let e = 0; e < halfedges.length; e++) {
    const o = halfedges[e];
    if (o < e) continue; // handles o === -1 too
    const t1 = (e / 3) | 0,
      t2 = (o / 3) | 0;
    if (!ok[t1] || !ok[t2]) continue;
    const s1 = triangles[e];
    const s2 = triangles[e % 3 === 2 ? e - 2 : e + 1];
    if (adjacentSites(s1, s2)) continue;
    const n1 = node(t1),
      n2 = node(t2);
    if (n1 !== n2) {
      adj[n1].push(n2);
      adj[n2].push(n1);
    }
  }
  const N = X.length;
  const sk: Skeleton = {
    x: Float64Array.from(X),
    y: Float64Array.from(Y),
    r: Float64Array.from(R),
    adj,
    alive: new Uint8Array(N).fill(1),
  };
  if (N === 0) return { ...empty, skeleton: sk };

  // Keep only the largest connected component (by total radius), drop tiny islands.
  {
    const comp = new Int32Array(N).fill(-1);
    let best = -1,
      bestW = -1,
      c = 0;
    for (let i = 0; i < N; i++) {
      if (comp[i] >= 0) continue;
      let w = 0;
      const stack = [i];
      comp[i] = c;
      while (stack.length) {
        const u = stack.pop()!;
        w += sk.r[u];
        for (const v of adj[u])
          if (comp[v] < 0) {
            comp[v] = c;
            stack.push(v);
          }
      }
      if (w > bestW) {
        bestW = w;
        best = c;
      }
      c++;
    }
    // Multi-polygon inputs legitimately have several components; only drop components much smaller.
    if (ps.length <= 1) for (let i = 0; i < N; i++) if (comp[i] !== best) sk.alive[i] = 0;
  }

  const deg = (i: number) => {
    let d = 0;
    for (const v of adj[i]) if (sk.alive[v]) d++;
    return d;
  };
  const dist = (a: number, b: number) => Math.hypot(sk.x[a] - sk.x[b], sk.y[a] - sk.y[b]);

  // Prune short spurs.
  const pruneFactor = opts.pruneFactor ?? 2.2;
  const pruneMin = opts.pruneMin ?? 0.3;
  for (let iter = 0; iter < 12; iter++) {
    let changed = false;
    for (let i = 0; i < N; i++) {
      if (!sk.alive[i] || deg(i) !== 1) continue;
      const chain = [i];
      let prev = -1,
        cur = i,
        len = 0;
      let endDeg: number;
      while (true) {
        let next = -1;
        for (const v of adj[cur])
          if (sk.alive[v] && v !== prev) {
            next = v;
            break;
          }
        if (next < 0) {
          endDeg = 0;
          break;
        }
        len += dist(cur, next);
        prev = cur;
        cur = next;
        const d = deg(cur);
        if (d !== 2) {
          endDeg = d;
          break;
        }
        chain.push(cur);
      }
      if (endDeg >= 3 && len < pruneFactor * sk.r[cur] + pruneMin) {
        for (const c of chain) sk.alive[c] = 0;
        changed = true;
      }
    }
    if (!changed) break;
  }

  let leaves = 0,
    junctions = 0,
    maxR = 0,
    start = -1;
  for (let i = 0; i < N; i++) {
    if (!sk.alive[i]) continue;
    const d = deg(i);
    if (d === 1) leaves++;
    if (d >= 3) junctions++;
    if (sk.r[i] > maxR) maxR = sk.r[i];
    if (start < 0) start = i;
  }

  // Diameter: farthest-from-farthest by Dijkstra on edge lengths.
  const farthest = (src: number) => {
    const d = new Float64Array(N).fill(Infinity);
    const prev = new Int32Array(N).fill(-1);
    d[src] = 0;
    // Simple binary-heap Dijkstra.
    const heap: [number, number][] = [[0, src]];
    const push = (item: [number, number]) => {
      heap.push(item);
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heap[p][0] <= heap[i][0]) break;
        [heap[p], heap[i]] = [heap[i], heap[p]];
        i = p;
      }
    };
    const pop = () => {
      const top = heap[0];
      const last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        while (true) {
          const l = i * 2 + 1,
            r = l + 1;
          let m = i;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]];
          i = m;
        }
      }
      return top;
    };
    while (heap.length) {
      const [du, u] = pop();
      if (du > d[u]) continue;
      for (const v of adj[u]) {
        if (!sk.alive[v]) continue;
        const nd = du + dist(u, v);
        if (nd < d[v]) {
          d[v] = nd;
          prev[v] = u;
          push([nd, v]);
        }
      }
    }
    let best = src;
    for (let i = 0; i < N; i++) if (sk.alive[i] && d[i] !== Infinity && d[i] > d[best]) best = i;
    return { best, d, prev };
  };
  let diameter: number[] = [];
  let diameterLength = 0;
  if (start >= 0) {
    const a = farthest(start).best;
    const fb = farthest(a);
    diameterLength = fb.d[fb.best];
    for (let v = fb.best; v >= 0; v = fb.prev[v]) diameter.push(v);
    diameter = diameter.reverse();
  }

  return {
    skeleton: sk,
    maxRadius: maxR,
    maxWidth: 2 * maxR,
    leaves,
    junctions,
    branches: Math.max(0, leaves - 2),
    diameter,
    diameterLength,
    holes,
  };
}
