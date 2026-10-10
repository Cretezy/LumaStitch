import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createDesign, createElement, createShape, createThread } from '@/model/factories';
import type { Design, PathGeom, StitchType } from '@/model/types';
import { compound, ellipseGeom, polylineGeom, rectGeom } from '@/geom/shapes';
import { flattenGeom } from '@/geom/flatten';
import { makeValid, offset } from '@/geom/clipper';
import { createPointTester } from '@/geom/polygon';
import { MC, readPes, writePes } from '@/io/pes';
import { buildPlan } from '../plan';
import { resolveParams } from '../params/resolve';
import { getStitchType, stitchTypesFor } from '../registry';
import { F, type StitchPlan } from '../types';
import { gradientRows } from './gradientFill';
import { patternPhase } from './patternFill';

const FILLS: StitchType[] = ['meander', 'ripple', 'gradientFill', 'patternFill', 'crossStitch', 'applique'];
const OUTLINES: StitchType[] = ['motifRun', 'blanket', 'manual'];
const CMD = F.TRIM | F.COLOR_CHANGE | F.STOP | F.END;

function designWith(
  items: { geom: PathGeom; fill?: StitchType; outline?: StitchType; color?: string; params?: any }[],
): Design {
  const d = createDesign();
  for (const it of items) {
    const color = it.color ?? '#ff0000';
    let thread = Object.values(d.threads).find((t) => t.color === color);
    if (!thread) {
      thread = createThread(color);
      d.threads[thread.id] = thread;
    }
    const s = createShape('S' + d.zOrder.length, it.geom, { strokeWidth: 2 });
    if (it.fill) s.fill = createElement('fill', it.fill, thread.id, it.params ?? {});
    if (it.outline) s.outline = createElement('outline', it.outline, thread.id, it.params ?? {});
    d.shapes[s.id] = s;
    d.zOrder.push(s.id);
    if (s.fill) d.sequence.push({ kind: 'element', elementId: s.fill.id });
    if (s.outline) d.sequence.push({ kind: 'element', elementId: s.outline.id });
  }
  return d;
}

function one(
  geom: PathGeom,
  type: StitchType,
  params: any = {},
  ties = true,
): { d: Design; plan: StitchPlan } {
  const role = getStitchType(type).role;
  const d = designWith([{ geom, [role]: type, params }]);
  if (!ties) d.settings.defaultTie = 'never';
  return { d, plan: buildPlan(d) };
}

/** Sewn segments (stitches after a jump start a new polyline). */
function segments(plan: StitchPlan, filter?: (f: number) => boolean) {
  const out: [number, number, number, number][] = [];
  let px = NaN,
    py = NaN;
  for (let i = 0; i < plan.flags.length; i++) {
    const f = plan.flags[i];
    if (f & CMD) continue;
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

function penetrations(plan: StitchPlan, filter?: (f: number) => boolean): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < plan.flags.length; i++) {
    const f = plan.flags[i];
    if (f & (CMD | F.JUMP)) continue;
    if (!filter || filter(f)) out.push([plan.x[i], plan.y[i]]);
  }
  return out;
}

