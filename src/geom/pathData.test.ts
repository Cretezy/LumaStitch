// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import type { Node, PathGeom, Vec2 } from '@/model/types';
import { arcToCubics, geomToPathData, parsePathData, transformGeom } from './pathData';

function cubicAt(p0: Vec2, c1: Vec2, c2: Vec2, p3: Vec2, t: number): Vec2 {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const c = 3 * mt * t * t;
  const d = t * t * t;
  return [a * p0[0] + b * c1[0] + c * c2[0] + d * p3[0], a * p0[1] + b * c1[1] + c * c2[1] + d * p3[1]];
}

/** Sample every segment of a subpath (including the closing segment). */
function sample(geom: PathGeom, steps = 16): Vec2[] {
  const pts: Vec2[] = [];
  for (const sp of geom.subpaths) {
    const n = sp.nodes.length;
    const segs = sp.closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const a: Node = sp.nodes[i];
      const b: Node = sp.nodes[(i + 1) % n];
      const c1: Vec2 = a.out ? [a.p[0] + a.out[0], a.p[1] + a.out[1]] : a.p;
      const c2: Vec2 = b.in ? [b.p[0] + b.in[0], b.p[1] + b.in[1]] : b.p;
      for (let s = 0; s <= steps; s++) pts.push(cubicAt(a.p, c1, c2, b.p, s / steps));
    }
  }
  return pts;
}

function expectGeomClose(a: PathGeom, b: PathGeom, tol = 1e-6) {
  expect(a.subpaths.length).toBe(b.subpaths.length);
  a.subpaths.forEach((sp, i) => {
    const o = b.subpaths[i];
    expect(sp.closed).toBe(o.closed);
    expect(sp.nodes.length).toBe(o.nodes.length);
    sp.nodes.forEach((n, j) => {
      const m = o.nodes[j];
      expect(n.p[0]).toBeCloseTo(m.p[0], -Math.log10(tol));
      expect(n.p[1]).toBeCloseTo(m.p[1], -Math.log10(tol));
      for (const k of ['in', 'out'] as const) {
        const h1 = n[k] ?? [0, 0];
        const h2 = m[k] ?? [0, 0];
        expect(h1[0]).toBeCloseTo(h2[0], -Math.log10(tol));
        expect(h1[1]).toBeCloseTo(h2[1], -Math.log10(tol));
      }
    });
  });
}

