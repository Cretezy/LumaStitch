// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * A satin "column": two rails A and B plus a centreline, all parameterised by centreline arc length.
 * Used by satin columns (outline), satin fills (auto-turning) and zigzag.
 */
import {
  cumulativeLengths,
  pointAtLength,
  resampleFixed,
  smoothNormals,
  vertexNormals,
} from '@/geom/polyline';
import type { Polyline } from '@/geom/types';
import { F } from '../../types';
import { RunBuilder, runningPoints } from '../common';

export interface Column {
  /** Arc length at each sample. */
  s: Float64Array;
  a: Float64Array;
  b: Float64Array;
  c: Float64Array;
  closed: boolean;
  length: number;
}

export type UnderlayKind =
  'none' | 'center' | 'edge' | 'zigzag' | 'edgeZigzag' | 'centerZigzag' | 'centerEdge';

/** Builds a column of constant half-width around a centreline. */
export function columnFromCenterline(
  center: Polyline,
  closed: boolean,
  halfWidth: number,
  sampleStep = 0.2,
): Column {
  const c = resampleFixed(center, sampleStep);
  const n = c.length / 2;
  const normals = smoothNormals(vertexNormals(c, closed), 2, closed);
  const a = new Float64Array(n * 2);
  const b = new Float64Array(n * 2);
  for (let i = 0; i < n; i++) {
    const nx = normals[i * 2],
      ny = normals[i * 2 + 1];
    a[i * 2] = c[i * 2] + nx * halfWidth;
    a[i * 2 + 1] = c[i * 2 + 1] + ny * halfWidth;
    b[i * 2] = c[i * 2] - nx * halfWidth;
    b[i * 2 + 1] = c[i * 2 + 1] - ny * halfWidth;
  }
  const s = cumulativeLengths(c);
  return { s, a, b, c, closed, length: s[n - 1] ?? 0 };
}

function interp(arr: Float64Array, s: Float64Array, at: number): [number, number] {
  return pointAtLengthGeneric(arr, s, at);
}

function pointAtLengthGeneric(arr: Float64Array, cum: Float64Array, at: number): [number, number] {
  return pointAtLength(arr, cum, at);
}

export function colA(col: Column, at: number) {
  return interp(col.a, col.s, at);
}
export function colB(col: Column, at: number) {
  return interp(col.b, col.s, at);
}
export function colC(col: Column, at: number) {
  return interp(col.c, col.s, at);
}

/** Moves a rail point toward the centre by `inset` mm (never past 45% of the half width). */
function insetPoint(p: [number, number], c: [number, number], inset: number): [number, number] {
  const dx = c[0] - p[0],
    dy = c[1] - p[1];
  const l = Math.hypot(dx, dy);
  if (l < 1e-9) return p;
  const t = Math.min(inset / l, 0.45);
  return [p[0] + dx * t, p[1] + dy * t];
}

export interface SatinOpts {
  /** Peak-to-peak spacing along the centreline. */
  density: number;
  shortStitches?: boolean;
  /** Split stitches longer than this (0 = never). */
  splitAbove?: number;
  flag?: number;
  /** Inset both rails toward the centre (for underlay zigzags). */
  inset?: number;
}

/**
 * One satin/zigzag pass: penetrations alternate between rails every density/2 along the centreline.
 * `forward` walks s from 0 to L; otherwise from L to 0.
 */
export function satinPass(b: RunBuilder, col: Column, forward: boolean, o: SatinOpts): void {
  const L = col.length;
  const half = Math.max(0.05, o.density / 2);
  let n = Math.max(1, Math.round(L / half));
  if (col.closed && n % 2) n++;
  const flag = o.flag ?? F.STITCH;
  const pts: [number, number][] = [];
  const sides: number[] = [];
  for (let k = 0; k <= n; k++) {
    const s = forward ? (L * k) / n : L - (L * k) / n;
    const side = k % 2; // 0 → A, 1 → B
    let p = side === 0 ? colA(col, s) : colB(col, s);
    if (o.inset) p = insetPoint(p, colC(col, s), o.inset);
    pts.push(p);
    sides.push(side);
  }
  if (o.shortStitches && pts.length > 4) {
    // On inner curves the rail spacing shrinks; pull every other inner penetration toward the centre.
    for (let k = 2; k < pts.length - 2; k++) {
      const same = Math.hypot(pts[k + 2][0] - pts[k - 2][0], pts[k + 2][1] - pts[k - 2][1]);
      const other = Math.hypot(pts[k + 1][0] - pts[k - 1][0], pts[k + 1][1] - pts[k - 1][1]);
      // `same` spans two stitch periods on this rail and `other` one period on the opposite rail,
      // so same < other means this rail's spacing is under half of the other's.
      if (other > 1e-6 && same < other && (k >> 1) % 2 === 1) {
        const s = forward ? (L * k) / n : L - (L * k) / n;
        const c = colC(col, s);
        pts[k] = [pts[k][0] + (c[0] - pts[k][0]) * 0.2, pts[k][1] + (c[1] - pts[k][1]) * 0.2];
      }
    }
  }
  const split = o.splitAbove ?? 0;
  for (let k = 0; k < pts.length; k++) {
    if (k > 0 && split > 0) {
      const [px, py] = pts[k - 1];
      const [qx, qy] = pts[k];
      const l = Math.hypot(qx - px, qy - py);
      if (l > split) {
        const m = Math.ceil(l / split);
        const stagger = k % 2 ? 0.5 : 0;
        for (let j = 1; j < m + (stagger ? 1 : 0); j++) {
          const t = (j - stagger) / m;
          if (t <= 0.05 || t >= 0.95) continue;
          b.push(px + (qx - px) * t, py + (qy - py) * t, flag);
        }
      }
    }
    b.push(pts[k][0], pts[k][1], flag);
  }
}

