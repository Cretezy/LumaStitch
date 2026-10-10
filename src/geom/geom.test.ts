import { describe, expect, it } from 'vitest';
import type { PathGeom } from '@/model/types';
import { flattenGeom, flattenSubpath } from './flatten';
import { difference, intersection, makeValid, offset, offsetPolylines, union } from './clipper';
import { minAreaRect, pointInPolyShape, polyShapeArea, signedArea, createPointTester } from './polygon';
import { resampleEven, nearestOnPolyline, simplifyDP, rotateClosedTo, polylineLength } from './polyline';
import { scanRows } from './scanline';
import { medialAxis } from './medialAxis';
import { apply, rotateScreen, invert, multiply } from './matrix';
import type { PolyShape } from './types';

const K = 0.5522847498;
function circleGeom(cx: number, cy: number, r: number): PathGeom {
  const k = K * r;
  return {
    fillRule: 'nonzero',
    subpaths: [
      {
        closed: true,
        nodes: [
          { p: [cx + r, cy], in: [0, -k], out: [0, k] },
          { p: [cx, cy + r], in: [k, 0], out: [-k, 0] },
          { p: [cx - r, cy], in: [0, k], out: [0, -k] },
          { p: [cx, cy - r], in: [-k, 0], out: [k, 0] },
        ],
      },
    ],
  };
}
function rect(x: number, y: number, w: number, h: number): PolyShape {
  return makeValid([Float64Array.from([x, y, x + w, y, x + w, y + h, x, y + h])]);
}

describe('flatten', () => {
  it('flattens a circle within tolerance', () => {
    const r = 10;
    const ring = flattenSubpath(circleGeom(0, 0, r).subpaths[0], 0.05);
    for (let i = 0; i < ring.length; i += 2) {
      expect(Math.abs(Math.hypot(ring[i], ring[i + 1]) - r)).toBeLessThan(0.05);
    }
    // midpoints of chords also within tolerance (+ bezier approx error ~0.003r)
    for (let i = 0; i < ring.length; i += 2) {
      const j = (i + 2) % ring.length;
      const mx = (ring[i] + ring[j]) / 2,
        my = (ring[i + 1] + ring[j + 1]) / 2;
      expect(r - Math.hypot(mx, my)).toBeLessThan(0.05 + 0.03);
    }
    expect(Math.abs(Math.abs(signedArea(ring)) - Math.PI * r * r)).toBeLessThan(2);
  });
  it('separates open and closed subpaths', () => {
    const g: PathGeom = {
      fillRule: 'nonzero',
      subpaths: [
        { closed: false, nodes: [{ p: [0, 0] }, { p: [10, 0] }] },
        { closed: true, nodes: [{ p: [0, 0] }, { p: [10, 0] }, { p: [10, 10] }] },
      ],
    };
    const f = flattenGeom(g);
    expect(f.rings.length).toBe(1);
    expect(f.polylines.length).toBe(1);
  });
});

describe('clipper', () => {
  it('makeValid normalises orientation and holes (evenodd)', () => {
    const outer = Float64Array.from([0, 0, 10, 0, 10, 10, 0, 10]);
    const inner = Float64Array.from([2, 2, 8, 2, 8, 8, 2, 8]);
    const ps = makeValid([outer, inner], 'evenodd');
    expect(ps.length).toBe(1);
    expect(ps[0].holes.length).toBe(1);
    expect(signedArea(ps[0].outer)).toBeGreaterThan(0);
    expect(signedArea(ps[0].holes[0])).toBeLessThan(0);
    expect(polyShapeArea(ps)).toBeCloseTo(64, 3);
  });
  it('offset grows a square by delta (round joins)', () => {
    const ps = rect(0, 0, 10, 10);
    const o = offset(ps, 1);
    const expected = 100 + 4 * 10 + Math.PI;
    expect(Math.abs(polyShapeArea(o) - expected)).toBeLessThan(0.1);
    expect(polyShapeArea(offset(ps, -1))).toBeCloseTo(64, 2);
  });
  it('booleans', () => {
    const a = rect(0, 0, 10, 10),
      b = rect(5, 5, 10, 10);
    expect(polyShapeArea(union(a, b))).toBeCloseTo(175, 3);
    expect(polyShapeArea(intersection(a, b))).toBeCloseTo(25, 3);
    expect(polyShapeArea(difference(a, b))).toBeCloseTo(75, 3);
  });
  it('offsets polylines into a stroke shape', () => {
    const s = offsetPolylines([Float64Array.from([0, 0, 10, 0])], 1, 'round', 'butt');
    expect(polyShapeArea(s)).toBeCloseTo(20, 1);
  });
});

