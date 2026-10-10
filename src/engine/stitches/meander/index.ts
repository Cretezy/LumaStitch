// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Meander (stipple) fill: a random maze is grown over a grid of cells clipped to the shape
 * (seeded randomized depth-first search, so the result is deterministic), and the closed curve
 * that runs around the maze's walls is sewn. That curve visits every half-cell exactly once and
 * never crosses itself, giving an even, wandering line. Corners are smoothed (Chaikin) where the
 * smoothed line stays inside.
 */
import { offset } from '@/geom/clipper';
import { createPointTester, polyShapeBBox } from '@/geom/polygon';
import { rotateClosedTo } from '@/geom/polyline';
import type { Polyline } from '@/geom/types';
import type { InsideRouter } from '@/geom/visibility';
import type { StitchTypeDef } from '../../def';
import { num } from '../../params/types';
import { RunBuilder, dist, runningPoints } from '../common';
import { mulberry32, segmentInside } from '../p2util';
import { fillPolygon, makeRouter, travelTo } from '../tatami';

export interface MeanderPrep {
  /** One closed loop (first == last) per connected group of cells. */
  loops: Polyline[];
  stitchLength: number;
  travelLen: number;
  router: InsideRouter | null;
}

type SegTest = (ax: number, ay: number, bx: number, by: number) => boolean;

/**
 * Corner cutting on a closed loop: the first pass joins edge midpoints (round, octagonal turns),
 * later passes are Chaikin (¼ cuts). A corner is kept where the cut would leave the area.
 */
export function smoothLoop(loop: Polyline, iterations: number, ok: SegTest): Polyline {
  let cur = loop;
  for (let it = 0; it < iterations; it++) {
    const n = cur.length / 2 - 1; // distinct vertices
    if (n < 3) return cur;
    const r = it === 0 ? 0.5 : 0.25;
    const out: number[] = [];
    const add = (x: number, y: number) => {
      const k = out.length;
      if (k >= 2 && Math.abs(out[k - 2] - x) < 1e-9 && Math.abs(out[k - 1] - y) < 1e-9) return;
      out.push(x, y);
    };
    for (let i = 0; i < n; i++) {
      const p = (i - 1 + n) % n,
        q = (i + 1) % n;
      const ax = cur[p * 2],
        ay = cur[p * 2 + 1],
        bx = cur[i * 2],
        by = cur[i * 2 + 1],
        cx = cur[q * 2],
        cy = cur[q * 2 + 1];
      const ux = bx + (ax - bx) * r,
        uy = by + (ay - by) * r,
        vx = bx + (cx - bx) * r,
        vy = by + (cy - by) * r;
      add(ux, uy);
      if (!ok(ux, uy, vx, vy)) add(bx, by);
      add(vx, vy);
    }
    if (Math.abs(out[0] - out[out.length - 2]) < 1e-9 && Math.abs(out[1] - out[out.length - 1]) < 1e-9)
      out.length -= 2;
    out.push(out[0], out[1]);
    cur = Float64Array.from(out);
  }
  return cur;
}

/**
 * Maze loops over the cell grid. Cells are `cell` wide on a global grid; the loop runs through the
 * centres of the half-cells, so neighbouring lines are `cell / 2` apart.
 */
