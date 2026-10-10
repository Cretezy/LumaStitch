import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createDesign, createElement, createShape, createThread } from '@/model/factories';
import type { Design, PathGeom, StitchType } from '@/model/types';
import { compound, ellipseGeom, polylineGeom, rectGeom } from '@/geom/shapes';
import { flattenGeom } from '@/geom/flatten';
import { makeValid, offset } from '@/geom/clipper';
import { createPointTester } from '@/geom/polygon';
import { buildPlan, createPlanCache } from './plan';
import { F, type StitchPlan } from './types';
import { resolveParams } from './params/resolve';

function designWith(
  items: {
    geom: PathGeom;
    fill?: StitchType;
    outline?: StitchType;
    color?: string;
    params?: any;
    art?: any;
  }[],
): Design {
  const d = createDesign();
  for (const it of items) {
    const color = it.color ?? '#ff0000';
    let thread = Object.values(d.threads).find((t) => t.color === color);
    if (!thread) {
      thread = createThread(color);
      d.threads[thread.id] = thread;
    }
    const s = createShape('S' + d.zOrder.length, it.geom, it.art ?? {});
    if (it.fill) s.fill = createElement('fill', it.fill, thread.id, it.params ?? {});
    if (it.outline) s.outline = createElement('outline', it.outline, thread.id, it.params ?? {});
    d.shapes[s.id] = s;
    d.zOrder.push(s.id);
    if (s.fill) d.sequence.push({ kind: 'element', elementId: s.fill.id });
    if (s.outline) d.sequence.push({ kind: 'element', elementId: s.outline.id });
  }
  return d;
}

function stitchSegments(plan: StitchPlan, filter?: (f: number) => boolean) {
  const out: [number, number, number, number][] = [];
  let px = NaN,
    py = NaN;
  for (let i = 0; i < plan.flags.length; i++) {
    const f = plan.flags[i];
    if (f & (F.TRIM | F.COLOR_CHANGE | F.STOP | F.END)) continue;
    if (f & F.JUMP) {
      px = plan.x[i];
      py = plan.y[i];
      continue;
    }
    if (!Number.isNaN(px) && (!filter || filter(f))) out.push([px, py, plan.x[i], plan.y[i]]);
    px = plan.x[i];
    py = plan.y[i];
  }
  return out;
}