const withHole = () => compound([rectGeom(0, 0, 30, 30), rectGeom(10, 10, 10, 10)]);
const uShape = () =>
  polylineGeom(
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

/** Checks the fill containment contract; returns a failure message or null. */
function fillViolation(geom: PathGeom, type: StitchType, params: any = {}): string | null {
  const { d, plan } = one(geom, type, params);
  if (plan.diagnostics.some((x) => x.code === 'generator-failed')) return 'generator failed';
  if (plan.stats.stitches === 0) return 'no stitches';
  const el = Object.values(d.shapes)[0].fill!;
  const pull = Number(resolveParams(el, d.fabric).pullComp ?? 0) || 0;
  const inside = createPointTester(offset(makeValid(flattenGeom(geom).rings, geom.fillRule), pull + 0.3));
  for (const [x, y] of penetrations(plan))
    if (!inside(x, y)) return `penetration outside at ${x.toFixed(2)},${y.toFixed(2)}`;
  for (const [ax, ay, bx, by] of segments(plan)) {
    const l = Math.hypot(bx - ax, by - ay);
    if (l > 12.01) return `stitch of ${l.toFixed(2)} mm`;
    for (const t of [0.25, 0.5, 0.75])
      if (!inside(ax + (bx - ax) * t, ay + (by - ay) * t))
        return `stitch crosses outside: ${ax.toFixed(2)},${ay.toFixed(2)} → ${bx.toFixed(2)},${by.toFixed(2)}`;
  }
  return null;
}

describe('P2 registry and parameters', () => {
  it('registers every P2 type for its role with complete ParamDefs', () => {
    const fills = stitchTypesFor('fill').map((d) => d.id);
    const outlines = stitchTypesFor('outline').map((d) => d.id);
    for (const t of FILLS) expect(fills).toContain(t);
    for (const t of OUTLINES) expect(outlines).toContain(t);
    for (const t of [...FILLS, ...OUTLINES]) {
      const def = getStitchType(t);
      expect(def.label.length).toBeGreaterThan(0);
      expect(def.description.length).toBeGreaterThan(10);
      for (const p of def.params) {
        expect(p.label, `${t}.${p.key}`).toBeTruthy();
        expect(def.defaults[p.key], `${t}.${p.key} default`).not.toBeUndefined();
        if (p.kind === 'enum') {
          expect(p.options?.length, `${t}.${p.key}`).toBeGreaterThan(1);
          expect(p.options!.map((o) => o.value)).toContain(def.defaults[p.key]);
        }
        if (p.kind === 'length' || p.kind === 'number' || p.kind === 'angle' || p.kind === 'fraction') {
          expect(p.min, `${t}.${p.key}`).toBeTypeOf('number');
          expect(p.max, `${t}.${p.key}`).toBeTypeOf('number');
          expect(p.step, `${t}.${p.key}`).toBeTypeOf('number');
          const v = def.defaults[p.key];
          if (typeof v === 'number') {
            expect(v).toBeGreaterThanOrEqual(p.min!);
            expect(v).toBeLessThanOrEqual(p.max!);
          }
        }
      }
    }
  });
});

describe('P2 fills: containment, limits, determinism, degenerate input', () => {
  const shapes: [string, () => PathGeom][] = [
    ['rect', () => rectGeom(0, 0, 30, 20)],
    ['ellipse', () => ellipseGeom(0, 0, 18, 11)],
    ['hole', withHole],
    ['notch', uShape],
  ];
  for (const type of FILLS)
    for (const [name, g] of shapes)
      it(`${type} stays inside: ${name}`, () => {
        expect(fillViolation(g(), type)).toBeNull();
      });

  it('stay inside for random star-ish polygons (property)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 5, max: 16, noNaN: true }), { minLength: 5, maxLength: 9 }),
        fc.constantFrom(...FILLS),
        fc.integer({ min: 0, max: 179 }),
        (radii, type, angle) => {
          const n = radii.length;
          const pts = radii.map(
            (r, i) =>
              [r * Math.cos((2 * Math.PI * i) / n), r * Math.sin((2 * Math.PI * i) / n)] as [number, number],
          );
          const v = fillViolation(polylineGeom(pts, true), type, { angle, seed: angle });
          if (v) throw new Error(`${type}: ${v}`);
          return true;
        },
      ),
      { numRuns: 30 },
    );
  });

  for (const type of FILLS) {
    it(`${type} is deterministic`, () => {
      const a = one(ellipseGeom(0, 0, 15, 9), type).plan;
      const b = one(ellipseGeom(0, 0, 15, 9), type).plan;
      expect(Array.from(a.x)).toEqual(Array.from(b.x));
      expect(Array.from(a.y)).toEqual(Array.from(b.y));
      expect(Array.from(a.flags)).toEqual(Array.from(b.flags));
    });

    it(`${type} handles degenerate input without throwing`, () => {
      const open = polylineGeom([
        [0, 0],
        [20, 5],
      ]);
      const empty: PathGeom = { fillRule: 'nonzero', subpaths: [] };
      const lone: PathGeom = { fillRule: 'nonzero', subpaths: [{ closed: true, nodes: [{ p: [1, 1] }] }] };
      for (const g of [rectGeom(0, 0, 0.2, 0.2), rectGeom(0, 0, 1, 0), open, empty, lone]) {
        const { plan } = one(g, type);
        expect(plan.diagnostics.filter((x) => x.code === 'generator-failed')).toEqual([]);
      }
      // Open paths never produce fill stitches.
      expect(one(open, type).plan.stats.stitches).toBe(0);
    });

    it(`${type}: 60×60 mm shape in under 300 ms`, () => {
      const geom = compound([rectGeom(0, 0, 60, 60), ellipseGeom(30, 30, 8)]);
      one(rectGeom(0, 0, 5, 5), type); // warm-up (module init, JIT)
      const t0 = performance.now();
      const { plan } = one(geom, type);
      const dt = performance.now() - t0;
      expect(plan.stats.stitches).toBeGreaterThan(100);
      expect(dt).toBeLessThan(300);
    });
  }
});