export function meanderLoops(
  inside: (x: number, y: number) => boolean,
  bbox: { minX: number; minY: number; maxX: number; maxY: number },
  cell: number,
  seed: number,
  origin: [number, number] = [0, 0],
): Polyline[] {
  const [ox, oy] = origin;
  const i0 = Math.floor((bbox.minX - ox) / cell),
    j0 = Math.floor((bbox.minY - oy) / cell);
  const nx = Math.floor((bbox.maxX - ox) / cell) - i0 + 1,
    ny = Math.floor((bbox.maxY - oy) / cell) - j0 + 1;
  if (nx <= 0 || ny <= 0 || nx * ny > 400000) return [];
  const q = cell / 4;
  // Sub-cell centre (a, b ∈ {0, 1}) of cell (i, j).
  const sx = (i: number, a: number) => ox + (i + i0) * cell + q + a * 2 * q;
  const sy = (j: number, b: number) => oy + (j + j0) * cell + q + b * 2 * q;
  const segOk: SegTest = (ax, ay, bx, by) => segmentInside(inside, ax, ay, bx, by, Math.min(0.2, q));
  const idx = (i: number, j: number) => j * nx + i;
  const ok = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const x0 = sx(i, 0),
        x1 = sx(i, 1),
        y0 = sy(j, 0),
        y1 = sy(j, 1);
      if (!inside(x0, y0) || !inside(x1, y0) || !inside(x0, y1) || !inside(x1, y1)) continue;
      if (segOk(x0, y0, x1, y0) && segOk(x1, y0, x1, y1) && segOk(x1, y1, x0, y1) && segOk(x0, y1, x0, y0))
        ok[idx(i, j)] = 1;
    }
  // Links between neighbouring cells: both connecting half-cell edges must stay inside.
  const right = new Uint8Array(nx * ny),
    down = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      if (!ok[idx(i, j)]) continue;
      if (i + 1 < nx && ok[idx(i + 1, j)])
        right[idx(i, j)] = +(
          segOk(sx(i, 1), sy(j, 0), sx(i + 1, 0), sy(j, 0)) &&
          segOk(sx(i, 1), sy(j, 1), sx(i + 1, 0), sy(j, 1))
        );
      if (j + 1 < ny && ok[idx(i, j + 1)])
        down[idx(i, j)] = +(
          segOk(sx(i, 0), sy(j, 1), sx(i, 0), sy(j + 1, 0)) &&
          segOk(sx(i, 1), sy(j, 1), sx(i, 1), sy(j + 1, 0))
        );
    }
  // Random spanning forest (randomized DFS), seeded.
  const rand = mulberry32(seed);
  const visited = new Uint8Array(nx * ny);
  const treeR = new Uint8Array(nx * ny),
    treeD = new Uint8Array(nx * ny);
  const roots: number[] = [];
  for (let start = 0; start < nx * ny; start++) {
    if (!ok[start] || visited[start]) continue;
    roots.push(start);
    visited[start] = 1;
    const stack = [start];
    while (stack.length) {
      const c = stack[stack.length - 1];
      const i = c % nx,
        j = (c - i) / nx;
      const nb: number[] = [];
      if (i + 1 < nx && right[c] && !visited[c + 1]) nb.push(c + 1);
      if (i > 0 && right[c - 1] && !visited[c - 1]) nb.push(c - 1);
      if (j + 1 < ny && down[c] && !visited[c + nx]) nb.push(c + nx);
      if (j > 0 && down[c - nx] && !visited[c - nx]) nb.push(c - nx);
      if (!nb.length) {
        stack.pop();
        continue;
      }
      const d = nb[Math.floor(rand() * nb.length)];
      if (d === c + 1) treeR[c] = 1;
      else if (d === c - 1) treeR[c - 1] = 1;
      else if (d === c + nx) treeD[c] = 1;
      else treeD[c - nx] = 1;
      visited[d] = 1;
      stack.push(d);
    }
  }
  // Half-cell graph: every half-cell gets exactly two links; walls go around the tree.
  const W = nx * 2;
  const sub = (i: number, j: number, a: number, b: number) => (j * 2 + b) * W + i * 2 + a;
  const links = new Int32Array(W * ny * 2 * 2).fill(-1);
  const link = (u: number, v: number) => {
    links[u * 2 + (links[u * 2] < 0 ? 0 : 1)] = v;
    links[v * 2 + (links[v * 2] < 0 ? 0 : 1)] = u;
  };
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const c = idx(i, j);
      if (!ok[c]) continue;
      if (treeR[c]) {
        link(sub(i, j, 1, 0), sub(i + 1, j, 0, 0));
        link(sub(i, j, 1, 1), sub(i + 1, j, 0, 1));
      } else link(sub(i, j, 1, 0), sub(i, j, 1, 1));
      if (treeD[c]) {
        link(sub(i, j, 0, 1), sub(i, j + 1, 0, 0));
        link(sub(i, j, 1, 1), sub(i, j + 1, 1, 0));
      } else link(sub(i, j, 0, 1), sub(i, j, 1, 1));
      if (!(i > 0 && treeR[c - 1])) link(sub(i, j, 0, 0), sub(i, j, 0, 1));
      if (!(j > 0 && treeD[c - nx])) link(sub(i, j, 0, 0), sub(i, j, 1, 0));
    }
  const loops: Polyline[] = [];
  for (const r of roots) {
    const i = r % nx,
      j = (r - i) / nx;
    const s0 = sub(i, j, 0, 0);
    const pts: number[] = [];
    let prev = -1,
      cur = s0;
    let guard = 0;
    do {
      const a = cur % W,
        bRow = (cur - a) / W;
      pts.push(sx(Math.floor(a / 2), a % 2), sy(Math.floor(bRow / 2), bRow % 2));
      const n0 = links[cur * 2],
        n1 = links[cur * 2 + 1];
      const next = n0 !== prev ? n0 : n1;
      prev = cur;
      cur = next;
    } while (cur !== s0 && cur >= 0 && guard++ < W * ny * 2 + 4);
    pts.push(pts[0], pts[1]);
    loops.push(Float64Array.from(pts));
  }
  return loops;
}

/**
 * Grid origin (one of 3 × 3 offsets of a third of a cell) that fits the most whole cells,
 * so narrow parts and the areas around holes are covered as well as possible.
 */
