// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Motif run: a small unit motif repeated along the path and bent to follow it. Motif points are
 * defined in a unit box (u ∈ [0, 1] along the path, v ∈ [−1, 1] across it) and mapped through the
 * path's arc length and smoothed normals.
 */
import { flattenToPaths } from '@/geom/flatten';
import type { Polyline } from '@/geom/types';
import type { StitchTypeDef } from '../../def';
import { bool, num, str } from '../../params/types';
import { runningPoints } from '../common';
import { pathFrame, routeFixedPaths, type FixedPath } from '../p2util';

type UnitPt = [u: number, v: number];

function sampled(n: number, f: (t: number) => UnitPt): UnitPt[] {
  return Array.from({ length: n + 1 }, (_, i) => f(i / n));
}

function heart(): UnitPt[] {
  // Classic heart curve, tip on the baseline at u = 0.5, lobes towards v = 1.
  const raw: UnitPt[] = [];
  for (let i = 0; i <= 32; i++) {
    const t = Math.PI + (2 * Math.PI * i) / 32;
    const s = Math.sin(t);
    raw.push([
      16 * s * s * s,
      13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t),
    ]);
  }
  const minY = Math.min(...raw.map((p) => p[1]));
  const maxY = Math.max(...raw.map((p) => p[1]));
  const loop = raw.map(([x, y]): UnitPt => [0.5 + (x / 32) * 0.9, (y - minY) / (maxY - minY)]);
  return [[0, 0], ...loop, [1, 0]];
}

/** Built-in motifs. Each starts at (0, 0) and ends at (1, 0) so repeats chain along the baseline. */
export const MOTIFS: Record<string, UnitPt[]> = {
  triangle: [
    [0, 0],
    [0.5, 1],
    [1, 0],
  ],
  wave: sampled(24, (t) => [t, Math.sin(2 * Math.PI * t)]),
  scallop: sampled(16, (t) => [(1 - Math.cos(Math.PI * t)) / 2, Math.sin(Math.PI * t)]),
  diamond: [
    [0, 0],
    [0.5, 1],
    [1, 0],
    [0.5, -1],
    [0, 0],
    [1, 0],
  ],
  arrow: [
    [0, 0],
    [1, 0],
    [0.55, 0.8],
    [1, 0],
    [0.55, -0.8],
    [1, 0],
  ],
  heart: heart(),
};

export const MOTIF_OPTIONS = [
  { value: 'triangle', label: 'Triangle' },
  { value: 'wave', label: 'Wave' },
  { value: 'scallop', label: 'Scallop' },
  { value: 'diamond', label: 'Diamond' },
  { value: 'arrow', label: 'Arrow' },
  { value: 'heart', label: 'Heart' },
];

export interface MotifRunPrep {
  paths: FixedPath[];
}

/** Lays out motifs along one path; returns the bent centre polyline (before stitch resampling). */
export function motifPolyline(
  pl: Polyline,
  closed: boolean,
  motif: UnitPt[],
  size: number,
  spacing: number,
  side: number,
  alternate: boolean,
): Polyline {
  const frame = pathFrame(pl, closed);
  const L = frame.length;
  const out: number[] = [];
  const emit = (s: number, v: number) => {
    const f = frame.at(s);
    out.push(f.x + f.nx * v, f.y + f.ny * v);
  };
  const period = size + spacing;
  const n = closed ? Math.max(1, Math.round(L / period)) : Math.round((L + spacing) / period);
  if (L < 1e-6) return pl.slice();
  if (n < 1 || L < size * 0.5) {
    // Too short for a motif: plain baseline.
    for (let k = 0, m = Math.max(1, Math.ceil(L / 0.25)); k <= m; k++) emit((L * k) / m, 0);
    return Float64Array.from(out);
  }
  // Stretch the layout along the path so whole motifs fit exactly.
  const k = closed ? L / (n * period) : L / (n * size + (n - 1) * spacing);
  const a = size * k,
    g = spacing * k;
  const h = size / 2;
  const fine = 0.25;
  emit(0, 0);
  for (let m = 0; m < n; m++) {
    const s0 = m * (a + g);
    const sign = side * (alternate && m % 2 ? -1 : 1);
    for (let i = 1; i < motif.length; i++) {
      const [u0, v0] = motif[i - 1];
      const [u1, v1] = motif[i];
      const steps = Math.max(1, Math.ceil(Math.hypot((u1 - u0) * a, (v1 - v0) * h) / fine));
      for (let j = 1; j <= steps; j++) {
        const t = j / steps;
        emit(s0 + (u0 + (u1 - u0) * t) * a, (v0 + (v1 - v0) * t) * h * sign);
      }
    }
    // Baseline gap to the next motif (or to the end of a closed path).
    const gapEnd = m < n - 1 || closed ? s0 + a + g : s0 + a;
    const gs = Math.ceil((gapEnd - (s0 + a)) / fine);
    for (let j = 1; j <= gs; j++) emit(s0 + a + ((gapEnd - s0 - a) * j) / gs, 0);
  }
  if (closed) {
    // Close exactly on the start point.
    out[out.length - 2] = out[0];
    out[out.length - 1] = out[1];
  }
  return Float64Array.from(out);
}