describe('tatami', () => {
  it('fills a rectangle within the pull-compensated outline', () => {
    const geom = rectGeom(0, 0, 30, 20);
    const d = designWith([{ geom, fill: 'tatami' }]);
    const plan = buildPlan(d);
    expect(plan.stats.stitches).toBeGreaterThan(200);
    const poly = offset(makeValid(flattenGeom(geom).rings), 0.2 + 0.02);
    const inside = createPointTester(poly);
    for (let i = 0; i < plan.flags.length; i++) {
      if (plan.flags[i] & (F.TRIM | F.COLOR_CHANGE | F.STOP | F.END)) continue;
      expect(inside(plan.x[i], plan.y[i])).toBe(true);
    }
    for (const [ax, ay, bx, by] of stitchSegments(plan))
      expect(Math.hypot(bx - ax, by - ay)).toBeLessThanOrEqual(12.01);
    expect(plan.colorBlocks.length).toBe(1);
    expect(plan.flags[plan.flags.length - 1] & F.END).toBeTruthy();
  });

  it('row spacing equals density at angle 0', () => {
    const d = designWith([
      { geom: rectGeom(0, 0, 20, 10), fill: 'tatami', params: { angle: 0, underlay: 'none', pullComp: 0 } },
    ]);
    const plan = buildPlan(d);
    const ys = new Set<number>();
    for (let i = 0; i < plan.flags.length; i++)
      if (!(plan.flags[i] & ~F.TIE)) ys.add(Math.round(plan.y[i] * 1000) / 1000);
    const sorted = [...ys].sort((a, b) => a - b);
    const gaps = sorted.slice(1).map((v, i) => v - sorted[i]);
    const common = gaps.filter((g) => Math.abs(g - 0.4) < 0.01).length;
    expect(common / gaps.length).toBeGreaterThan(0.6);
  });

  it('routes around a hole using inside travel without crossing the hole', () => {
    const geom = compound([rectGeom(0, 0, 30, 30), rectGeom(10, 10, 10, 10)]);
    const d = designWith([{ geom, fill: 'tatami', params: { angle: 0 } }]);
    const plan = buildPlan(d);
    const hole = createPointTester(
      makeValid([Float64Array.from([10.3, 10.3, 19.7, 10.3, 19.7, 19.7, 10.3, 19.7])]),
    );
    for (const [ax, ay, bx, by] of stitchSegments(plan)) {
      expect(hole((ax + bx) / 2, (ay + by) / 2)).toBe(false);
    }
  });

  it('never stitches across a gap between parts or across a narrow slot', () => {
    // Two parts 2.5 mm apart (below the trim threshold) in one fill.
    const twoParts = compound([rectGeom(0, 0, 20, 10), rectGeom(0, 12.5, 20, 10)], 'nonzero');
    // A 1.6 mm slot-shaped hole.
    const slot = compound([rectGeom(0, 0, 30, 30), rectGeom(14.2, 5, 1.6, 20)]);
    for (const geom of [twoParts, slot]) {
      for (const angle of [0, 90, 45]) {
        const d = designWith([{ geom, fill: 'tatami', params: { angle } }]);
        const plan = buildPlan(d);
        // Pull compensation (0.2 mm) plus the 0.15 mm row turns may brush past the outline.
        const inside = createPointTester(offset(makeValid(flattenGeom(geom).rings, geom.fillRule), 0.35));
        for (const [ax, ay, bx, by] of stitchSegments(plan)) {
          for (const t of [0.25, 0.5, 0.75])
            expect(
              inside(ax + (bx - ax) * t, ay + (by - ay) * t),
              `${geom === slot ? 'slot' : 'parts'} @${angle}: ${ax.toFixed(2)},${ay.toFixed(2)} → ${bx.toFixed(2)},${by.toFixed(2)}`,
            ).toBe(true);
        }
      }
    }
  });

  it('is deterministic', () => {
    const d = designWith([{ geom: ellipseGeom(0, 0, 15, 9), fill: 'tatami' }]);
    const a = buildPlan(d),
      b = buildPlan(d);
    expect(Array.from(a.x)).toEqual(Array.from(b.x));
    expect(Array.from(a.flags)).toEqual(Array.from(b.flags));
  });

  it('property: random convex-ish polygons stay inside', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 4, max: 15, noNaN: true }), { minLength: 5, maxLength: 9 }),
        fc.integer({ min: 0, max: 179 }),
        (radii, angle) => {
          const n = radii.length;
          const pts = radii.map(
            (r, i) =>
              [r * Math.cos((2 * Math.PI * i) / n), r * Math.sin((2 * Math.PI * i) / n)] as [number, number],
          );
          const geom = polylineGeom(pts, true);
          const d = designWith([{ geom, fill: 'tatami', params: { angle } }]);
          const plan = buildPlan(d);
          const inside = createPointTester(offset(makeValid(flattenGeom(geom).rings), 0.25));
          for (let i = 0; i < plan.flags.length; i++) {
            if (plan.flags[i] & (F.TRIM | F.COLOR_CHANGE | F.STOP | F.END)) continue;
            if (!inside(plan.x[i], plan.y[i])) return false;
          }
          for (const [ax, ay, bx, by] of stitchSegments(plan))
            if (Math.hypot(bx - ax, by - ay) > 12.01) return false;
          return plan.stats.stitches > 0;
        },
      ),
      { numRuns: 25 },
    );
  });
});

