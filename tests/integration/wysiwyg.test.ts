import { describe, expect, it } from 'vitest';
import { createDesign, createElement, createShape, createThread } from '@/model/factories';
import { ellipseGeom, polylineGeom, rectGeom } from '@/geom/shapes';
import { buildPlan } from '@/engine/plan';
import { F, type StitchPlan } from '@/engine/types';
import { MC, readPes, writePes } from '@/io/pes';
import type { Design, PathGeom, StitchType } from '@/model/types';

function design(
  items: { geom: PathGeom; fill?: StitchType; outline?: StitchType; color: string; params?: any }[],
): Design {
  const d = createDesign({ name: 'Logo' });
  for (const it of items) {
    let t = Object.values(d.threads).find((x) => x.color === it.color);
    if (!t) {
      t = createThread(it.color);
      d.threads[t.id] = t;
    }
    const s = createShape('s', it.geom, { strokeWidth: 2 });
    if (it.fill) s.fill = createElement('fill', it.fill, t.id, it.params ?? {});
    if (it.outline) s.outline = createElement('outline', it.outline, t.id, it.params ?? {});
    d.shapes[s.id] = s;
    d.zOrder.push(s.id);
    for (const el of [s.fill, s.outline]) if (el) d.sequence.push({ kind: 'element', elementId: el.id });
  }
  return d;
}

/** The machine command sequence the simulator plays, in 0.1 mm units. */
function simulatorCommands(plan: StitchPlan) {
  const out: { x: number; y: number; cmd: number }[] = [];
  for (let i = 0; i < plan.flags.length; i++) {
    const f = plan.flags[i];
    const cmd =
      f & F.END
        ? MC.END
        : f & F.COLOR_CHANGE
          ? MC.COLOR_CHANGE
          : f & F.STOP
            ? MC.STOP
            : f & F.TRIM
              ? MC.TRIM
              : f & F.JUMP
                ? MC.JUMP
                : MC.STITCH;
    out.push({ x: Math.round(plan.x[i] * 10) || 0, y: Math.round(plan.y[i] * 10) || 0, cmd });
  }
  return out;
}

const logo = () =>
  design([
    { geom: ellipseGeom(0, 0, 25, 20), fill: 'tatami', color: '#d62828' },
    { geom: rectGeom(-10, -4, 20, 8), fill: 'satinFill', color: '#003049' },
    { geom: ellipseGeom(0, 0, 25, 20), outline: 'satin', color: '#003049', params: { width: 2 } },
    {
      geom: polylineGeom([
        [-20, 25],
        [20, 25],
      ]),
      outline: 'triple',
      color: '#f77f00',
    },
  ]);

describe('WYSIWYG: plan → PES → read back', () => {
  for (const version of [1, 6] as const) {
    it(`v${version}: stats and command sequence match`, () => {
      const d = logo();
      d.sequence.splice(3, 0, { kind: 'stop', id: 'st' });
      const plan = buildPlan(d);
      const bytes = writePes(plan, d, { version });
      const r = readPes(bytes);
      expect(r.stitchCount).toBe(plan.stats.stitches);
      expect(r.colorChangeCount + r.stopCount).toBe(plan.stats.colorChanges + plan.stats.stops);
      expect(r.colors.length).toBe(plan.colorBlocks.length);
      const sim = simulatorCommands(plan).filter((c) => c.cmd !== MC.END);
      const read = r.commands.filter((c) => c.cmd !== MC.END);
      // Compare relative to the first command (PES coordinates may be re-origined).
      const ox = read[0].x - sim[0].x,
        oy = read[0].y - sim[0].y;
      const A = read.map((c) => [c.x - ox || 0, c.y - oy || 0, c.cmd]);
      const B = sim.map((c) => [c.x, c.y, c.cmd]);
      const first = A.findIndex((a, i) => JSON.stringify(a) !== JSON.stringify(B[i]));
      if (first >= 0)
        console.log(
          'diverge at',
          first,
          JSON.stringify(A.slice(first - 3, first + 4)),
          JSON.stringify(B.slice(first - 3, first + 4)),
        );
      if (A.length !== B.length)
        console.log('tails', JSON.stringify(A.slice(-4)), JSON.stringify(B.slice(-4)));
      expect(A).toEqual(B);
      const b = r.bounds;
      expect((b.maxX - b.minX) / 10).toBeCloseTo(plan.bounds.maxX - plan.bounds.minX, 0);
    });
  }
});

describe('WYSIWYG: appliqué machine stops survive plan → PES → read back', () => {
  const applique = () => {
    const d = design([
      { geom: rectGeom(-30, -10, 20, 20), fill: 'tatami', color: '#d62828' },
      { geom: ellipseGeom(10, 0, 15, 12), fill: 'applique', color: '#003049', params: { width: 2.5 } },
      { geom: ellipseGeom(10, 0, 15, 12), outline: 'running', color: '#003049' },
      { geom: rectGeom(30, -5, 10, 10), fill: 'patternFill', color: '#003049' },
    ]);
    // A sequence stop as well, so element stops and sequence stops are mixed.
    d.sequence.splice(3, 0, { kind: 'stop', id: 'st' });
    return d;
  };
  for (const version of [1, 6] as const) {
    it(`v${version}: stops, colour blocks and command sequence match`, () => {
      const d = applique();
      const plan = buildPlan(d);
      expect(plan.stats.stops).toBe(3); // two appliqué stops + one sequence stop
      expect(plan.stats.colorChanges).toBe(1);
      const r = readPes(writePes(plan, d, { version }));
      expect(r.stitchCount).toBe(plan.stats.stitches);
      expect(r.stopCount).toBe(plan.stats.stops);
      expect(r.colorChangeCount).toBe(plan.stats.colorChanges);
      // Colour slots: one per colour block (STOPs are duplicate colours); the reader folds the
      // duplicates back into STOPs.
      expect(r.pecColorIndexes.length).toBe(plan.colorBlocks.length);
      expect(r.colors.length).toBe(plan.colorBlocks.length - plan.stats.stops);
      const sim = simulatorCommands(plan).filter((c) => c.cmd !== MC.END);
      const read = r.commands.filter((c) => c.cmd !== MC.END);
      const ox = read[0].x - sim[0].x,
        oy = read[0].y - sim[0].y;
      const A = read.map((c) => [c.x - ox || 0, c.y - oy || 0, c.cmd]);
      const B = sim.map((c) => [c.x, c.y, c.cmd]);
      expect(A).toEqual(B);
      expect(A.filter((c) => c[2] === MC.STOP).length).toBe(3);
    });
  }
});
