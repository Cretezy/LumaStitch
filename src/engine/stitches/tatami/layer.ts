// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Fill layers: scanline rows grouped into sections that can each be sewn back and forth in one pass,
 * with penetrations on a global grid so adjacent fills with the same angle line up.
 */
import { apply, rotationFor } from '@/geom/matrix';
import { intervalsAt, scanRows, type ScanRow } from '@/geom/scanline';
import { offset as clipOffset } from '@/geom/clipper';
import { createPointTester, polyShapeBBox, transformPolyShape } from '@/geom/polygon';
import type { PolyShape, Ring } from '@/geom/types';
import type { Matrix, Vec2 } from '@/model/types';

export interface SectionRow {
  k: number;
  y: number;
  x0: number;
  x1: number;
}

export interface Section {
  rows: SectionRow[];
}

export interface FillLayer {
  sections: Section[];
  /** Point-in-layer test (with a small tolerance) for checking row-to-row turns. */
  inside: (x: number, y: number) => boolean;
  /** The layer's polygon (doc mm), for walking turns along its outline. */
  poly?: PolyShape;
  /**
   * Looser point-in-layer test (0.15 mm) for row-to-row turns: a turn that brushes the outline is
   * invisible, while detouring around it leaves a mark.
   */
  near?: (x: number, y: number) => boolean;
  toDoc: Matrix;
  angle: number;
  spacing: number;
  stitchLength: number;
  offset: number;
  /** Maps a point of the row frame to the document (default: the `toDoc` rotation). */
  map?: (x: number, y: number) => Vec2;
  /** Penetration phase of row k as a fraction of the stitch length (default: frac(k · offset)). */
  phase?: (k: number) => number;
  /** Extra penetrations so no step along a row exceeds this (row-frame x; 0/undefined = none). */
  maxStep?: number;
}

/** Links each row interval to the overlapping interval in the next row while the link is 1:1. */
export function buildSections(
  ps: PolyShape,
  angle: number,
  spacing: number,
): { sections: Section[]; toDoc: Matrix } {
  const scan = scanRows(ps, angle, spacing);
  return { sections: sectionsFromRows(scan.rows), toDoc: scan.toDoc };
}

/** Section decomposition of scan rows (rows with consecutive k are candidates for linking). */
export function sectionsFromRows(scanRowsList: ScanRow[]): Section[] {
  const sections: Section[] = [];
  // Open sections keyed by interval index in the previous row.
  let prevRow: { k: number; intervals: [number, number][]; owner: number[] } | null = null;
  for (const row of scanRowsList) {
    const owner: number[] = new Array(row.intervals.length).fill(-1);
    if (prevRow && prevRow.k === row.k - 1) {
      const overlaps = (a: [number, number], b: [number, number]) => a[0] < b[1] && b[0] < a[1];
      for (let i = 0; i < row.intervals.length; i++) {
        const cur = row.intervals[i];
        const ups: number[] = [];
        for (let j = 0; j < prevRow.intervals.length; j++)
          if (overlaps(prevRow.intervals[j], cur)) ups.push(j);
        if (ups.length !== 1) continue;
        const j = ups[0];
        let downs = 0;
        for (let m = 0; m < row.intervals.length; m++)
          if (overlaps(prevRow.intervals[j], row.intervals[m])) downs++;
        if (downs !== 1) continue;
        owner[i] = prevRow.owner[j];
      }
    }
    for (let i = 0; i < row.intervals.length; i++) {
      if (owner[i] < 0) {
        owner[i] = sections.length;
        sections.push({ rows: [] });
      }
      sections[owner[i]].rows.push({ k: row.k, y: row.y, x0: row.intervals[i][0], x1: row.intervals[i][1] });
    }
    prevRow = { k: row.k, intervals: row.intervals, owner };
  }
  return sections;
}

export function buildLayer(
  ps: PolyShape,
  angle: number,
  spacing: number,
  stitchLength: number,
  offset: number,
): FillLayer {
  const { sections, toDoc } = buildSections(ps, angle, spacing);
  return {
    sections,
    toDoc,
    angle,
    spacing,
    stitchLength,
    offset,
    inside: createPointTester(clipOffset(ps, 0.05)),
    near: createPointTester(clipOffset(ps, 0.15)),
    poly: ps,
  };
}

export interface CustomLayerOpts {
  /** Row positions (row frame) given the polygon's y extent there. Default: the global grid. */
  rowYs?: (minY: number, maxY: number) => number[];
  phase?: (k: number) => number;
  /** Rows follow y + amp · sin(2πx / period) in the row frame. */
  wave?: { amp: number; period: number };
}

/** Densifies a ring so no edge is longer than `step`, then shifts y by −w(x). */
function warpRing(r: Ring, step: number, w: (x: number) => number): Ring {
  const out: number[] = [];
  const n = r.length;
  for (let i = 0; i < n; i += 2) {
    const j = (i + 2) % n;
    const x0 = r[i],
      y0 = r[i + 1],
      x1 = r[j],
      y1 = r[j + 1];
    const m = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step));
    for (let k = 0; k < m; k++) {
      const x = x0 + ((x1 - x0) * k) / m,
        y = y0 + ((y1 - y0) * k) / m;
      out.push(x, y - w(x));
    }
  }
  return Float64Array.from(out);
}