export const motifRunDef: StitchTypeDef<MotifRunPrep> = {
  id: 'motifRun',
  label: 'Motif run',
  description: 'A small motif (triangles, waves, hearts…) repeated along the path. Decorative borders.',
  role: 'outline',
  params: [
    {
      key: 'motif',
      label: 'Motif',
      help: 'The shape repeated along the path.',
      kind: 'enum',
      options: MOTIF_OPTIONS,
      group: 'basic',
    },
    {
      key: 'size',
      label: 'Motif size',
      help: 'Length and height of one motif.',
      kind: 'length',
      unit: 'mm',
      min: 1,
      max: 20,
      step: 0.1,
      group: 'basic',
    },
    {
      key: 'spacing',
      label: 'Spacing',
      help: 'Plain run between motifs. Motifs are stretched slightly so a whole number fits the path.',
      kind: 'length',
      unit: 'mm',
      min: 0,
      max: 20,
      step: 0.1,
      group: 'basic',
    },
    {
      key: 'stitchLength',
      label: 'Stitch length',
      help: 'Maximum stitch length along the motif. Motif corners always get a penetration.',
      kind: 'length',
      unit: 'mm',
      min: 0.5,
      max: 5,
      step: 0.1,
      group: 'basic',
    },
    {
      key: 'flip',
      label: 'Flip side',
      help: 'Mirror the motif to the other side of the path.',
      kind: 'boolean',
      group: 'advanced',
    },
    {
      key: 'alternate',
      label: 'Alternate sides',
      help: 'Mirror every second motif (e.g. triangles become a zigzag).',
      kind: 'boolean',
      group: 'advanced',
    },
  ],
  defaults: { motif: 'triangle', size: 4, spacing: 1, stitchLength: 1.5, flip: false, alternate: false },
  appliesTo: (s) => s.hasClosed || s.hasOpen,
  prepare(geom, params, _el, ctx) {
    const motif = MOTIFS[str(params, 'motif', 'triangle')] ?? MOTIFS.triangle;
    const size = Math.max(0.5, num(params, 'size', 4));
    const spacing = Math.max(0, num(params, 'spacing', 1));
    const len = Math.max(0.3, num(params, 'stitchLength', 1.5));
    const side = bool(params, 'flip', false) ? -1 : 1;
    const alternate = bool(params, 'alternate', false);
    const paths: FixedPath[] = [];
    for (const { pts, closed } of flattenToPaths(geom, ctx.tolerance)) {
      const line = motifPolyline(pts, closed, motif, size, spacing, side, alternate);
      if (line.length < 4) continue;
      paths.push({ pts: runningPoints(line, len, 30), closed });
    }
    return { paths };
  },
  route(prep, hints) {
    return routeFixedPaths(prep.paths, hints.entry, hints.exit).build();
  },
};