describe('P2 outlines', () => {
  const paths: [string, () => PathGeom][] = [
    ['rect', () => rectGeom(0, 0, 30, 20)],
    ['circle', () => ellipseGeom(0, 0, 15)],
    [
      'open',
      () =>
        polylineGeom([
          [0, 0],
          [20, 0],
          [30, 10],
        ]),
    ],
  ];
  for (const type of OUTLINES) {
    for (const [name, g] of paths)
      it(`${type} on ${name}: stitches within limits and deterministic`, () => {
        const a = one(g(), type).plan;
        const b = one(g(), type).plan;
        expect(a.stats.stitches).toBeGreaterThan(3);
        for (const [ax, ay, bx, by] of segments(a))
          expect(Math.hypot(bx - ax, by - ay)).toBeLessThanOrEqual(12.01);
        expect(Array.from(a.x)).toEqual(Array.from(b.x));
        expect(Array.from(a.flags)).toEqual(Array.from(b.flags));
      });
    it(`${type} handles degenerate input without throwing`, () => {
      const geoms: PathGeom[] = [
        { fillRule: 'nonzero', subpaths: [] },
        { fillRule: 'nonzero', subpaths: [{ closed: false, nodes: [{ p: [1, 1] }] }] },
        polylineGeom([
          [0, 0],
          [0, 0],
        ]),
        rectGeom(0, 0, 0.1, 0.1),
      ];
      for (const g of geoms) {
        const { plan } = one(g, type);
        expect(plan.diagnostics.filter((x) => x.code === 'generator-failed')).toEqual([]);
      }
    });
  }

  it('motif run follows a curved path', () => {
    const R = 20,
      size = 4;
    for (const motif of ['triangle', 'wave', 'diamond', 'arrow', 'heart', 'scallop']) {
      const { plan } = one(ellipseGeom(0, 0, R), 'motifRun', { motif, size, spacing: 1 });
      const pts = penetrations(plan, (f) => !(f & F.TIE));
      expect(pts.length).toBeGreaterThan(50);
      let maxDev = 0;
      const sectors = new Set<number>();
      for (const [x, y] of pts) {
        const dev = Math.hypot(x, y) - R;
        // Motifs stay within half their size of the circle, on one side.
        expect(Math.abs(dev), motif).toBeLessThanOrEqual(size / 2 + 0.1);
        maxDev = Math.max(maxDev, Math.abs(dev));
        sectors.add(Math.floor(((Math.atan2(y, x) + Math.PI) / (2 * Math.PI)) * 36));
      }
      // The motif rises off the path and is repeated all the way round.
      expect(maxDev, motif).toBeGreaterThan(size * 0.4);
      expect(sectors.size, motif).toBe(36);
    }
    // Flip moves the motif to the other side of the path.
    const sideOf = (flip: boolean) => {
      const { plan } = one(ellipseGeom(0, 0, R), 'motifRun', { motif: 'triangle', size, flip });
      return Math.sign(penetrations(plan).reduce((a, [x, y]) => a + (Math.hypot(x, y) - R), 0));
    };
    expect(sideOf(true)).toBe(-sideOf(false));
  });

  it('motif run repeats a whole number of motifs along an open path', () => {
    const { plan } = one(
      polylineGeom([
        [0, 0],
        [50, 0],
      ]),
      'motifRun',
      { motif: 'triangle', size: 4, spacing: 1, stitchLength: 10 },
    );
    // Peaks of the triangles: penetrations at |y| = 2.
    const peaks = penetrations(plan).filter(([, y]) => Math.abs(Math.abs(y) - 2) < 1e-3);
    expect(peaks.length).toBe(10);
  });

  it('blanket prongs are perpendicular, evenly spaced and on the requested side', () => {
    const line = polylineGeom([
      [0, 0],
      [20, 0],
    ]);
    for (const [side, sign] of [
      ['left', -1],
      ['right', 1],
    ] as const) {
      const { plan } = one(line, 'blanket', { spacing: 2.5, width: 3, side }, false);
      const tips = penetrations(plan).filter(([, y]) => Math.abs(y) > 1e-6);
      expect(tips.length).toBe(9); // 8 steps of 2.5 mm → 9 prongs
      for (const [x, y] of tips) {
        expect(y).toBeCloseTo(3 * sign, 6);
        expect((x / 2.5) % 1).toBeCloseTo(0, 6);
      }
    }
    // Inside on a closed square: every tip lies inside the square.
    const { plan } = one(rectGeom(0, 0, 20, 20), 'blanket', { side: 'inside', width: 2 });
    const tips = penetrations(plan).filter(([x, y]) => x > 0.01 && x < 19.99 && y > 0.01 && y < 19.99);
    expect(tips.length).toBeGreaterThan(20);
    const outside = penetrations(plan).filter(([x, y]) => x < -0.01 || x > 20.01 || y < -0.01 || y > 20.01);
    expect(outside).toEqual([]);
  });

  it('manual reproduces the node positions in order', () => {
    const nodes: [number, number][] = [
      [0, 0],
      [3, 1],
      [5, 6],
      [9, 2],
      [14, 4],
    ];
    const d = designWith([{ geom: polylineGeom(nodes), outline: 'manual' }]);
    d.settings.defaultTie = 'never';
    const plan = buildPlan(d);
    const pts = penetrations(plan).map(([x, y]) => [
      Math.round(x * 1000) / 1000,
      Math.round(y * 1000) / 1000,
    ]);
    expect(pts).toEqual(nodes);
    // Splitting long stitches adds even penetrations between the nodes.
    const d2 = designWith([
      {
        geom: polylineGeom([
          [0, 0],
          [10, 0],
        ]),
        outline: 'manual',
        params: { splitLong: true, maxLength: 3 },
      },
    ]);
    d2.settings.defaultTie = 'never';
    const xs = penetrations(buildPlan(d2)).map(([x]) => x);
    expect(xs).toEqual([0, 2.5, 5, 7.5, 10]);
  });
});