/**
 * A fill layer with custom row positions (gradient fills), a custom per-row penetration phase
 * (pattern fills) and/or wavy rows. Rows are found in the (optionally warped) row frame, so the
 * section and routing machinery is shared with tatami unchanged.
 */
export function buildCustomLayer(
  ps: PolyShape,
  angle: number,
  spacing: number,
  stitchLength: number,
  offset: number,
  o: CustomLayerOpts,
): FillLayer {
  const toRot = rotationFor(-angle);
  const toDoc = rotationFor(angle);
  let rot = transformPolyShape(ps, toRot);
  const wave = o.wave && o.wave.amp > 0 && o.wave.period > 0 ? o.wave : null;
  const w = (x: number) => (wave ? wave.amp * Math.sin((2 * Math.PI * x) / wave.period) : 0);
  if (wave) {
    const step = Math.max(0.05, wave.period / 24);
    rot = rot.map((p) => ({
      outer: warpRing(p.outer, step, w),
      holes: p.holes.map((h) => warpRing(h, step, w)),
    }));
  }
  const b = polyShapeBBox(rot);
  const rows: ScanRow[] = [];
  if (b.maxY > b.minY && spacing > 0) {
    if (o.rowYs) {
      o.rowYs(b.minY, b.maxY).forEach((y, k) => {
        const intervals = intervalsAt(rot, y);
        if (intervals.length) rows.push({ k, y, intervals });
      });
    } else {
      const k0 = Math.ceil(b.minY / spacing - 0.5);
      const k1 = Math.floor(b.maxY / spacing - 0.5);
      for (let k = k0; k <= k1; k++) {
        const y = (k + 0.5) * spacing;
        const intervals = intervalsAt(rot, y);
        if (intervals.length) rows.push({ k, y, intervals });
      }
    }
  }
  return {
    sections: sectionsFromRows(rows),
    toDoc,
    angle,
    spacing,
    stitchLength,
    offset,
    inside: createPointTester(clipOffset(ps, 0.05)),
    near: createPointTester(clipOffset(ps, 0.15)),
    poly: ps,
    map: wave ? (x, y) => apply(toDoc, [x, y + w(x)]) : undefined,
    phase: o.phase,
    maxStep: wave ? Math.max(0.5, wave.period / 8) : undefined,
  };
}

export function toDocPoint(layer: FillLayer, x: number, y: number): Vec2 {
  return layer.map ? layer.map(x, y) : apply(layer.toDoc, [x, y]);
}

/** Corner c: 0 = first row left, 1 = first row right, 2 = last row left, 3 = last row right. */
export function sectionCorner(layer: FillLayer, s: Section, c: number): Vec2 {
  const row = c < 2 ? s.rows[0] : s.rows[s.rows.length - 1];
  const x = c % 2 === 0 ? row.x0 : row.x1;
  return toDocPoint(layer, x, row.y);
}

/** Exit corner after sewing a section starting at corner c. */
export function exitCorner(s: Section, c: number): number {
  const n = s.rows.length;
  const startTop = c < 2;
  const startRight = c % 2 === 1;
  // Row i runs from side s_i to the opposite side; s_i alternates.
  const lastStartRight = (n - 1) % 2 === 0 ? startRight : !startRight;
  const endRight = !lastStartRight;
  const endTop = !startTop;
  return (endTop ? 0 : 2) + (endRight ? 1 : 0);
}

function frac(v: number): number {
  return ((v % 1) + 1) % 1;
}

/** Penetrations (document frame) for one section starting at corner c, one array per row. */
export function sewSection(layer: FillLayer, s: Section, c: number, minEnd: number): number[][] {
  const out: number[][] = [];
  const rows = c < 2 ? s.rows : s.rows.slice().reverse();
  let right = c % 2 === 1;
  const L = layer.stitchLength;
  const m = layer.toDoc;
  for (const row of rows) {
    const xs: number[] = [];
    const ph = layer.phase ? frac(layer.phase(row.k)) : frac(row.k * layer.offset);
    const j0 = Math.ceil(row.x0 / L - ph);
    const j1 = Math.floor(row.x1 / L - ph);
    for (let j = j0; j <= j1; j++) {
      const x = (j + ph) * L;
      if (x - row.x0 >= minEnd && row.x1 - x >= minEnd) xs.push(x);
    }
    let seq = [row.x0, ...xs, row.x1];
    if (layer.maxStep) {
      const fine: number[] = [seq[0]];
      for (let i = 1; i < seq.length; i++) {
        const k = Math.ceil((seq[i] - seq[i - 1]) / layer.maxStep - 1e-9);
        for (let j = 1; j < k; j++) fine.push(seq[i - 1] + ((seq[i] - seq[i - 1]) * j) / k);
        fine.push(seq[i]);
      }
      seq = fine;
    }
    if (right) seq.reverse();
    const pts: number[] = [];
    if (layer.map)
      for (const x of seq) {
        const p = layer.map(x, row.y);
        pts.push(p[0], p[1]);
      }
    else for (const x of seq) pts.push(m[0] * x + m[2] * row.y + m[4], m[1] * x + m[3] * row.y + m[5]);
    out.push(pts);
    right = !right;
  }
  return out;
}