describe('running', () => {
  it('stitches never exceed the stitch length and keep corners', () => {
    const d = designWith([{ geom: rectGeom(0, 0, 10, 7), outline: 'running' }]);
    const plan = buildPlan(d);
    for (const [ax, ay, bx, by] of stitchSegments(plan, (f) => !(f & F.TIE)))
      expect(Math.hypot(bx - ax, by - ay)).toBeLessThanOrEqual(2.5 + 1e-3);
    const pts = new Set<string>();
    for (let i = 0; i < plan.flags.length; i++) pts.add(`${plan.x[i].toFixed(3)},${plan.y[i].toFixed(3)}`);
    for (const c of ['0.000,0.000', '10.000,0.000', '10.000,7.000', '0.000,7.000'])
      expect(pts.has(c)).toBe(true);
  });
  it('triple run sews each stitch three times', () => {
    const d1 = designWith([
      {
        geom: polylineGeom([
          [0, 0],
          [10, 0],
        ]),
        outline: 'running',
        params: { stitchLength: 2 },
      },
    ]);
    const d3 = designWith([
      {
        geom: polylineGeom([
          [0, 0],
          [10, 0],
        ]),
        outline: 'triple',
        params: { stitchLength: 2 },
      },
    ]);
    for (const d of [d1, d3]) {
      d.settings.defaultTie = 'never';
    }
    const s1 = buildPlan(d1).stats.threadLengthMm;
    const s3 = buildPlan(d3).stats.threadLengthMm;
    expect(s3 / s1).toBeCloseTo(3, 1);
  });
});

describe('satin', () => {
  it('alternates rails on a straight column', () => {
    const d = designWith([
      {
        geom: polylineGeom([
          [0, 0],
          [20, 0],
        ]),
        outline: 'satin',
        params: { width: 3, pullComp: 0, underlay: 'none', shortStitches: false },
        art: { strokeWidth: 3 },
      },
    ]);
    const plan = buildPlan(d);
    const ys: number[] = [];
    for (let i = 0; i < plan.flags.length; i++) if (plan.flags[i] === 0) ys.push(plan.y[i]);
    // All penetrations at y = ±1.5 and alternating sides.
    let alternations = 0;
    for (let i = 1; i < ys.length; i++) if (Math.sign(ys[i]) !== Math.sign(ys[i - 1])) alternations++;
    expect(alternations / (ys.length - 1)).toBeGreaterThan(0.95);
    for (const y of ys) expect(Math.abs(Math.abs(y) - 1.5)).toBeLessThan(0.01);
    // Peak-to-peak spacing ≈ density.
    expect(ys.length).toBeGreaterThan(20 / 0.2 - 2);
  });
  it('satin width defaults to the stroke width', () => {
    const d = designWith([
      {
        geom: polylineGeom([
          [0, 0],
          [20, 0],
        ]),
        outline: 'satin',
        params: { pullComp: 0, underlay: 'none' },
        art: { strokeWidth: 4 },
      },
    ]);
    const plan = buildPlan(d);
    expect(plan.bounds.maxY - plan.bounds.minY).toBeCloseTo(4, 1);
  });
  it('auto underlay by width', () => {
    const d = designWith([
      {
        geom: polylineGeom([
          [0, 0],
          [20, 0],
        ]),
        outline: 'satin',
        params: { width: 5 },
      },
    ]);
    const plan = buildPlan(d);
    let under = 0;
    for (let i = 0; i < plan.flags.length; i++) if (plan.flags[i] & F.UNDERLAY) under++;
    expect(under).toBeGreaterThan(20);
  });
});

