// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Scanline intersection: rows at a given screen angle and spacing, aligned to a global grid,
 * return sorted x-intervals per row in the rotated frame (rows horizontal).
 */
import { rotationFor } from './matrix';
import { polyShapeBBox, transformPolyShape } from './polygon';
import type { PolyShape, Ring } from './types';

export interface ScanRow {
  /** Global row index: y = k · spacing (+ phase) in the rotated frame. */
  k: number;
  y: number;
  /** Sorted, disjoint [x0, x1] intervals. */
  intervals: [number, number][];
}

export interface ScanResult {
  rows: ScanRow[];
  /** Polygon rotated so rows are horizontal. */
  rotated: PolyShape;
  /** Matrix mapping rotated frame → document. */
  toDoc: [number, number, number, number, number, number];
  /** Matrix mapping document → rotated frame. */
  toRot: [number, number, number, number, number, number];
}

function addRingCrossings(r: Ring, y: number, xs: number[]): void {
  const n = r.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const y0 = r[j + 1],
      y1 = r[i + 1];
    // Half-open rule avoids double-counting vertices on the scanline.
    if (y0 <= y !== y1 <= y) {
      const x0 = r[j],
        x1 = r[i];
      xs.push(x0 + ((y - y0) * (x1 - x0)) / (y1 - y0));
    }
  }
}

/** Intervals of a (rotated) polygon at a horizontal line y. */
export function intervalsAt(ps: PolyShape, y: number): [number, number][] {
  const xs: number[] = [];
  for (const p of ps) {
    addRingCrossings(p.outer, y, xs);
    for (const h of p.holes) addRingCrossings(h, y, xs);
  }
  xs.sort((a, b) => a - b);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1] - xs[i] > 1e-6) out.push([xs[i], xs[i + 1]]);
  return out;
}

/**
 * Scan a polygon at screen angle `angleDeg` with row spacing `spacing`.
 * `phase` (0..1) shifts the grid by a fraction of the spacing.
 */
export function scanRows(ps: PolyShape, angleDeg: number, spacing: number, phase = 0.5): ScanResult {
  const toRot = rotationFor(-angleDeg);
  const toDoc = rotationFor(angleDeg);
  const rotated = transformPolyShape(ps, toRot);
  const b = polyShapeBBox(rotated);
  const rows: ScanRow[] = [];
  if (!(b.maxY > b.minY) || spacing <= 0) return { rows, rotated, toDoc, toRot };
  const k0 = Math.ceil(b.minY / spacing - phase);
  const k1 = Math.floor(b.maxY / spacing - phase);
  for (let k = k0; k <= k1; k++) {
    const y = (k + phase) * spacing;
    const intervals = intervalsAt(rotated, y);
    if (intervals.length) rows.push({ k, y, intervals });
  }
  return { rows, rotated, toDoc, toRot };
}
