// SPDX-License-Identifier: GPL-3.0-or-later
/** Intersection-aware running-stitch routing: open Chinese postman on each connected component. */
import type { Vec2 } from '@/model/types';
import type { PathItem } from './index';

interface Edge {
  a: number;
  b: number;
  length: number;
}
export interface RunningNetwork {
  points: Vec2[];
  edges: Edge[];
  adjacent: number[][];
  components: number[][];
}
export interface NetworkStep {
  from: Vec2;
  to: Vec2;
  underpath: boolean;
  jump: boolean;
}
const EPS = 1e-7;

/** Preserve overlapping strokes as parallel edges: an intentional repeated line is still sewn. */
export function buildRunningNetwork(paths: PathItem[]): RunningNetwork | null {
  const segments: { a: Vec2; b: Vec2; cuts: number[] }[] = [];
  for (const { pts, closed } of paths) {
    const end = closed ? pts.length : pts.length - 2;
    for (let i = 0; i < end; i += 2) {
      const j = (i + 2) % pts.length;
      const a: Vec2 = [pts[i], pts[i + 1]],
        b: Vec2 = [pts[j], pts[j + 1]];
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) > EPS) segments.push({ a, b, cuts: [0, 1] });
    }
  }
  // Bound intersection work; oversized drawings keep the normal path router.
  if (!segments.length || segments.length > 1000) return null;
  const cross = (a: Vec2, b: Vec2) => a[0] * b[1] - a[1] * b[0];
  const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
  const cut = (list: number[], t: number) => {
    if (t > EPS && t < 1 - EPS) list.push(t);
  };
  for (let i = 0; i < segments.length; i++)
    for (let j = i + 1; j < segments.length; j++) {
      const a = segments[i],
        b = segments[j];
      const u = sub(a.b, a.a),
        v = sub(b.b, b.a),
        w = sub(b.a, a.a);
      const determinant = cross(u, v);
      if (Math.abs(determinant) > EPS) {
        const t = cross(w, v) / determinant,
          s = cross(w, u) / determinant;
        if (t >= -EPS && t <= 1 + EPS && s >= -EPS && s <= 1 + EPS) {
          cut(a.cuts, t);
          cut(b.cuts, s);
        }
      } else if (Math.abs(cross(w, u)) < EPS) {
        const project = (p: Vec2, origin: Vec2, d: Vec2) =>
          ((p[0] - origin[0]) * d[0] + (p[1] - origin[1]) * d[1]) / (d[0] ** 2 + d[1] ** 2);
        cut(a.cuts, project(b.a, a.a, u));
        cut(a.cuts, project(b.b, a.a, u));
        cut(b.cuts, project(a.a, b.a, v));
        cut(b.cuts, project(a.b, b.a, v));
      }
    }
  const points: Vec2[] = [],
    edges: Edge[] = [],
    adjacent: number[][] = [];
  const ids = new Map<string, number>();
  const node = (p: Vec2) => {
    const key = `${Math.round(p[0] / EPS)},${Math.round(p[1] / EPS)}`;
    let id = ids.get(key);
    if (id === undefined) {
      id = points.length;
      points.push(p);
      adjacent.push([]);
      ids.set(key, id);
    }
    return id;
  };
  for (const s of segments) {
    const cuts = [...new Set(s.cuts)].sort((a, b) => a - b);
    const at = (t: number): Vec2 => [s.a[0] + t * (s.b[0] - s.a[0]), s.a[1] + t * (s.b[1] - s.a[1])];
    for (let i = 1; i < cuts.length; i++) {
      const a = node(at(cuts[i - 1])),
        b = node(at(cuts[i]));
      if (a === b) continue;
      if (points.length > 1000 || edges.length >= 3000) return null;
      const id = edges.length;
      edges.push({ a, b, length: Math.hypot(points[a][0] - points[b][0], points[a][1] - points[b][1]) });
      adjacent[a].push(id);
      adjacent[b].push(id);
    }
  }
  if (points.length > 1000 || edges.length > 3000) return null;
  const components: number[][] = [],
    seen = new Uint8Array(points.length);
  for (let root = 0; root < points.length; root++) {
    if (seen[root] || !adjacent[root].length) continue;
    const component = [root];
    seen[root] = 1;
    for (let i = 0; i < component.length; i++)
      for (const ei of adjacent[component[i]]) {
        const edge = edges[ei],
          other = edge.a === component[i] ? edge.b : edge.a;
        if (!seen[other]) {
          seen[other] = 1;
          component.push(other);
        }
      }
    components.push(component);
  }
  return { points, edges, adjacent, components };
}

function shortest(g: RunningNetwork, nodes: number[], start: number) {
  const distance = new Float64Array(g.points.length).fill(Infinity);
  const previous = new Int32Array(g.points.length).fill(-1);
  const done = new Uint8Array(g.points.length);
  distance[start] = 0;
  for (let k = 0; k < nodes.length; k++) {
    let u = -1;
    for (const node of nodes) if (!done[node] && (u < 0 || distance[node] < distance[u])) u = node;
    if (u < 0 || !Number.isFinite(distance[u])) break;
    done[u] = 1;
    for (const ei of g.adjacent[u]) {
      const e = g.edges[ei],
        v = e.a === u ? e.b : e.a;
      const d = distance[u] + e.length;
      if (d < distance[v] - EPS) {
        distance[v] = d;
        previous[v] = ei;
      }
    }
  }
  return { distance, previous };
}

