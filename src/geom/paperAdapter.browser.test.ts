// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import type { PathGeom, Vec2 } from '@/model/types';
import {
  booleanGeoms,
  clipGeom,
  closePath,
  combine,
  fromPaper,
  geomArea,
  geomBounds,
  getPaper,
  insertNodeAt,
  joinEndpoints,
  nearestLocation,
  openPath,
  parsePathDataPaper,
  removeNodes,
  reverseGeom,
  simplifyGeom,
  splitSubpaths,
  toPaper,
  toggleSmooth,
  transformGeom,
} from './paperAdapter';

const rect = (x: number, y: number, w: number, h: number, ccw = false): string =>
  ccw ? `M${x} ${y} V${y + h} H${x + w} V${y} Z` : `M${x} ${y} H${x + w} V${y + h} H${x} Z`;
/** Circle as two arcs (Paper converts arcs to cubics). `ccw` flips the sweep. */
const circle = (cx: number, cy: number, r: number, ccw = false): string => {
  const s = ccw ? 0 : 1;
  return `M${cx + r} ${cy} A${r} ${r} 0 1 ${s} ${cx - r} ${cy} A${r} ${r} 0 1 ${s} ${cx + r} ${cy} Z`;
};
const geom = (d: string, fillRule: PathGeom['fillRule'] = 'nonzero') =>
  parsePathDataPaper(d, undefined, fillRule);
const close = (a: number, b: number, rel = 1e-3) =>
  expect(Math.abs(a - b)).toBeLessThanOrEqual(Math.abs(b) * rel + 1e-6);

/** Max distance from points sampled along `a` to the outline of `b`. */
function maxDeviation(a: PathGeom, b: PathGeom, samples = 400): number {
  getPaper();
  const pa = toPaper(a);
  const pb = toPaper(b);
  let max = 0;
  for (const child of pa.children as paper.Path[]) {
    const len = child.length;
    for (let i = 0; i <= samples; i++) {
      const p = child.getPointAt((len * i) / samples);
      max = Math.max(max, pb.getNearestPoint(p).getDistance(p));
    }
  }
  return max;
}

describe('paperAdapter conversion', () => {
  it('round-trips PathGeom → Paper → PathGeom exactly', () => {
    const g: PathGeom = {
      fillRule: 'evenodd',
      subpaths: [
        {
          closed: true,
          nodes: [
            { p: [0, 0], out: [5, -5] },
            { p: [20, 0], in: [-5, -5], out: [5, 5], smooth: true },
            { p: [20, 20] },
          ],
        },
        { closed: false, nodes: [{ p: [1, 1] }, { p: [3, 4], in: [-1, 0] }] },
      ],
    };
    const back = fromPaper(toPaper(g));
    expect(back).toEqual(g);
  });

  it('parses path data incl. arcs and relative commands, applying a matrix', () => {
    const g = parsePathDataPaper('m10 10 h10 v10 h-10 z', [2, 0, 0, 2, 1, 1]);
    expect(g.subpaths).toHaveLength(1);
    expect(g.subpaths[0].closed).toBe(true);
    expect(g.subpaths[0].nodes.map((n) => n.p)).toEqual([
      [21, 21],
      [41, 21],
      [41, 41],
      [21, 41],
    ]);
    const c = geom(circle(0, 0, 10));
    const b = geomBounds(c)!;
    close(b.minX, -10);
    close(b.maxX, 10);
    close(b.minY, -10);
    close(b.maxY, 10);
    close(geomArea(c), Math.PI * 100, 1e-3);
  });

  it('merges a closing L onto the start node', () => {
    const g = geom('M0 0 L10 0 L10 10 L0 0 Z');
    expect(g.subpaths[0].nodes).toHaveLength(3);
  });

  it('computes exact bounds of curves (extrema, not handles)', () => {
    const b = geomBounds(geom('M0 0 C0 -10 10 -10 10 0'))!;
    close(b.minY, -7.5);
    close(b.maxY, 0);
    close(b.minX, 0);
    close(b.maxX, 10);
    expect(geomBounds({ fillRule: 'nonzero', subpaths: [] })).toBeNull();
  });

  it('transformGeom bakes a matrix into anchors and handles', () => {
    const g = geom('M0 0 C0 -10 10 -10 10 0');
    const t = transformGeom(g, [0, 1, -1, 0, 5, 0]);
    expect(t.subpaths[0].nodes[0].p).toEqual([5, 0]);
    expect(t.subpaths[0].nodes[0].out).toEqual([10, 0]);
  });
});