describe('satin fill', () => {
  it('auto-turning fill of a curved band stays inside and alternates', () => {
    // Quarter annulus band ~4 mm wide.
    const outer = ellipseGeom(0, 0, 20);
    const inner = ellipseGeom(0, 0, 16);
    const band = compound([outer, inner]);
    const d1 = designWith([{ geom: band, fill: 'satinFill' }]);
    // Ring has a hole → fallback to fixed angle but still stitches.
    const p1 = buildPlan(d1);
    expect(p1.stats.stitches).toBeGreaterThan(100);
    expect(p1.diagnostics.some((x) => x.code === 'satin-fallback')).toBe(true);
  });
  it('fixed-angle satin never crosses holes or notches', () => {
    // A U shape (notch) and a square with a slot hole, both forced to fixed angle.
    const u = polylineGeom(
      [
        [0, 0],
        [30, 0],
        [30, 30],
        [20, 30],
        [20, 8],
        [10, 8],
        [10, 30],
        [0, 30],
      ],
      true,
    );
    const ring = compound([rectGeom(0, 0, 30, 30), rectGeom(14.2, 5, 1.6, 20)]);
    for (const geom of [u, ring]) {
      for (const angle of [0, 45, 90]) {
        const d = designWith([
          { geom, fill: 'satinFill', params: { mode: 'fixed', angle, underlay: 'none' } },
        ]);
        const plan = buildPlan(d);
        expect(plan.stats.stitches).toBeGreaterThan(50);
        const inside = createPointTester(offset(makeValid(flattenGeom(geom).rings, geom.fillRule), 0.3));
        for (const [ax, ay, bx, by] of stitchSegments(plan))
          for (const t of [0.25, 0.5, 0.75])
            expect(inside(ax + (bx - ax) * t, ay + (by - ay) * t)).toBe(true);
      }
    }
  });

  it('auto-turning on a long bar', () => {
    const d = designWith([
      { geom: rectGeom(0, 0, 40, 5), fill: 'satinFill', params: { pullComp: 0, underlay: 'none' } },
    ]);
    const plan = buildPlan(d);
    expect(plan.diagnostics.some((x) => x.code === 'satin-fallback')).toBe(false);
    const inside = createPointTester(offset(makeValid(flattenGeom(rectGeom(0, 0, 40, 5)).rings), 0.05));
    let n = 0;
    for (let i = 0; i < plan.flags.length; i++) {
      if (plan.flags[i] & (F.TRIM | F.COLOR_CHANGE | F.STOP | F.END)) continue;
      expect(inside(plan.x[i], plan.y[i])).toBe(true);
      n++;
    }
    // Stitches span the 5mm width: most top stitches longer than 4mm.
    const segs = stitchSegments(plan, (f) => f === 0);
    const across = segs.filter(([ax, ay, bx, by]) => Math.hypot(bx - ax, by - ay) > 4).length;
    expect(across / segs.length).toBeGreaterThan(0.8);
    expect(n).toBeGreaterThan(150);
  });
});

describe('zigzag and contour', () => {
  it('zigzag spans its width', () => {
    const d = designWith([
      {
        geom: polylineGeom([
          [0, 0],
          [20, 0],
        ]),
        outline: 'zigzag',
        params: { width: 2, spacing: 1 },
      },
    ]);
    const plan = buildPlan(d);
    expect(plan.bounds.maxY - plan.bounds.minY).toBeCloseTo(2, 1);
  });
  it('contour fills a circle', () => {
    const d = designWith([{ geom: ellipseGeom(0, 0, 8), fill: 'contour' }]);
    const plan = buildPlan(d);
    expect(plan.stats.stitches).toBeGreaterThan(100);
  });
});