describe('polygon', () => {
  it('min-area rect finds the long axis', () => {
    // rectangle 20×4 rotated 30° CCW on screen
    const m = rotateScreen(30);
    const pts: number[] = [];
    for (const p of [
      [-10, -2],
      [10, -2],
      [10, 2],
      [-10, 2],
    ] as [number, number][])
      pts.push(...apply(m, p));
    const r = minAreaRect(pts);
    expect(r.angle).toBeCloseTo(30, 3);
    expect(r.length).toBeCloseTo(20, 3);
    expect(r.width).toBeCloseTo(4, 3);
  });
  it('point tester agrees with brute force', () => {
    const ps = makeValid(
      [Float64Array.from([0, 0, 10, 0, 10, 10, 0, 10]), Float64Array.from([3, 3, 7, 3, 7, 7, 3, 7])],
      'evenodd',
    );
    const t = createPointTester(ps);
    for (let i = 0; i < 500; i++) {
      const x = Math.random() * 12 - 1,
        y = Math.random() * 12 - 1;
      expect(t(x, y)).toBe(pointInPolyShape(ps, x, y));
    }
  });
});

describe('matrix', () => {
  it('rotateScreen rotates CCW on screen (y down)', () => {
    const p = apply(rotateScreen(90), [1, 0]);
    expect(p[0]).toBeCloseTo(0);
    expect(p[1]).toBeCloseTo(-1);
  });
  it('invert', () => {
    const m = multiply(rotateScreen(33, 2, 3), [2, 0, 0, 3, 5, 6]);
    const p = apply(multiply(invert(m), m), [4, 7]);
    expect(p[0]).toBeCloseTo(4);
    expect(p[1]).toBeCloseTo(7);
  });
});

describe('polyline', () => {
  it('resampleEven keeps corners and bounds the step', () => {
    const pl = Float64Array.from([0, 0, 10, 0, 10, 7]);
    const r = resampleEven(pl, 2.5);
    // corner at (10,0) must be present
    let hasCorner = false;
    for (let i = 0; i < r.length; i += 2)
      if (Math.abs(r[i] - 10) < 1e-9 && Math.abs(r[i + 1]) < 1e-9) hasCorner = true;
    expect(hasCorner).toBe(true);
    for (let i = 2; i < r.length; i += 2)
      expect(Math.hypot(r[i] - r[i - 2], r[i + 1] - r[i - 1])).toBeLessThanOrEqual(2.5 + 1e-9);
    expect(r.length / 2).toBe(1 + 4 + 3);
  });
  it('nearestOnPolyline and DP', () => {
    const pl = Float64Array.from([0, 0, 5, 0.01, 10, 0]);
    const n = nearestOnPolyline(pl, 7, 3);
    expect(n.x).toBeCloseTo(7, 1);
    expect(simplifyDP(pl, 0.1).length).toBe(4);
  });
  it('rotateClosedTo starts at the nearest point', () => {
    const sq = Float64Array.from([0, 0, 10, 0, 10, 10, 0, 10, 0, 0]);
    const r = rotateClosedTo(sq, 10, 5);
    expect(r[0]).toBeCloseTo(10);
    expect(r[1]).toBeCloseTo(5);
    expect(r[r.length - 2]).toBeCloseTo(10);
    expect(r[r.length - 1]).toBeCloseTo(5);
    expect(polylineLength(r)).toBeCloseTo(40);
  });
});