describe('paperAdapter booleans (analytic areas)', () => {
  const A = geom(rect(0, 0, 10, 10));
  const B = geom(rect(5, 5, 10, 10));

  it('unite / intersect / subtract / exclude on overlapping squares', () => {
    close(geomArea(booleanGeoms('unite', [A, B])[0]), 175);
    close(geomArea(booleanGeoms('intersect', [A, B])[0]), 25);
    close(geomArea(booleanGeoms('subtract', [A, B])[0]), 75);
    close(geomArea(booleanGeoms('exclude', [A, B])[0]), 150);
    // Subtract = back minus the union of the rest.
    const C = geom(rect(-5, -5, 7, 7));
    close(geomArea(booleanGeoms('subtract', [A, B, C])[0]), 100 - 25 - 4);
    // Empty intersection → no result.
    expect(booleanGeoms('intersect', [A, geom(rect(50, 50, 1, 1))])).toEqual([]);
  });

  it('divide returns the non-overlapping pieces', () => {
    const pieces = booleanGeoms('divide', [A, B]);
    const areas = pieces.map(geomArea).sort((a, b) => a - b);
    expect(areas).toHaveLength(3);
    close(areas[0], 25);
    close(areas[1], 75);
    close(areas[2], 75);
  });

  it('handles holes: evenodd ring and nonzero ring with reversed hole', () => {
    const ringArea = Math.PI * (100 - 25);
    const evenodd = geom(circle(0, 0, 10) + circle(0, 0, 5), 'evenodd');
    const nonzero = geom(circle(0, 0, 10) + circle(0, 0, 5, true), 'nonzero');
    const nonzeroSame = geom(circle(0, 0, 10) + circle(0, 0, 5), 'nonzero');
    close(geomArea(evenodd), ringArea);
    close(geomArea(nonzero), ringArea);
    close(geomArea(nonzeroSame), Math.PI * 100);
    // Ring ∩ square [0,10]² = quarter ring.
    const sq = geom(rect(0, 0, 10, 10));
    for (const ring of [evenodd, nonzero]) {
      const [r] = booleanGeoms('intersect', [ring, sq]);
      close(geomArea(r), ringArea / 4);
      // Result renders identically under both fill rules.
      close(geomArea({ ...r, fillRule: 'evenodd' }), ringArea / 4);
      // Ring − square = three quarters of the ring; the hole is kept.
      close(geomArea(booleanGeoms('subtract', [ring, sq])[0]), (ringArea * 3) / 4);
      // Unite with a disc filling the hole = full disc.
      close(geomArea(booleanGeoms('unite', [ring, geom(circle(0, 0, 6))])[0]), Math.PI * 100);
      // Exclude with a disc of radius 6 = full disc minus the annulus 5..6.
      close(geomArea(booleanGeoms('exclude', [ring, geom(circle(0, 0, 6))])[0]), Math.PI * (100 - 11));
    }
  });

  it('curved operands: circle ∩ square = quarter disc, lens of two circles', () => {
    const disc = geom(circle(0, 0, 10));
    close(geomArea(booleanGeoms('intersect', [disc, geom(rect(0, 0, 20, 20))])[0]), (Math.PI * 100) / 4);
    // Two unit-radius-10 circles with centres 10 apart: lens area = 2r²·acos(d/2r) − (d/2)·√(4r²−d²).
    const r = 10;
    const d = 10;
    const lens = 2 * r * r * Math.acos(d / (2 * r)) - (d / 2) * Math.sqrt(4 * r * r - d * d);
    const c2 = geom(circle(10, 0, 10));
    close(geomArea(booleanGeoms('intersect', [disc, c2])[0]), lens, 2e-3);
    close(geomArea(booleanGeoms('unite', [disc, c2])[0]), 2 * Math.PI * 100 - lens, 2e-3);
    close(geomArea(booleanGeoms('exclude', [disc, c2])[0]), 2 * Math.PI * 100 - 2 * lens, 2e-3);
  });

  it('ignores open subpaths', () => {
    const open: PathGeom = {
      fillRule: 'nonzero',
      subpaths: [{ closed: false, nodes: [{ p: [0, 0] }, { p: [100, 100] }] }],
    };
    close(geomArea(booleanGeoms('unite', [A, open])[0]), 100);
  });
});

