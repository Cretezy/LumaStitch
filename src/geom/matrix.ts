// SPDX-License-Identifier: GPL-3.0-or-later
import type { Matrix, Vec2 } from '@/model/types';

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** m1 × m2 (apply m2 first, then m1). */
export function multiply(m1: Matrix, m2: Matrix): Matrix {
  const [a1, b1, c1, d1, e1, f1] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

export function compose(...ms: Matrix[]): Matrix {
  return ms.reduce((acc, m) => multiply(acc, m), IDENTITY);
}

export function apply(m: Matrix, p: Vec2): Vec2 {
  return [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
}

/** Apply only the linear part (for Bézier handles, which are relative vectors). */
export function applyLinear(m: Matrix, v: Vec2): Vec2 {
  return [m[0] * v[0] + m[2] * v[1], m[1] * v[0] + m[3] * v[1]];
}

export function invert(m: Matrix): Matrix {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-12) return IDENTITY;
  const id = 1 / det;
  return [d * id, -b * id, -c * id, a * id, (c * f - d * e) * id, (b * e - a * f) * id];
}

export function translate(tx: number, ty: number): Matrix {
  return [1, 0, 0, 1, tx, ty];
}

export function scale(sx: number, sy = sx, cx = 0, cy = 0): Matrix {
  return [sx, 0, 0, sy, cx - sx * cx, cy - sy * cy];
}

/**
 * Rotation by `deg` degrees counter-clockwise *as seen on screen* (y down), about (cx, cy).
 * Because y points down, a visually CCW rotation is a mathematically negative angle.
 */
export function rotateScreen(deg: number, cx = 0, cy = 0): Matrix {
  const t = (-deg * Math.PI) / 180;
  const cos = Math.cos(t);
  const sin = Math.sin(t);
  return [cos, sin, -sin, cos, cx - cos * cx + sin * cy, cy - sin * cx - cos * cy];
}

/** Rotation helper used by the engine: maps the screen-CCW angle convention to a matrix. */
export const rotationFor = (angleDeg: number, cx = 0, cy = 0) => rotateScreen(angleDeg, cx, cy);

export function determinant(m: Matrix): number {
  return m[0] * m[3] - m[1] * m[2];
}

/** Uniform scale factor of a matrix (geometric mean of axis scales). */
export function scaleFactor(m: Matrix): number {
  return Math.sqrt(Math.abs(determinant(m)));
}

/** Screen-CCW rotation contained in a matrix, in degrees. */
export function rotationOf(m: Matrix): number {
  return (-Math.atan2(m[1], m[0]) * 180) / Math.PI;
}

/** True if the matrix mirrors (negative determinant). */
export function isMirror(m: Matrix): boolean {
  return determinant(m) < 0;
}