describe('parsePathData', () => {
  it('parses absolute lines and closes, dropping the duplicate end node', () => {
    const g = parsePathData('M0 0 L10 0 L10 10 L0 10 L0 0 Z');
    expect(g.subpaths).toHaveLength(1);
    expect(g.subpaths[0].closed).toBe(true);
    expect(g.subpaths[0].nodes.map((n) => n.p)).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ]);
    expect(g.fillRule).toBe('nonzero');
  });

  it('handles relative commands, H/V and implicit lineto after moveto', () => {
    const g = parsePathData('m10 10 5 0 0 5 h-5 v-5 z m20 0 l1 1', 'evenodd');
    expect(g.fillRule).toBe('evenodd');
    expect(g.subpaths).toHaveLength(2);
    expect(g.subpaths[0].nodes.map((n) => n.p)).toEqual([
      [10, 10],
      [15, 10],
      [15, 15],
      [10, 15],
    ]);
    // After z the current point is the subpath start (10,10), so m20 0 → (30,10)
    expect(g.subpaths[1].closed).toBe(false);
    expect(g.subpaths[1].nodes.map((n) => n.p)).toEqual([
      [30, 10],
      [31, 11],
    ]);
  });

  it('parses compact numbers and exponents', () => {
    const g = parsePathData('M1.5.5L-1-2l1e1,2E-1 .5.5');
    const ps = g.subpaths[0].nodes.map((n) => n.p);
    expect(ps[0]).toEqual([1.5, 0.5]);
    expect(ps[1]).toEqual([-1, -2]);
    expect(ps[2][0]).toBeCloseTo(9);
    expect(ps[2][1]).toBeCloseTo(-1.8);
    expect(ps[3][0]).toBeCloseTo(9.5);
    expect(ps[3][1]).toBeCloseTo(-1.3);
  });

  it('stores cubic handles relative to anchors', () => {
    const g = parsePathData('M0 0 C10 0 20 10 20 20');
    const [a, b] = g.subpaths[0].nodes;
    expect(a.out).toEqual([10, 0]);
    expect(b.in).toEqual([0, -10]);
    expect(a.in).toBeUndefined();
    expect(b.out).toBeUndefined();
  });

  it('reflects S and T control points', () => {
    const g = parsePathData('M0 0 C0 10 10 10 10 0 S20 -10 20 0');
    const n = g.subpaths[0].nodes;
    expect(n[1].in).toEqual([0, 10]);
    expect(n[1].out).toEqual([0, -10]); // reflected
    const q = parsePathData('M0 0 Q5 10 10 0 T20 0');
    const m = q.subpaths[0].nodes;
    // Quad Q5 10 → cubic handles 2/3 toward the control point.
    expect(m[0].out![0]).toBeCloseTo(10 / 3);
    expect(m[0].out![1]).toBeCloseTo(20 / 3);
    // T reflects (5,10) about (10,0) → (15,-10); out handle of node 1 = 2/3 * (5,-10)
    expect(m[1].out![0]).toBeCloseTo(10 / 3);
    expect(m[1].out![1]).toBeCloseTo(-20 / 3);
  });

  it('puts the closing segment handle on the first node', () => {
    const g = parsePathData('M0 0 L10 0 C10 10 0 10 0 0 Z');
    const sp = g.subpaths[0];
    expect(sp.nodes).toHaveLength(2);
    expect(sp.nodes[0].in).toEqual([0, 10]);
    expect(sp.nodes[1].out).toEqual([0, 10]);
  });

  it('converts arcs to cubics that lie on the ellipse', () => {
    // Full circle of radius 10 centred at (10, 0) made of two arcs.
    const g = parsePathData('M0 0 A10 10 0 0 1 20 0 A10 10 0 0 1 0 0 Z');
    const sp = g.subpaths[0];
    expect(sp.closed).toBe(true);
    // two half circles, each split into 2 quarter cubics → 4 nodes after dropping the duplicate
    expect(sp.nodes).toHaveLength(4);
    for (const p of sample(g, 32)) {
      expect(Math.hypot(p[0] - 10, p[1])).toBeCloseTo(10, 2);
    }
    // sweep=1 in y-down space goes through (10,-10) first (clockwise on screen)
    expect(sp.nodes[1].p[0]).toBeCloseTo(10);
    expect(sp.nodes[1].p[1]).toBeCloseTo(-10);
  });

  it('handles rotated elliptical arcs, flags without separators and radius scaling', () => {
    const segs = arcToCubics([0, 0], 20, 10, 30, false, true, [15, 5]);
    const cx = [0, 0] as Vec2;
    let prev = cx;
    // Every sample must satisfy the rotated ellipse equation for some centre; check end point exact.
    expect(segs[segs.length - 1][2]).toEqual([15, 5]);
    for (const s of segs) prev = s[2];
    expect(prev).toEqual([15, 5]);
    // Compact flags: a10 10 0 01 20 0 → large=0, sweep=1
    const g = parsePathData('M0 0a10 10 0 0120 0');
    const end = g.subpaths[0].nodes[g.subpaths[0].nodes.length - 1].p;
    expect(end[0]).toBeCloseTo(20);
    expect(end[1]).toBeCloseTo(0);
    // Radii too small are scaled up: half circle of radius 10 through (0,0)-(20,0)
    const h = parsePathData('M0 0 A1 1 0 0 0 20 0');
    for (const p of sample(h, 16)) expect(Math.hypot(p[0] - 10, p[1])).toBeCloseTo(10, 2);
    // sweep 0 → goes through (10, 10)
    const mid = sample(h, 2);
    expect(Math.max(...mid.map((p) => p[1]))).toBeCloseTo(10, 1);
  });

  it('large-arc flag picks the long way round', () => {
    // From (10,0) to (0,10), r=10: large arc + sweep=1 (increasing angle, y down) is centred at (10,10).
    const g = parsePathData('M10 0 A10 10 0 1 1 0 10');
    const pts = sample(g, 16);
    for (const p of pts) expect(Math.hypot(p[0] - 10, p[1] - 10)).toBeCloseTo(10, 2);
    expect(Math.max(...pts.map((p) => p[0]))).toBeCloseTo(20, 1);
    expect(Math.max(...pts.map((p) => p[1]))).toBeCloseTo(20, 1);
    // Small arc + sweep=1 is centred at the origin.
    const s = sample(parsePathData('M10 0 A10 10 0 0 1 0 10'), 16);
    for (const p of s) expect(Math.hypot(p[0], p[1])).toBeCloseTo(10, 2);
  });

  it('drops degenerate subpaths and rejects garbage', () => {
    expect(parsePathData('M0 0 M5 5').subpaths).toHaveLength(0);
    expect(parsePathData('').subpaths).toHaveLength(0);
    expect(() => parsePathData('L0 0 x')).toThrow();
    expect(() => parsePathData('10 10')).toThrow();
  });

  it('parses potrace-style output', () => {
    const g = parsePathData(
      'M150 250 l-100 0 0 -75 0 -75 100 0 100 0 0 75 0 75 -100 0z m-25 -50 l25 0 0 -25 0 -25 -25 0 -25 0 0 25 0 25 25 0z ',
    );
    expect(g.subpaths).toHaveLength(2);
    expect(g.subpaths[0].nodes).toHaveLength(8);
    expect(g.subpaths[1].nodes[0].p).toEqual([125, 200]);
  });
});

describe('geomToPathData / transformGeom', () => {
  const samples = [
    'M0 0 L10 0 L10 10 Z',
    'M0 0 C10 0 20 10 20 20 S30 40 40 40',
    'M0 0 L10 0 C10 10 0 10 0 0 Z M2 2 l1 0 0 1 z',
    'M0 0 A10 10 0 0 1 20 0 A10 10 0 0 1 0 0 Z',
    'M0 0 Q5 10 10 0 T20 0 t10 0',
    'M3 4 a5 7 45 1 0 10 0',
  ];
  for (const d of samples) {
    it(`round-trips ${d}`, () => {
      const g = parsePathData(d);
      const s = geomToPathData(g, 6);
      expectGeomClose(parsePathData(s), g, 1e-5);
    });
  }

  it('formats numbers compactly', () => {
    expect(geomToPathData(parsePathData('M0.0004 -0.0001 L1.23456 2'))).toBe('M0 0L1.235 2');
  });

  it('transforms anchors fully and handles linearly', () => {
    const g = parsePathData('M1 1 C2 1 3 2 3 3');
    const t = transformGeom(g, [2, 0, 0, -1, 10, 20]);
    const [a, b] = t.subpaths[0].nodes;
    expect(a.p).toEqual([12, 19]);
    expect(a.out![0]).toBe(2);
    expect(a.out![1]).toBeCloseTo(0);
    expect(b.p).toEqual([16, 17]);
    expect(b.in).toEqual([0, 1]);
  });
});