describe('paperAdapter clipGeom', () => {
  const sq = geom(rect(0, 0, 10, 10));
  it('fast paths: inside → unchanged, outside → null', () => {
    const inner = geom(rect(2, 2, 3, 3));
    expect(clipGeom(inner, sq)).toEqual(inner);
    expect(clipGeom(geom(rect(20, 20, 3, 3)), sq)).toBeNull();
  });
  it('fill and stroke clipping', () => {
    close(geomArea(clipGeom(geom(circle(0, 0, 10)), sq)!), (Math.PI * 100) / 4);
    const line: PathGeom = {
      fillRule: 'nonzero',
      subpaths: [{ closed: false, nodes: [{ p: [-5, 5] }, { p: [15, 5] }] }],
    };
    const clipped = clipGeom(line, sq, 'stroke')!;
    expect(clipped.subpaths).toHaveLength(1);
    expect(clipped.subpaths[0].closed).toBe(false);
    const xs = clipped.subpaths[0].nodes.map((n) => n.p[0]).sort((a, b) => a - b);
    close(xs[0], 0);
    close(xs[xs.length - 1], 10);
  });
});

describe('paperAdapter node editing', () => {
  it('nearestLocation + insertNodeAt keeps the curve shape exactly', () => {
    const c = geom(circle(0, 0, 10));
    const loc = nearestLocation(c, [8, 8])!;
    close(loc.distance, Math.hypot(8, 8) - 10, 1e-3);
    expect(loc.t).toBeGreaterThan(0);
    expect(loc.t).toBeLessThan(1);
    const { geom: g2, nodeIndex } = insertNodeAt(c, loc);
    const n0 = c.subpaths[0].nodes.length;
    expect(g2.subpaths[0].nodes).toHaveLength(n0 + 1);
    expect(nodeIndex).toBe(loc.segmentIndex + 1);
    const inserted = g2.subpaths[0].nodes[nodeIndex];
    expect(Math.hypot(inserted.p[0] - loc.point[0], inserted.p[1] - loc.point[1])).toBeLessThan(1e-9);
    expect(inserted.smooth).toBe(true);
    expect(maxDeviation(g2, c)).toBeLessThan(1e-6);
    expect(maxDeviation(c, g2)).toBeLessThan(1e-6);
    close(geomArea(g2), geomArea(c), 1e-9);
  });

  it('insertNodeAt on a straight segment and on the closing segment', () => {
    const sq = geom(rect(0, 0, 10, 10));
    const loc = nearestLocation(sq, [-1, 5])!; // closing edge (0,10)→(0,0)
    expect(loc.segmentIndex).toBe(3);
    const { geom: g, nodeIndex } = insertNodeAt(sq, loc);
    expect(nodeIndex).toBe(4);
    expect(g.subpaths[0].nodes[4].p[0]).toBeCloseTo(0, 9);
    expect(g.subpaths[0].nodes[4].p[1]).toBeCloseTo(5, 9);
    expect(g.subpaths[0].nodes[4].in).toBeUndefined();
    close(geomArea(g), 100);
  });

  it('removeNodes, toggleSmooth', () => {
    const sq = geom(rect(0, 0, 10, 10));
    const tri = removeNodes(sq, [{ subpathIndex: 0, nodeIndex: 2 }]);
    close(geomArea(tri), 50);
    expect(
      removeNodes(
        sq,
        [0, 1, 2].map((i) => ({ subpathIndex: 0, nodeIndex: i })),
      ).subpaths,
    ).toHaveLength(0);
    const sm = toggleSmooth(sq, [{ subpathIndex: 0, nodeIndex: 1 }]);
    const n = sm.subpaths[0].nodes[1];
    expect(n.smooth).toBe(true);
    expect(n.in && n.out).toBeTruthy();
    const back = toggleSmooth(sm, [{ subpathIndex: 0, nodeIndex: 1 }]);
    expect(back.subpaths[0].nodes[1]).toEqual({ p: [10, 0] });
  });

  it('reverseGeom flips direction, keeps shape and start node', () => {
    const c = geom(circle(0, 0, 10));
    const r = reverseGeom(c);
    expect(r.subpaths[0].nodes[0].p).toEqual(c.subpaths[0].nodes[0].p);
    getPaper();
    expect((toPaper(r).firstChild as paper.Path).clockwise).toBe(
      !(toPaper(c).firstChild as paper.Path).clockwise,
    );
    expect(maxDeviation(r, c)).toBeLessThan(1e-6);
    expect(reverseGeom(r)).toEqual(c);
    const open = geom('M0 0 C5 0 10 5 10 10');
    const ro = reverseGeom(open);
    expect(ro.subpaths[0].nodes[0].p).toEqual([10, 10]);
    expect(ro.subpaths[0].nodes[0].out).toEqual([0, -5]);
  });

  it('simplifyGeom refits a dense polyline circle within tolerance', () => {
    const pts: Vec2[] = [];
    for (let i = 0; i < 360; i++)
      pts.push([20 * Math.cos((i * Math.PI) / 180), 20 * Math.sin((i * Math.PI) / 180)]);
    const poly: PathGeom = {
      fillRule: 'nonzero',
      subpaths: [{ closed: true, nodes: pts.map((p) => ({ p })) }],
    };
    const s = simplifyGeom(poly, 0.05);
    expect(s.subpaths[0].nodes.length).toBeLessThan(20);
    expect(maxDeviation(s, poly)).toBeLessThan(0.1);
    close(geomArea(s), geomArea(poly), 2e-3);
    // Curved input is flattened first, so simplification of a true circle stays a circle.
    const c = simplifyGeom(geom(circle(0, 0, 10)), 0.05);
    expect(maxDeviation(c, geom(circle(0, 0, 10)))).toBeLessThan(0.1);
  });
});

