// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Cross-stitch fill: an X in every grid cell that belongs to the shape. Each horizontal run of
 * cells is sewn as a zigzag forward (one diagonal per cell, alternating) and completed by the
 * opposite zigzag on the way back, so the only connector is one vertical edge stitch per run.
 * Runs are joined by travel inside the stitched cells.
 */
import { offset, unionAll } from '@/geom/clipper';
import { createPointTester, polyShapeBBox } from '@/geom/polygon';
import type { PolyShape } from '@/geom/types';
import type { InsideRouter } from '@/geom/visibility';
import type { Vec2 } from '@/model/types';
import type { StitchTypeDef } from '../../def';
import { num, str } from '../../params/types';
import { RunBuilder, dist } from '../common';
import { segmentInside } from '../p2util';
import { fillPolygon, makeRouter, travelTo } from '../tatami';

export interface CrossRun {
  /** Row index (cells span y ∈ [row·cell, (row + 1)·cell]). */
  row: number;
  /** First and last column index (inclusive). */
  a: number;
  b: number;
}

export interface CrossStitchPrep {
  runs: CrossRun[];
  cell: number;
  passes: number;
  router: InsideRouter | null;
}

/** Cells of the global grid that are part of the shape. */
export function crossCells(base: PolyShape, cell: number, coverage: string): CrossRun[] {
  if (!base.length) return [];
  const centreIn = createPointTester(base);
  // Penetrations may sit slightly outside the outline (tolerance for cells along straight edges).
  const tolIn = createPointTester(offset(base, 0.2));
  const bb = polyShapeBBox(base);
  const i0 = Math.floor(bb.minX / cell),
    i1 = Math.floor(bb.maxX / cell);
  const j0 = Math.floor(bb.minY / cell),
    j1 = Math.floor(bb.maxY / cell);
  if ((i1 - i0 + 1) * (j1 - j0 + 1) > 250000) return [];
  const runs: CrossRun[] = [];
  const seg = (ax: number, ay: number, bx: number, by: number) => segmentInside(tolIn, ax, ay, bx, by, 0.2);
  for (let j = j0; j <= j1; j++) {
    let start: number | null = null;
    for (let i = i0; i <= i1 + 1; i++) {
      let take = false;
      if (i <= i1) {
        const x0 = i * cell,
          y0 = j * cell,
          x1 = x0 + cell,
          y1 = y0 + cell;
        take = centreIn(x0 + cell / 2, y0 + cell / 2);
        if (take && coverage !== 'centre')
          take =
            seg(x0, y0, x1, y1) &&
            seg(x1, y0, x0, y1) &&
            seg(x0, y0, x1, y0) &&
            seg(x1, y0, x1, y1) &&
            seg(x1, y1, x0, y1) &&
            seg(x0, y1, x0, y0);
      }
      if (take && start === null) start = i;
      else if (!take && start !== null) {
        runs.push({ row: j, a: start, b: i - 1 });
        start = null;
      }
    }
  }
  return runs;
}

/** Penetrations of one run starting at its left (or right) end: forward zigzag, then back. */
export function crossRunPoints(r: CrossRun, cell: number, fromRight: boolean, passes: number): number[] {
  const m = r.b - r.a + 1;
  const y0 = r.row * cell,
    y1 = y0 + cell;
  const xAt = (j: number) => (fromRight ? (r.b + 1 - j) * cell : (r.a + j) * cell);
  const out: number[] = [];
  for (let p = 0; p < passes; p++) {
    for (let j = 0; j <= m; j++) out.push(xAt(j), j % 2 === 0 ? y1 : y0);
    for (let j = m; j >= 0; j--) out.push(xAt(j), j % 2 === 0 ? y0 : y1);
  }
  return out;
}

export const crossStitchDef: StitchTypeDef<CrossStitchPrep> = {
  id: 'crossStitch',
  label: 'Cross stitch',
  description: 'Rows of X stitches on a square grid, like hand cross-stitch. For pixel-art looks.',
  role: 'fill',
  params: [
    {
      key: 'cellSize',
      label: 'Cell size',
      help: 'Width and height of one cross.',
      kind: 'length',
      unit: 'mm',
      min: 1,
      max: 8,
      step: 0.1,
      group: 'basic',
    },
    {
      key: 'coverage',
      label: 'Cells',
      help: 'Inside: only cells that fit in the shape (stitches never leave the outline). Centre: every cell whose centre is in the shape (truer to the artwork, but crosses can overhang the edge by half a cell).',
      kind: 'enum',
      options: [
        { value: 'inside', label: 'Inside the shape' },
        { value: 'centre', label: 'Centre in the shape' },
      ],
      group: 'basic',
    },
    {
      key: 'passes',
      label: 'Passes',
      help: 'How many times each cross is sewn. 2 gives a bolder cross.',
      kind: 'number',
      min: 1,
      max: 3,
      step: 1,
      group: 'advanced',
    },
  ],
  defaults: { cellSize: 2.5, coverage: 'inside', passes: 1 },
  appliesTo: (s) => s.hasClosed,
  prepare(geom, params, _el, ctx) {
    const base = fillPolygon(geom, params, ctx);
    const cell = Math.max(0.5, num(params, 'cellSize', 2.5));
    const runs = crossCells(base, cell, str(params, 'coverage', 'inside'));
    const passes = Math.max(1, Math.min(3, Math.round(num(params, 'passes', 1))));
    if (base.length && !runs.length)
      ctx.diag('cross-empty', 'The shape is smaller than one cross-stitch cell.');
    // Travel stays within the stitched cells (slightly grown so cell corners are inside).
    const squares: PolyShape[] = runs.map((r) => [
      {
        outer: Float64Array.from([
          r.a * cell,
          r.row * cell,
          (r.b + 1) * cell,
          r.row * cell,
          (r.b + 1) * cell,
          (r.row + 1) * cell,
          r.a * cell,
          (r.row + 1) * cell,
        ]),
        holes: [],
      },
    ]);
    const area = runs.length ? offset(unionAll(squares), 0.05, 'miter') : [];
    return { runs, cell, passes, router: area.length ? makeRouter(area) : null };
  },
  route(prep, hints) {
    const b = new RunBuilder();
    const t = { router: prep.router, travelLen: prep.cell * 1.5 };
    const c = prep.cell;
    const done = new Uint8Array(prep.runs.length);
    const startOf = (r: CrossRun, right: boolean): Vec2 => [(right ? r.b + 1 : r.a) * c, (r.row + 1) * c];
    for (let n = 0; n < prep.runs.length; n++) {
      const cur = b.last() ?? hints.entry;
      let bi = -1,
        bRight = false,
        bd = Infinity;
      for (let i = 0; i < prep.runs.length; i++) {
        if (done[i]) continue;
        if (!cur) {
          bi = i;
          break;
        }
        for (const right of [false, true]) {
          const s = startOf(prep.runs[i], right);
          const d = dist(s[0], s[1], cur[0], cur[1]);
          if (d < bd - 1e-9) {
            bd = d;
            bi = i;
            bRight = right;
          }
        }
      }
      done[bi] = 1;
      const pts = crossRunPoints(prep.runs[bi], c, bRight, prep.passes);
      travelTo(b, [pts[0], pts[1]], t);
      for (let k = 2; k < pts.length; k += 2) b.push(pts[k], pts[k + 1]);
    }
    return b.build();
  },
};