export function bestGridOrigin(
  inside: (x: number, y: number) => boolean,
  bbox: { minX: number; minY: number; maxX: number; maxY: number },
  cell: number,
): [number, number] {
  const q = cell / 4;
  let best: [number, number] = [0, 0],
    bestN = -1;
  for (let a = 0; a < 3; a++)
    for (let b = 0; b < 3; b++) {
      const ox = (a * cell) / 3,
        oy = (b * cell) / 3;
      let n = 0;
      for (let x = Math.floor((bbox.minX - ox) / cell) * cell + ox; x <= bbox.maxX; x += cell)
        for (let y = Math.floor((bbox.minY - oy) / cell) * cell + oy; y <= bbox.maxY; y += cell)
          if (
            inside(x + q, y + q) &&
            inside(x + 3 * q, y + q) &&
            inside(x + q, y + 3 * q) &&
            inside(x + 3 * q, y + 3 * q)
          )
            n++;
      if (n > bestN) {
        bestN = n;
        best = [ox, oy];
      }
    }
  return best;
}

export const meanderDef: StitchTypeDef<MeanderPrep> = {
  id: 'meander',
  label: 'Meander',
  description: 'A wandering, never-crossing stipple line that fills the shape. Light, quilted look.',
  role: 'fill',
  params: [
    {
      key: 'spacing',
      label: 'Line spacing',
      help: 'Distance between neighbouring meander lines.',
      kind: 'length',
      unit: 'mm',
      min: 0.5,
      max: 10,
      step: 0.1,
      group: 'basic',
    },
    {
      key: 'stitchLength',
      label: 'Stitch length',
      kind: 'length',
      unit: 'mm',
      min: 0.5,
      max: 6,
      step: 0.1,
      group: 'basic',
    },
    {
      key: 'smoothing',
      label: 'Smoothing',
      help: 'Rounds the turns of the meander (number of smoothing passes). 0 = square corners.',
      kind: 'number',
      min: 0,
      max: 4,
      step: 1,
      group: 'basic',
    },
    {
      key: 'seed',
      label: 'Random seed',
      help: 'Change to get a different meander. The same seed always gives the same stitches.',
      kind: 'number',
      min: 0,
      max: 9999,
      step: 1,
      group: 'basic',
    },
    {
      key: 'inset',
      label: 'Edge inset',
      help: 'Keeps the meander this far from the outline.',
      kind: 'length',
      unit: 'mm',
      min: 0,
      max: 3,
      step: 0.05,
      group: 'compensation',
    },
    {
      key: 'travelStitchLength',
      label: 'Travel stitch length',
      help: 'Stitch length for runs between separate parts of the shape.',
      kind: 'length',
      unit: 'mm',
      min: 1,
      max: 5,
      step: 0.1,
      group: 'advanced',
    },
  ],
  defaults: { spacing: 1.5, stitchLength: 2, smoothing: 2, seed: 1, inset: 0.3, travelStitchLength: 2 },
  appliesTo: (s) => s.hasClosed,
  prepare(geom, params, _el, ctx) {
    const base = fillPolygon(geom, params, ctx);
    const spacing = Math.max(0.3, num(params, 'spacing', 1.5));
    const L = Math.max(0.3, num(params, 'stitchLength', 2));
    const travelLen = Math.max(0.5, num(params, 'travelStitchLength', 2));
    const empty: MeanderPrep = { loops: [], stitchLength: L, travelLen, router: null };
    if (!base.length) return empty;
    const area = offset(base, -Math.max(0.05, num(params, 'inset', 0.3)));
    if (!area.length) return empty;
    const inside = createPointTester(area);
    const cell = spacing * 2;
    const seed = Math.round(num(params, 'seed', 1));
    const bb = polyShapeBBox(area);
    const raw = meanderLoops(inside, bb, cell, seed, bestGridOrigin(inside, bb, cell));
    if (!raw.length) {
      ctx.diag('meander-empty', 'The shape is too narrow for this meander spacing.');
      return empty;
    }
    const iters = Math.max(0, Math.min(4, Math.round(num(params, 'smoothing', 2))));
    const ok: SegTest = (ax, ay, bx, by) => segmentInside(inside, ax, ay, bx, by, 0.1);
    let travelArea = offset(base, -0.1);
    if (!travelArea.length) travelArea = base;
    return {
      loops: raw.map((l) => smoothLoop(l, iters, ok)),
      stitchLength: L,
      travelLen,
      router: makeRouter(travelArea),
    };
  },
  route(prep, hints) {
    const b = new RunBuilder();
    const t = { router: prep.router, travelLen: prep.travelLen };
    const remaining = prep.loops.slice();
    while (remaining.length) {
      const cur = b.last() ?? hints.entry;
      let bi = 0;
      if (cur) {
        let bd = Infinity;
        remaining.forEach((l, i) => {
          for (let k = 0; k < l.length; k += 2) {
            const d = dist(cur[0], cur[1], l[k], l[k + 1]);
            if (d < bd) {
              bd = d;
              bi = i;
            }
          }
        });
      }
      const loop = remaining.splice(bi, 1)[0];
      const rot = cur ? rotateClosedTo(loop, cur[0], cur[1]) : loop;
      const pts = runningPoints(rot, prep.stitchLength);
      travelTo(b, [pts[0], pts[1]], t);
      b.pushPolyline(pts, 0, true);
    }
    return b.build();
  },
};