/** Running stitch along the centreline. */
export function centerWalk(
  b: RunBuilder,
  col: Column,
  forward: boolean,
  stitchLen: number,
  flag: number,
): void {
  const pl = forward ? col.c : reversed(col.c);
  b.pushPolyline(runningPoints(pl, stitchLen), flag);
}

/** Running stitch along one inset rail. */
export function railWalk(
  b: RunBuilder,
  col: Column,
  rail: 'a' | 'b',
  forward: boolean,
  inset: number,
  stitchLen: number,
  flag: number,
): void {
  const n = col.s.length;
  const pts = new Float64Array(n * 2);
  const src = rail === 'a' ? col.a : col.b;
  for (let i = 0; i < n; i++) {
    const p = insetPoint([src[i * 2], src[i * 2 + 1]], [col.c[i * 2], col.c[i * 2 + 1]], inset);
    pts[i * 2] = p[0];
    pts[i * 2 + 1] = p[1];
  }
  b.pushPolyline(runningPoints(forward ? pts : reversed(pts), stitchLen), flag);
}

function reversed(pl: Float64Array): Float64Array {
  const n = pl.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i += 2) {
    out[i] = pl[n - 2 - i];
    out[i + 1] = pl[n - 1 - i];
  }
  return out;
}

/** Resolves 'auto' satin underlay from the column width (SPEC §8.3), with fabric boost levels. */
export function resolveSatinUnderlay(setting: string, width: number, boost: number): UnderlayKind {
  if (setting !== 'auto') return setting as UnderlayKind;
  const levels: UnderlayKind[] = ['none', 'center', 'edge', 'edgeZigzag'];
  let lvl = width < 2 ? 1 : width <= 4 ? 2 : 3;
  lvl = Math.min(3, lvl + Math.max(0, Math.round(boost)));
  return levels[lvl];
}

export interface ColumnSewOpts {
  density: number;
  underlay: UnderlayKind;
  underlayInset: number;
  zigzagUnderlaySpacing: number;
  underlayStitchLength: number;
  shortStitches: boolean;
  splitAbove: number;
}

/** Number of passes (direction changes) the column will sew, used to pick the start end. */
function passPlan(u: UnderlayKind): ('center' | 'edgeA' | 'edgeB' | 'zigzag' | 'top')[] {
  const out: ('center' | 'edgeA' | 'edgeB' | 'zigzag' | 'top')[] = [];
  if (u === 'center' || u === 'centerZigzag' || u === 'centerEdge') out.push('center');
  if (u === 'edge' || u === 'edgeZigzag' || u === 'centerEdge') out.push('edgeA', 'edgeB');
  if (u === 'zigzag' || u === 'edgeZigzag' || u === 'centerZigzag') out.push('zigzag');
  out.push('top');
  return out;
}

export function satinPassCount(u: UnderlayKind): number {
  return passPlan(u).length;
}

/**
 * Sews a full column: underlay passes then the satin top, alternating direction.
 * For open columns, the starting end is chosen so entry is near `entry` and the exit near `exit`.
 */
export function sewColumn(
  b: RunBuilder,
  col: Column,
  o: ColumnSewOpts,
  entry?: [number, number],
  exit?: [number, number],
  direction?: boolean,
): void {
  const plan = passPlan(o.underlay);
  let forward = true;
  if (!col.closed && col.length > 0) {
    const odd = plan.length % 2 === 1;
    const start0 = colC(col, 0),
      startL = colC(col, col.length);
    const cost = (fwd: boolean) => {
      const s = fwd ? start0 : startL;
      const e = odd ? (fwd ? startL : start0) : s;
      let c = 0;
      if (entry) c += Math.hypot(s[0] - entry[0], s[1] - entry[1]);
      if (exit) c += 0.5 * Math.hypot(e[0] - exit[0], e[1] - exit[1]);
      return c;
    };
    forward = cost(true) <= cost(false);
  }
  if (direction !== undefined) forward = direction;
  let dir = forward;
  for (const pass of plan) {
    const before = b.length;
    switch (pass) {
      case 'center':
        centerWalk(b, col, dir, o.underlayStitchLength, F.UNDERLAY);
        break;
      case 'edgeA':
        railWalk(b, col, 'a', dir, o.underlayInset, o.underlayStitchLength, F.UNDERLAY);
        break;
      case 'edgeB':
        railWalk(b, col, 'b', dir, o.underlayInset, o.underlayStitchLength, F.UNDERLAY);
        break;
      case 'zigzag':
        satinPass(b, col, dir, {
          density: o.zigzagUnderlaySpacing,
          inset: o.underlayInset,
          flag: F.UNDERLAY,
        });
        break;
      case 'top':
        satinPass(b, col, dir, {
          density: o.density,
          shortStitches: o.shortStitches,
          splitAbove: o.splitAbove,
        });
        break;
    }
    void before;
    if (!col.closed) dir = !dir;
  }
}
