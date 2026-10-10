// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Shortest paths that stay inside a polygon: a lazily-built visibility graph over the polygon's
 * reflex vertices (Douglas–Peucker simplified), searched with A*.
 */
import { createPointTester, polyShapeBBox, signedArea } from './polygon';
import { simplifyRing } from './polyline';
import type { PolyShape, Ring } from './types';

const NUDGE = 0.05;

function orient(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

export class InsideRouter {
  private edges: Float64Array;
  private grid = new Map<number, number[]>();
  private cell: number;
  private minX: number;
  private minY: number;
  private inside: (x: number, y: number) => boolean;
  private nodes: number[] = [];
  /** Node-to-node visibility, filled lazily across queries: 0 unknown, 1 clear, 2 blocked. */
  private vis: Uint8Array | null = null;
  readonly ok: boolean;

  constructor(area: PolyShape, simplifyTol = 0.3, maxNodes = 600) {
    const rings: Ring[] = [];
    const isHole: boolean[] = [];
    // Everything (edges, nodes and the inside test) uses the same simplified rings. Testing against
    // the exact polygon while nodes sit near the simplified one rejected most paths along curves.
    const simple: PolyShape = area.map((p) => ({
      outer: simplifyRing(p.outer, simplifyTol),
      holes: p.holes.map((h) => simplifyRing(h, simplifyTol)),
    }));
    for (const p of simple) {
      rings.push(p.outer);
      isHole.push(false);
      for (const h of p.holes) {
        rings.push(h);
        isHole.push(true);
      }
    }
    const e: number[] = [];
    for (const r of rings) {
      const n = r.length;
      for (let i = 0, j = n - 2; i < n; j = i, i += 2) e.push(r[j], r[j + 1], r[i], r[i + 1]);
    }
    this.edges = Float64Array.from(e);
    const b = polyShapeBBox(area);
    this.minX = b.minX;
    this.minY = b.minY;
    const span = Math.max(b.maxX - b.minX, b.maxY - b.minY, 1);
    this.cell = Math.max(1, span / 64);
    for (let k = 0; k < this.edges.length; k += 4) {
      const x0 = Math.min(this.edges[k], this.edges[k + 2]),
        x1 = Math.max(this.edges[k], this.edges[k + 2]);
      const y0 = Math.min(this.edges[k + 1], this.edges[k + 3]),
        y1 = Math.max(this.edges[k + 1], this.edges[k + 3]);
      const cx0 = this.cx(x0),
        cx1 = this.cx(x1),
        cy0 = this.cy(y0),
        cy1 = this.cy(y1);
      for (let cx = cx0; cx <= cx1; cx++)
        for (let cy = cy0; cy <= cy1; cy++) {
          const key = cx * 100003 + cy;
          let l = this.grid.get(key);
          if (!l) this.grid.set(key, (l = []));
          l.push(k);
        }
    }
    this.inside = createPointTester(simple);
    // Reflex vertices (relative to the interior), nudged slightly inward.
    rings.forEach((r, ri) => {
      const n = r.length / 2;
      // The domain lies to the left of an outer ring with positive area, and to the left of a hole
      // ring with negative area; flip when a ring comes in the other orientation.
      const interiorLeft = isHole[ri] ? signedArea(r) < 0 : signedArea(r) > 0;
      for (let i = 0; i < n; i++) {
        const pi = ((i - 1 + n) % n) * 2,
          ci = i * 2,
          ni = ((i + 1) % n) * 2;
        const o = orient(r[pi], r[pi + 1], r[ci], r[ci + 1], r[ni], r[ni + 1]);
        // With the interior on the left, a right turn (o < 0) is a reflex corner.
        const reflex = interiorLeft ? o < 0 : o > 0;
        if (!reflex) continue;
        // Inward bisector.
        const ax = r[pi] - r[ci],
          ay = r[pi + 1] - r[ci + 1],
          bx = r[ni] - r[ci],
          by = r[ni + 1] - r[ci + 1];
        const la = Math.hypot(ax, ay) || 1,
          lb = Math.hypot(bx, by) || 1;
        let dx = ax / la + bx / lb,
          dy = ay / la + by / lb;
        const l = Math.hypot(dx, dy);
        if (l < 1e-9) continue;
        dx /= l;
        dy /= l;
        // At a reflex vertex the bisector of the two edges points outside; flip it.
        let x = r[ci] - dx * NUDGE,
          y = r[ci + 1] - dy * NUDGE;
        if (!this.inside(x, y)) {
          x = r[ci] + dx * NUDGE;
          y = r[ci + 1] + dy * NUDGE;
          if (!this.inside(x, y)) continue;
        }
        this.nodes.push(x, y);
      }
    });
    this.ok = this.nodes.length / 2 <= maxNodes;
  }

  private cx(x: number) {
    return Math.floor((x - this.minX) / this.cell);
  }
  private cy(y: number) {
    return Math.floor((y - this.minY) / this.cell);
  }

  /** True if the segment does not cross the boundary and its midpoint is inside. */
  clear(ax: number, ay: number, bx: number, by: number): boolean {
    if (!this.inside((ax + bx) / 2, (ay + by) / 2)) return false;
    const cx0 = this.cx(Math.min(ax, bx)),
      cx1 = this.cx(Math.max(ax, bx));
    const cy0 = this.cy(Math.min(ay, by)),
      cy1 = this.cy(Math.max(ay, by));
    const seen = new Set<number>();
    const E = this.edges;
    for (let cx = cx0; cx <= cx1; cx++)
      for (let cy = cy0; cy <= cy1; cy++) {
        const l = this.grid.get(cx * 100003 + cy);
        if (!l) continue;
        for (const k of l) {
          if (seen.has(k)) continue;
          seen.add(k);
          const o1 = orient(ax, ay, bx, by, E[k], E[k + 1]);
          const o2 = orient(ax, ay, bx, by, E[k + 2], E[k + 3]);
          if ((o1 > 0 && o2 > 0) || (o1 < 0 && o2 < 0)) continue;
          const o3 = orient(E[k], E[k + 1], E[k + 2], E[k + 3], ax, ay);
          const o4 = orient(E[k], E[k + 1], E[k + 2], E[k + 3], bx, by);
          if ((o3 > 0 && o4 > 0) || (o3 < 0 && o4 < 0)) continue;
          if (o1 === 0 && o2 === 0) continue; // collinear touching: ignore
          return false;
        }
      }
    return true;
  }

  isInside(x: number, y: number): boolean {
    return this.inside(x, y);
  }

  /** Returns (x, y) if inside, else the nearest boundary point nudged slightly inside (or null). */
  snapInside(x: number, y: number): [number, number] | null {
    if (this.inside(x, y)) return [x, y];
    const E = this.edges;
    let best = Infinity,
      bx = 0,
      by = 0,
      nx = 0,
      ny = 0;
    for (let k = 0; k < E.length; k += 4) {
      const ax = E[k],
        ay = E[k + 1],
        ex = E[k + 2] - ax,
        ey = E[k + 3] - ay;
      const l2 = ex * ex + ey * ey;
      let t = l2 > 0 ? ((x - ax) * ex + (y - ay) * ey) / l2 : 0;
      t = Math.max(0, Math.min(1, t));
      const px = ax + ex * t,
        py = ay + ey * t;
      const d = (px - x) * (px - x) + (py - y) * (py - y);
      if (d < best) {
        best = d;
        bx = px;
        by = py;
        const l = Math.sqrt(l2) || 1;
        nx = -ey / l;
        ny = ex / l;
      }
    }
    const dl = Math.sqrt(best);
    if (dl > 1e-9) {
      const dx = (bx - x) / dl,
        dy = (by - y) / dl;
      for (const m of [1, 3, 8]) {
        const cx = bx + dx * NUDGE * m,
          cy = by + dy * NUDGE * m;
        if (this.inside(cx, cy)) return [cx, cy];
      }
    }
    for (const sgn of [1, -1]) {
      for (const m of [1, 3, 8]) {
        const cx = bx + sgn * nx * NUDGE * m,
          cy = by + sgn * ny * NUDGE * m;
        if (this.inside(cx, cy)) return [cx, cy];
      }
    }
    return null;
  }

  /**
   * Shortest inside path from a to b as interleaved points (including both ends),
   * or null if none was found. Endpoints should be inside (or within NUDGE of the boundary).
   */
  path(ax: number, ay: number, bx: number, by: number): Float64Array | null {
    if (this.clear(ax, ay, bx, by)) return Float64Array.from([ax, ay, bx, by]);
    if (!this.ok) return null;
    const N = this.nodes.length / 2;
    // Node indexes: 0..N-1 = reflex vertices, N = start, N+1 = goal.
    const X = (i: number) => (i < N ? this.nodes[i * 2] : i === N ? ax : bx);
    const Y = (i: number) => (i < N ? this.nodes[i * 2 + 1] : i === N ? ay : by);
    const total = N + 2;
    const g = new Float64Array(total).fill(Infinity);
    const prev = new Int32Array(total).fill(-1);
    const closed = new Uint8Array(total);
    const h = (i: number) => Math.hypot(X(i) - bx, Y(i) - by);
    g[N] = 0;
    const open: number[] = [N];
    const f = new Float64Array(total).fill(Infinity);
    f[N] = h(N);
    let iterations = 0;
    while (open.length && iterations++ < 5000) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (f[open[i]] < f[open[bi]]) bi = i;
      const u = open.splice(bi, 1)[0];
      if (u === N + 1) break;
      if (closed[u]) continue;
      closed[u] = 1;
      const ux = X(u),
        uy = Y(u);
      for (let v = 0; v < total; v++) {
        if (v === u || closed[v] || v === N) continue;
        const vx = X(v),
          vy = Y(v);
        const nd = g[u] + Math.hypot(vx - ux, vy - uy);
        if (nd >= g[v]) continue;
        if (u < N && v < N) {
          const vis = (this.vis ??= new Uint8Array(N * N));
          const k = u < v ? u * N + v : v * N + u;
          if (!vis[k]) vis[k] = this.clear(ux, uy, vx, vy) ? 1 : 2;
          if (vis[k] === 2) continue;
        } else if (!this.clear(ux, uy, vx, vy)) continue;
        g[v] = nd;
        prev[v] = u;
        f[v] = nd + h(v);
        open.push(v);
      }
    }
    if (g[N + 1] === Infinity) return null;
    const out: number[] = [];
    for (let v = N + 1; v >= 0; v = prev[v]) {
      out.push(Y(v), X(v));
      if (v === N) break;
    }
    out.reverse();
    return Float64Array.from(out);
  }
}