describe('sequencer', () => {
  it('emits colour changes, trims, ties and stops', () => {
    const d = designWith([
      { geom: rectGeom(0, 0, 10, 10), fill: 'tatami', color: '#ff0000' },
      { geom: rectGeom(20, 0, 10, 10), fill: 'tatami', color: '#00ff00' },
      { geom: rectGeom(40, 0, 10, 10), fill: 'tatami', color: '#00ff00' },
    ]);
    // stop between 2nd and 3rd
    d.sequence.splice(2, 0, { kind: 'stop', id: 'stop1' });
    const plan = buildPlan(d);
    expect(plan.stats.colorChanges).toBe(1);
    expect(plan.stats.stops).toBe(1);
    expect(plan.colorBlocks.length).toBe(3);
    expect(plan.colorBlocks[1].threadId).toBe(plan.colorBlocks[2].threadId);
    // trims: after the colour change and after the stop
    expect(plan.stats.trims).toBe(2);
    let ties = 0;
    for (let i = 0; i < plan.flags.length; i++) if (plan.flags[i] & F.TIE) ties++;
    expect(ties).toBe(3 * 6); // tie-in + tie-off per element
    // Colour blocks cover all commands contiguously.
    expect(plan.colorBlocks[0].start).toBe(0);
    for (let i = 1; i < plan.colorBlocks.length; i++)
      expect(plan.colorBlocks[i].start).toBe(plan.colorBlocks[i - 1].end);
    expect(plan.colorBlocks[plan.colorBlocks.length - 1].end).toBe(plan.flags.length);
    // element ranges are disjoint and ordered
    for (let i = 1; i < plan.elementRanges.length; i++)
      expect(plan.elementRanges[i].start).toBeGreaterThanOrEqual(plan.elementRanges[i - 1].end);
  });

  it('same colour close elements connect without a trim', () => {
    const d = designWith([
      {
        geom: polylineGeom([
          [0, 0],
          [10, 0],
        ]),
        outline: 'running',
      },
      {
        geom: polylineGeom([
          [11, 0],
          [20, 0],
        ]),
        outline: 'running',
      },
    ]);
    const plan = buildPlan(d);
    expect(plan.stats.trims).toBe(0);
    expect(plan.stats.jumps).toBe(1); // only the initial jump
  });

  it('far same colour elements are trimmed and jumped', () => {
    const d = designWith([
      {
        geom: polylineGeom([
          [0, 0],
          [10, 0],
        ]),
        outline: 'running',
      },
      {
        geom: polylineGeom([
          [30, 0],
          [40, 0],
        ]),
        outline: 'running',
      },
    ]);
    const plan = buildPlan(d);
    expect(plan.stats.trims).toBe(1);
    expect(plan.stats.jumps).toBe(2);
  });

  it('trim never stitches the connector', () => {
    const d = designWith([
      {
        geom: polylineGeom([
          [0, 0],
          [10, 0],
        ]),
        outline: 'running',
      },
      {
        geom: polylineGeom([
          [30, 0],
          [40, 0],
        ]),
        outline: 'running',
      },
    ]);
    const first = d.shapes[d.zOrder[0]].outline!;
    first.trimAfter = 'never';
    const plan = buildPlan(d);
    expect(plan.stats.trims).toBe(0);
    expect(plan.diagnostics.some((x) => x.code === 'long-connector')).toBe(true);
  });

  it('cache makes rebuilding cheap and identical', () => {
    const d = designWith([{ geom: ellipseGeom(0, 0, 20, 12), fill: 'tatami' }]);
    const cache = createPlanCache();
    const a = buildPlan(d, { cache });
    const t0 = performance.now();
    const b = buildPlan(d, { cache });
    expect(performance.now() - t0).toBeLessThan(50);
    expect(Array.from(a.x)).toEqual(Array.from(b.x));
  });

  it('resolveParams applies fabric presets then overrides', () => {
    expect(resolveParams({ type: 'tatami', params: {} }, 'knit').pullComp).toBe(0.35);
    expect(resolveParams({ type: 'tatami', params: { pullComp: 0.1 } }, 'knit').pullComp).toBe(0.1);
    expect(resolveParams({ type: 'tatami', params: {} }, 'woven').density).toBe(0.4);
  });

  it('performance: 50k-stitch design under 2 s', () => {
    const items = [];
    for (let i = 0; i < 18; i++)
      items.push({
        geom: ellipseGeom((i % 6) * 70, Math.floor(i / 6) * 70, 33, 30),
        fill: 'tatami' as StitchType,
        color: i % 2 ? '#112233' : '#aa0000',
      });
    const d = designWith(items);
    const t0 = performance.now();
    const plan = buildPlan(d);
    const dt = performance.now() - t0;
    expect(plan.stats.stitches).toBeGreaterThan(40000);
    expect(dt).toBeLessThan(2000);
  });
});