/** Minimum-weight perfect matching for <=16 parity defects, nearest-pair + swaps beyond. */
function pairs(distance: (a: number, b: number) => number, count: number): [number, number][] {
  if (count <= 16) {
    const full = (1 << count) - 1;
    const memo = new Float64Array(full + 1).fill(NaN),
      choice = new Int8Array(full + 1).fill(-1);
    memo[0] = 0;
    const solve = (mask: number): number => {
      if (!Number.isNaN(memo[mask])) return memo[mask];
      const i = 31 - Math.clz32(mask & -mask);
      let best = Infinity;
      for (let j = i + 1; j < count; j++)
        if (mask & (1 << j)) {
          const d = distance(i, j) + solve(mask ^ (1 << i) ^ (1 << j));
          if (d < best) {
            best = d;
            choice[mask] = j;
          }
        }
      return (memo[mask] = best);
    };
    solve(full);
    const result: [number, number][] = [];
    for (let mask = full; mask;) {
      const i = 31 - Math.clz32(mask & -mask),
        j = choice[mask];
      result.push([i, j]);
      mask ^= (1 << i) | (1 << j);
    }
    return result;
  }
  const used = new Uint8Array(count),
    result: [number, number][] = [];
  for (let i = 0; i < count; i++) {
    if (used[i]) continue;
    let best = -1;
    for (let j = i + 1; j < count; j++)
      if (!used[j] && (best < 0 || distance(i, j) < distance(i, best))) best = j;
    used[i] = used[best] = 1;
    result.push([i, best]);
  }
  for (let pass = 0; pass < 4; pass++)
    for (let i = 0; i < result.length; i++)
      for (let j = i + 1; j < result.length; j++) {
        const [a, b] = result[i],
          [c, d] = result[j],
          before = distance(a, b) + distance(c, d);
        if (distance(a, c) + distance(b, d) < before - EPS) {
          result[i] = [a, c];
          result[j] = [b, d];
        } else if (distance(a, d) + distance(b, c) < before - EPS) {
          result[i] = [a, d];
          result[j] = [b, c];
        }
      }
  return result;
}

/** One Euler walk per component: no jump can occur inside a connected network. */
export function routeRunningNetwork(g: RunningNetwork, entry?: Vec2, exit?: Vec2): NetworkStep[] {
  const { points, edges, adjacent } = g;
  const distance = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const nearest = (nodes: number[], p: Vec2 | undefined, right = false) =>
    nodes.reduce((a, b) => {
      const da = p ? distance(points[a], p) : (right ? -1 : 1) * points[a][0];
      const db = p ? distance(points[b], p) : (right ? -1 : 1) * points[b][0];
      return db < da ? b : a;
    });
  const remaining = g.components.slice(),
    result: NetworkStep[] = [];
  let position = entry;
  while (remaining.length) {
    let ci = 0;
    if (position)
      for (let i = 1; i < remaining.length; i++)
        if (
          distance(points[nearest(remaining[i], position)], position) <
          distance(points[nearest(remaining[ci], position)], position)
        )
          ci = i;
    const nodes = remaining.splice(ci, 1)[0];
    const start = nearest(nodes, position);
    const endTarget = remaining.length ? points[nearest(remaining.flat(), points[start])] : exit;
    const end = nearest(nodes, endTarget, true);
    const defects = nodes.filter((v) => ((adjacent[v].length % 2) ^ +(v === start) ^ +(v === end)) !== 0);
    const paths = defects.map((v) => shortest(g, nodes, v));
    const extra: number[] = [];
    for (const [a, b] of pairs((i, j) => paths[i].distance[defects[j]], defects.length)) {
      for (let v = defects[b]; v !== defects[a];) {
        const ei = paths[a].previous[v];
        extra.push(ei);
        v = edges[ei].a === v ? edges[ei].b : edges[ei].a;
      }
    }
    const originals = new Set(nodes.flatMap((v) => adjacent[v]));
    const copies = [...originals, ...extra];
    const lists = new Map(nodes.map((v) => [v, [] as number[]]));
    copies.forEach((ei, k) => {
      lists.get(edges[ei].a)!.push(k);
      lists.get(edges[ei].b)!.push(k);
    });
    const used = new Uint8Array(copies.length);
    const stack: { node: number; edge: number }[] = [{ node: start, edge: -1 }];
    const reverse: { node: number; edge: number }[] = [];
    while (stack.length) {
      const current = stack[stack.length - 1];
      const list = lists.get(current.node)!;
      while (list.length && used[list[list.length - 1]]) list.pop();
      const k = list.pop();
      if (k === undefined) reverse.push(stack.pop()!);
      else {
        used[k] = 1;
        const e = edges[copies[k]];
        stack.push({ node: e.a === current.node ? e.b : e.a, edge: copies[k] });
      }
    }
    reverse.reverse();
    const lastUse = new Map<number, number>();
    reverse.forEach((s, k) => lastUse.set(s.edge, k));
    for (let k = 1; k < reverse.length; k++)
      result.push({
        from: points[reverse[k - 1].node],
        to: points[reverse[k].node],
        underpath: lastUse.get(reverse[k].edge) !== k,
        jump: k === 1 && result.length > 0,
      });
    position = points[end];
  }
  return result;
}