describe('paperAdapter path operations', () => {
  it('splitSubpaths keeps holes with their outers (both fill rules)', () => {
    const d = rect(0, 0, 30, 30) + rect(10, 10, 10, 10) + rect(13, 13, 4, 4) + rect(50, 0, 10, 10);
    const eo = splitSubpaths(geom(d, 'evenodd'));
    expect(eo).toHaveLength(3);
    const areas = eo.map(geomArea).sort((a, b) => a - b);
    close(areas[0], 16);
    close(areas[1], 100);
    close(areas[2], 900 - 100);
    expect(eo.find((g) => Math.abs(geomArea(g) - 800) < 1e-6)!.subpaths).toHaveLength(2);
    // Nonzero with hole counter-oriented.
    const nz = splitSubpaths(geom(rect(0, 0, 30, 30) + rect(10, 10, 10, 10, true), 'nonzero'));
    expect(nz).toHaveLength(1);
    close(geomArea(nz[0]), 800);
    // Open subpaths become their own pieces.
    const withOpen = splitSubpaths(geom(rect(0, 0, 10, 10) + 'M20 0 L30 0'));
    expect(withOpen).toHaveLength(2);
    // combine is the inverse (area-wise).
    close(geomArea(combine(eo)), 800 + 16 + 100);
  });

  it('closePath / openPath / joinEndpoints', () => {
    const open = geom('M0 0 L10 0 L10 10 L0 0');
    const closed = closePath(open, 0);
    expect(closed.subpaths[0].closed).toBe(true);
    expect(closed.subpaths[0].nodes).toHaveLength(3);
    const reopened = openPath(geom(rect(0, 0, 10, 10)), 0, 2);
    expect(reopened.subpaths[0].closed).toBe(false);
    expect(reopened.subpaths[0].nodes.map((n) => n.p)).toEqual([
      [10, 10],
      [0, 10],
      [0, 0],
      [10, 0],
      [10, 10],
    ]);
    const two = geom('M0 0 L10 0 M20 0 L10 0');
    const joined = joinEndpoints(two, { subpathIndex: 0, end: 'end' }, { subpathIndex: 1, end: 'end' });
    expect(joined.subpaths).toHaveLength(1);
    expect(joined.subpaths[0].nodes.map((n) => n.p)).toEqual([
      [0, 0],
      [10, 0],
      [20, 0],
    ]);
    const gap = joinEndpoints(
      geom('M0 0 L10 0 M20 0 L30 0'),
      { subpathIndex: 0, end: 'start' },
      { subpathIndex: 1, end: 'start' },
    );
    expect(gap.subpaths[0].nodes.map((n) => n.p)).toEqual([
      [10, 0],
      [0, 0],
      [20, 0],
      [30, 0],
    ]);
    const self = joinEndpoints(open, { subpathIndex: 0, end: 'start' }, { subpathIndex: 0, end: 'end' });
    expect(self.subpaths[0].closed).toBe(true);
  });
});

describe('paper-core in a Web Worker (spike)', () => {
  it('runs inside a module Web Worker', async () => {
    const worker = new Worker(new URL('./paperAdapter.spike.worker.ts', import.meta.url), { type: 'module' });
    const result = await new Promise<Record<string, unknown>>((resolve, reject) => {
      worker.onmessage = (e) => resolve(e.data);
      worker.onerror = (e) => reject(new Error(e.message));
      worker.postMessage('go');
    });
    worker.terminate();
    expect(result.error).toBeUndefined();
    expect(result.ok).toBe(true);
    expect(result.hasWindow).toBe(false);
    expect(result.hasDocument).toBe(false);
    close(result.unionArea as number, 175);
    const b = result.circleBounds as { minX: number; maxX: number };
    close(b.minX, -10);
    close(b.maxX, 10);
    expect(result.simplifiedNodes).toBeGreaterThan(2);
  });
});