describe('P2 fills: specific behaviour', () => {
  it('gradient row spacing changes across the shape', () => {
    const ys = gradientRows(0, 40, 0.4, 2);
    const gaps = ys.slice(1).map((y, i) => y - ys[i]);
    expect(gaps[0]).toBeCloseTo(0.4, 1);
    expect(gaps[gaps.length - 1]).toBeGreaterThan(1.8);
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]).toBeGreaterThan(gaps[i - 1] - 1e-9);
    // In a plan: rows at angle 0 get sparser from top to bottom.
    const { plan } = one(rectGeom(0, 0, 30, 40), 'gradientFill', {
      angle: 0,
      densityStart: 0.4,
      densityEnd: 2,
      pullComp: 0,
    });
    const rowYs = [
      ...new Set(penetrations(plan, (f) => f === 0).map(([, y]) => Math.round(y * 1000) / 1000)),
    ].sort((a, b) => a - b);
    const g = rowYs.slice(1).map((y, i) => y - rowYs[i]);
    const head = g.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
    const tail = g.slice(-5).reduce((a, b) => a + b, 0) / 5;
    expect(head).toBeLessThan(0.6);
    expect(tail).toBeGreaterThan(1.5);
  });

  it('pattern fill phases differ by pattern and wave rows undulate', () => {
    const brick = patternPhase('brick', 4, 0);
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8].map(brick)).toEqual([0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5, 0]);
    const herring = patternPhase('herringbone', 4, 0);
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8].map(herring)).toEqual([0, 0.25, 0.5, 0.75, 1, 0.75, 0.5, 0.25, 0]);
    const key = (pattern: string) => {
      const { plan } = one(rectGeom(0, 0, 30, 20), 'patternFill', { pattern, angle: 0, underlay: 'none' });
      return penetrations(plan, (f) => f === 0)
        .map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`)
        .sort()
        .join(';');
    };
    const sets = ['brick', 'diagonal', 'herringbone', 'wave'].map(key);
    expect(new Set(sets).size).toBe(4);
    // Wave: points of one row (same row index) vary in y by about twice the amplitude.
    const { plan } = one(rectGeom(0, 0, 60, 20), 'patternFill', {
      pattern: 'wave',
      angle: 0,
      underlay: 'none',
      waveAmplitude: 2,
      waveLength: 12,
      pullComp: 0,
    });
    const segs = segments(plan, (f) => f === 0).filter(([ax, , bx]) => Math.abs(bx - ax) > 0.2);
    const slopes = segs.map(([ax, ay, bx, by]) => Math.abs((by - ay) / (bx - ax)));
    expect(Math.max(...slopes)).toBeGreaterThan(0.5);
  });

  it('meander is seeded, smooth and never crosses itself', () => {
    const geom = ellipseGeom(0, 0, 12, 9);
    const a = one(geom, 'meander', { seed: 1 }).plan;
    const b = one(geom, 'meander', { seed: 2 }).plan;
    expect(Array.from(a.x)).not.toEqual(Array.from(b.x));
    const segs = segments(a, (f) => f === 0);
    const cross = (s: number[], t: number[]) => {
      const o = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) =>
        Math.sign((bx - ax) * (cy - ay) - (by - ay) * (cx - ax));
      return (
        o(s[0], s[1], s[2], s[3], t[0], t[1]) * o(s[0], s[1], s[2], s[3], t[2], t[3]) < 0 &&
        o(t[0], t[1], t[2], t[3], s[0], s[1]) * o(t[0], t[1], t[2], t[3], s[2], s[3]) < 0
      );
    };
    let crossings = 0;
    for (let i = 0; i < segs.length; i++)
      for (let j = i + 2; j < segs.length; j++) if (cross(segs[i], segs[j])) crossings++;
    expect(crossings).toBe(0);
    expect(a.stats.trims).toBe(0);
  });

  it('ripple is one continuous spiral on a simple shape (no trims)', () => {
    const { plan } = one(ellipseGeom(0, 0, 20, 14), 'ripple');
    expect(plan.stats.trims).toBe(0);
    expect(plan.stats.jumps).toBe(1); // the initial jump only
    expect(plan.stats.stitches).toBeGreaterThan(300);
    // The radius decreases (on average) along the sewing order: it spirals inward.
    const pts = penetrations(plan, (f) => f === 0);
    const r = (p: [number, number]) => Math.hypot(p[0] / 20, p[1] / 14);
    const q = Math.floor(pts.length / 4);
    expect(r(pts[q])).toBeGreaterThan(r(pts[3 * q]));
  });

  it('ripple, meander and cross stitch never stitch across a hole', () => {
    const geom = compound([rectGeom(0, 0, 40, 30), ellipseGeom(20, 15, 6), rectGeom(5, 5, 4, 20)]);
    const hole1 = createPointTester(offset(makeValid(flattenGeom(ellipseGeom(20, 15, 6)).rings), -0.35));
    const hole2 = createPointTester(
      makeValid([Float64Array.from([5.35, 5.35, 8.65, 5.35, 8.65, 24.65, 5.35, 24.65])]),
    );
    for (const type of ['ripple', 'meander', 'crossStitch'] as StitchType[]) {
      expect(fillViolation(geom, type), type).toBeNull();
      const { plan } = one(geom, type);
      for (const [ax, ay, bx, by] of segments(plan))
        for (const t of [0.1, 0.3, 0.5, 0.7, 0.9]) {
          const x = ax + (bx - ax) * t,
            y = ay + (by - ay) * t;
          expect(hole1(x, y) || hole2(x, y), `${type} at ${x.toFixed(2)},${y.toFixed(2)}`).toBe(false);
        }
    }
  });

  it('cross stitch sews complete X cells on the grid', () => {
    const { plan } = one(rectGeom(0, 0, 10, 5), 'crossStitch', { cellSize: 2.5 }, false);
    const top = segments(plan, (f) => f === 0 || f === F.TRAVEL);
    // Every penetration is a grid corner.
    for (const [x, y] of penetrations(plan, (f) => !(f & F.TIE))) {
      expect((x / 2.5) % 1).toBeCloseTo(0, 6);
      expect((y / 2.5) % 1).toBeCloseTo(0, 6);
    }
    // Both diagonals of each of the 4 × 2 cells are sewn.
    const diag = new Set<string>();
    for (const [ax, ay, bx, by] of top) {
      if (Math.abs(Math.abs(bx - ax) - 2.5) > 1e-6 || Math.abs(Math.abs(by - ay) - 2.5) > 1e-6) continue;
      const cx = Math.min(ax, bx),
        cy = Math.min(ay, by);
      const slope = Math.sign((bx - ax) * (by - ay));
      diag.add(`${cx},${cy},${slope}`);
    }
    expect(diag.size).toBe(16);
  });

  it('appliqué emits exactly two stops in one thread and they survive a PES round trip', () => {
    const d = designWith([{ geom: ellipseGeom(0, 0, 20, 15), fill: 'applique' }]);
    const plan = buildPlan(d);
    expect(plan.stats.stops).toBe(2);
    expect(plan.stats.colorChanges).toBe(0);
    expect(plan.colorBlocks.length).toBe(3);
    expect(new Set(plan.colorBlocks.map((b) => b.threadId)).size).toBe(1);
    // Blocks are contiguous and split right after each STOP.
    expect(plan.colorBlocks[0].start).toBe(0);
    for (let i = 1; i < plan.colorBlocks.length; i++) {
      expect(plan.colorBlocks[i].start).toBe(plan.colorBlocks[i - 1].end);
      expect(plan.flags[plan.colorBlocks[i].start - 1] & F.STOP).toBeTruthy();
    }
    expect(plan.colorBlocks[2].end).toBe(plan.flags.length);
    // The element owns everything from its first stitch to its last, including the stops.
    expect(plan.elementRanges.length).toBe(1);
    const stops = [...plan.flags.keys()].filter((i) => plan.flags[i] & F.STOP);
    for (const i of stops) {
      expect(i).toBeGreaterThanOrEqual(plan.elementRanges[0].start);
      expect(i).toBeLessThan(plan.elementRanges[0].end);
      // tie-off before, trim + jump after, then a tie-in
      expect(plan.flags[i - 1] & F.TIE).toBeTruthy();
      expect(plan.flags[i + 1]).toBe(F.TRIM);
      expect(plan.flags[i + 2]).toBe(F.JUMP);
      expect(plan.flags[i + 4] & F.TIE).toBeTruthy();
    }
    expect(plan.stats.trims).toBe(2);
    // Phases: placement, tack-down, cover — the cover is denser than the others.
    const counts = [0, 0, 0];
    for (let b = 0; b < 3; b++)
      for (let i = plan.colorBlocks[b].start; i < plan.colorBlocks[b].end; i++)
        if (plan.flags[i] === 0) counts[b]++;
    expect(counts[2]).toBeGreaterThan(counts[1]);
    expect(counts[1]).toBeGreaterThan(0);
    expect(counts[0]).toBeGreaterThan(0);

    const r = readPes(writePes(plan, d, { version: 6 }));
    expect(r.stopCount).toBe(2);
    expect(r.colorChangeCount).toBe(0);
    expect(r.stitchCount).toBe(plan.stats.stitches);
    expect(r.commands.filter((c) => c.cmd === MC.STOP).length).toBe(2);
  });

  it('appliqué stops combine with sequence stops and colour changes', () => {
    const d = designWith([
      { geom: rectGeom(0, 0, 20, 20), fill: 'tatami', color: '#ff0000' },
      { geom: ellipseGeom(40, 10, 10), fill: 'applique', color: '#00ff00' },
      { geom: rectGeom(60, 0, 10, 10), fill: 'tatami', color: '#00ff00' },
    ]);
    d.sequence.splice(2, 0, { kind: 'stop', id: 'st' });
    const plan = buildPlan(d);
    expect(plan.stats.colorChanges).toBe(1);
    expect(plan.stats.stops).toBe(3);
    expect(plan.colorBlocks.length).toBe(5);
    for (let i = 1; i < plan.elementRanges.length; i++)
      expect(plan.elementRanges[i].start).toBeGreaterThanOrEqual(plan.elementRanges[i - 1].end);
    for (let i = 1; i < plan.colorBlocks.length; i++)
      expect(plan.colorBlocks[i].start).toBe(plan.colorBlocks[i - 1].end);
    expect(plan.colorBlocks[plan.colorBlocks.length - 1].end).toBe(plan.flags.length);
  });
});