describe('scanline', () => {
  it('horizontal rows over a square', () => {
    const s = scanRows(rect(0, 0, 10, 10), 0, 1);
    expect(s.rows.length).toBe(10);
    for (const row of s.rows) {
      expect(row.intervals.length).toBe(1);
      expect(row.intervals[0][1] - row.intervals[0][0]).toBeCloseTo(10, 6);
    }
  });
  it('rows at 90° are vertical in document space', () => {
    const s = scanRows(rect(0, 0, 10, 4), 90, 1);
    expect(s.rows.length).toBe(10);
    for (const row of s.rows) expect(row.intervals[0][1] - row.intervals[0][0]).toBeCloseTo(4, 6);
  });
  it('rows split around holes', () => {
    const ps = makeValid(
      [Float64Array.from([0, 0, 10, 0, 10, 10, 0, 10]), Float64Array.from([3, 3, 7, 3, 7, 7, 3, 7])],
      'evenodd',
    );
    const s = scanRows(ps, 0, 1);
    const mid = s.rows.find((r) => Math.abs(r.y - 5.5) < 1e-6)!;
    expect(mid.intervals.length).toBe(2);
  });
});

describe('medial axis', () => {
  it('rectangle: width and simple column', () => {
    const m = medialAxis(rect(0, 0, 30, 4));
    expect(m.maxWidth).toBeGreaterThan(3.6);
    expect(m.maxWidth).toBeLessThan(4.2);
    expect(m.branches).toBe(0);
    expect(m.diameterLength).toBeGreaterThan(24);
  });
  it('Y shape has branches', () => {
    const arm = (angle: number) => {
      const m = rotateScreen(angle);
      const pts: number[] = [];
      for (const p of [
        [0, -1.5],
        [20, -1.5],
        [20, 1.5],
        [0, 1.5],
      ] as [number, number][])
        pts.push(...apply(m, p));
      return makeValid([Float64Array.from(pts)]);
    };
    const y = union(union(arm(90), arm(210)), arm(330));
    const m = medialAxis(y);
    expect(m.branches).toBeGreaterThanOrEqual(1);
    expect(m.maxWidth).toBeLessThan(6);
  });
  it('ring has a hole', () => {
    const c1 = flattenGeom(circleGeom(0, 0, 10)).rings[0];
    const c2 = flattenGeom(circleGeom(0, 0, 7)).rings[0];
    const m = medialAxis(makeValid([c1, c2], 'evenodd'));
    expect(m.holes).toBe(1);
    expect(m.maxWidth).toBeGreaterThan(2.7);
    expect(m.maxWidth).toBeLessThan(3.4);
  });
});

describe('inside router', () => {
  it('routes around a hole', async () => {
    const { InsideRouter } = await import('./visibility');
    const ps = makeValid(
      [Float64Array.from([0, 0, 30, 0, 30, 30, 0, 30]), Float64Array.from([10, 10, 20, 10, 20, 20, 10, 20])],
      'evenodd',
    );
    const r = new InsideRouter(ps);
    const p = r.path(5, 15, 25, 15);
    expect(p).not.toBeNull();
    // Every leg stays clear of the hole.
    const hole = createPointTester(
      makeValid([Float64Array.from([10.01, 10.01, 19.99, 10.01, 19.99, 19.99, 10.01, 19.99])]),
    );
    for (let i = 2; i < p!.length; i += 2) {
      for (let t = 0; t <= 1; t += 0.05) {
        const x = p![i - 2] + (p![i] - p![i - 2]) * t,
          y = p![i - 1] + (p![i + 1] - p![i - 1]) * t;
        expect(hole(x, y)).toBe(false);
      }
    }
    expect(polylineLength(p!)).toBeLessThan(30);
  });

  it('finds paths along curves (nodes, edges and the inside test share one simplified outline)', async () => {
    const { InsideRouter } = await import('./visibility');
    // A thick ring: getting from one side to the other means following the curve.
    const ring = makeValid(flattenGeom(compoundCircles()).rings, 'evenodd');
    const r = new InsideRouter(offset(ring, -0.25), 0.3);
    for (const [ax, ay, bx, by] of [
      [8, 0, -8, 0],
      [0, 8, 0, -8],
      [5.7, 5.7, -5.7, -5.7],
    ]) {
      const p = r.path(ax, ay, bx, by);
      expect(p).not.toBeNull();
      // Around the half circle (≈ π·8), not a huge detour.
      expect(polylineLength(p!)).toBeLessThan(Math.PI * 8 * 1.3);
    }
  });
});

function compoundCircles(): PathGeom {
  const outer = circleGeom(0, 0, 10),
    inner = circleGeom(0, 0, 6);
  return { fillRule: 'evenodd', subpaths: [...outer.subpaths, ...inner.subpaths] };
}
