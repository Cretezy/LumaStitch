// SPDX-License-Identifier: GPL-3.0-or-later
/** Sewing order: multi-part fills, jumps between parts, and the sequence optimiser. */
import { describe, expect, it } from 'vitest';
import { createDesign, createElement, createShape, createThread } from '@/model/factories';
import type { Design, PathGeom, StitchType } from '@/model/types';
import { compound, rectGeom } from '@/geom/shapes';
import { buildPlan } from '../plan';
import { F, type StitchPlan } from '../types';
import { optimizeSequence } from './optimize';

function design(
  items: { geom: PathGeom; color?: string; outline?: boolean; fill?: boolean; fillType?: StitchType }[],
): Design {
  const d = createDesign();
  for (const it of items) {
    const color = it.color ?? '#ff0000';
    let thread = Object.values(d.threads).find((t) => t.color === color);
    if (!thread) {
      thread = createThread(color);
      d.threads[thread.id] = thread;
    }
    const s = createShape('S' + d.zOrder.length, it.geom, {});
    if (it.fill !== false) s.fill = createElement('fill', it.fillType ?? 'tatami', thread.id, {});
    if (it.outline) s.outline = createElement('outline', 'running', thread.id, {});
    d.shapes[s.id] = s;
    d.zOrder.push(s.id);
    if (s.fill) d.sequence.push({ kind: 'element', elementId: s.fill.id });
    if (s.outline) d.sequence.push({ kind: 'element', elementId: s.outline.id });
  }
  return d;
}

/** Index (by x range) of the part each penetration falls in, in sewing order, runs collapsed. */
function visits(plan: StitchPlan, parts: [number, number][]): number[] {
  const out: number[] = [];
  for (let i = 0; i < plan.flags.length; i++) {
    if (plan.flags[i] & (F.JUMP | F.TRIM | F.COLOR_CHANGE | F.STOP | F.END)) continue;
    const k = parts.findIndex(([a, b]) => plan.x[i] >= a - 0.5 && plan.x[i] <= b + 0.5);
    if (k >= 0 && out[out.length - 1] !== k) out.push(k);
  }
  return out;
}

describe('multi-part fills', () => {
  // A "word": five letters 1.2 mm apart in one shape, like text set as a single SVG path.
  const letters: [number, number][] = [0, 1, 2, 3, 4].map((i) => [i * 9.2, i * 9.2 + 8]);
  const word = compound(letters.map(([x0]) => rectGeom(x0, 0, 8, 10)));

  it('finishes each part (underlay and top) before moving to the next', () => {
    const plan = buildPlan(design([{ geom: word }]));
    const v = visits(plan, letters);
    expect(v.length).toBe(5);
    expect(new Set(v).size).toBe(5);
    // Neighbour to neighbour, not back and forth.
    for (let k = 1; k < v.length; k++) expect(Math.abs(v[k] - v[k - 1])).toBe(1);
  });

  it.each(['satinFill', 'contour', 'ripple', 'gradientFill', 'patternFill'] as StitchType[])(
    '%s also sews one part at a time',
    (fillType) => {
      const plan = buildPlan(design([{ geom: word, fillType }]));
      const v = visits(plan, letters);
      expect(new Set(v).size).toBe(5);
      expect(v.length).toBe(5);
    },
  );

  it('jumps between parts at their nearest edges', () => {
    const plan = buildPlan(design([{ geom: word }]));
    for (let i = 1; i < plan.flags.length; i++) {
      if (!(plan.flags[i] & F.JUMP) || plan.element[i] === undefined) continue;
      if (i < 3) continue; // the initial jump to the start
      const d = Math.hypot(plan.x[i] - plan.x[i - 1], plan.y[i] - plan.y[i - 1]);
      // Gap is 1.2 mm; allow for the inset of the travel area and the tie-off.
      expect(d).toBeLessThan(4);
    }
    expect(plan.stats.trims).toBeLessThanOrEqual(4);
  });
});

describe('outlines with several loops', () => {
  it('jumps between separate loops instead of stitching across the gap', () => {
    // Two squares 2 mm apart (under the 3 mm trim threshold) in one shape, running outline only;
    // the first square starts at (0, 0), right next to the second one.
    const geom = compound([rectGeom(0, 0, 10, 10), rectGeom(-12, 0, 10, 10)]);
    const plan = buildPlan(design([{ geom, outline: true, fill: false }]));
    for (let i = 1; i < plan.flags.length; i++) {
      if (plan.flags[i] & (F.JUMP | F.TRIM | F.COLOR_CHANGE | F.STOP | F.END)) continue;
      if (plan.flags[i - 1] & (F.TRIM | F.COLOR_CHANGE | F.STOP)) continue;
      // No stitch has one end on each square.
      const a = plan.x[i - 1] >= -0.01,
        b = plan.x[i] >= -0.01;
      expect(a, `stitch ${i}: ${plan.x[i - 1].toFixed(2)} → ${plan.x[i].toFixed(2)}`).toBe(b);
    }
    expect(plan.stats.trims).toBe(1);
  });
});

describe('sequence optimiser', () => {
  it('finishes a lower shape (fill and outline) before the shape stacked above it', () => {
    const d = design([
      { geom: rectGeom(0, 0, 20, 20), outline: true },
      { geom: rectGeom(10, 10, 20, 20), outline: true },
    ]);
    const [a, b] = d.zOrder.map((id) => d.shapes[id]);
    const order = optimizeSequence(d).flatMap((e) => (e.kind === 'element' ? [e.elementId] : []));
    expect(order).toEqual([a.fill!.id, a.outline!.id, b.fill!.id, b.outline!.id]);
  });

  it('starts at the top left and sews colours in reading order when nothing overlaps', () => {
    const d = design([
      { geom: rectGeom(40, 0, 8, 8), color: '#00ff00' },
      { geom: rectGeom(20, 0, 8, 8), color: '#0000ff' },
      { geom: rectGeom(0, 0, 8, 8), color: '#ff0000' },
    ]);
    const xs = optimizeSequence(d).flatMap((e) => {
      if (e.kind !== 'element') return [];
      const s = Object.values(d.shapes).find((s) => s.fill?.id === e.elementId)!;
      return [s.geom.subpaths[0].nodes[0].p[0]];
    });
    expect(xs).toEqual([0, 20, 40]);
  });
});

it('keeps manual stops and all elements on their original side of each stop', () => {
  const d = design([
    { geom: rectGeom(40, 0, 8, 8), color: '#ff0000' },
    { geom: rectGeom(0, 0, 8, 8), color: '#0000ff' },
    { geom: rectGeom(20, 0, 8, 8), color: '#ff0000' },
  ]);
  d.sequence.splice(1, 0, { kind: 'stop', id: 'fabric', note: 'Place fabric' });
  d.sequence.unshift({ kind: 'stop', id: 'start' });
  d.sequence.push({ kind: 'stop', id: 'end' });
  const result = optimizeSequence(d);
  expect(result.slice(0, 3)).toEqual(d.sequence.slice(0, 3));
  expect(result.at(-1)).toEqual(d.sequence.at(-1));
  expect(
    result
      .slice(3, -1)
      .map((e) => JSON.stringify(e))
      .sort(),
  ).toEqual(
    d.sequence
      .slice(3, -1)
      .map((e) => JSON.stringify(e))
      .sort(),
  );
});

it('preserves the original order when fixed elements contradict stacking', () => {
  const d = design([{ geom: rectGeom(0, 0, 20, 20) }, { geom: rectGeom(10, 10, 20, 20) }]);
  d.sequence.reverse();
  expect(optimizeSequence(d, { elementIds: [] })).toEqual(d.sequence);
});

it.each([0, 1, 3])('keeps other objects on their side of an imported stop at node %i', (stopIndex) => {
  const d = createDesign();
  d.threads.red = { id: 'red', name: 'Red', color: '#ff0000' };
  d.threads.blue = { id: 'blue', name: 'Blue', color: '#0000ff' };
  const add = (x: number, thread: string, imported = false) => {
    const s = createShape(
      'Line',
      {
        fillRule: 'nonzero',
        subpaths: [{ closed: false, nodes: [{ p: [x, 0] }, { p: [x + 2, 0] }, { p: [x + 4, 0] }] }],
      },
      { strokeWidth: 0.15 },
    );
    s.outline = createElement('outline', 'manual', thread, { preserveCommands: imported });
    s.outline.tieIn = s.outline.tieOut = 'off';
    if (imported) s.geom.subpaths[0].nodes.splice(stopIndex, 0, { p: [x + stopIndex, 0], command: 'stop' });
    d.shapes[s.id] = s;
    d.zOrder.push(s.id);
    d.sequence.push({ kind: 'element', elementId: s.outline.id });
  };
  add(100, 'blue');
  add(30, 'red', true);
  add(40, 'blue');
  add(0, 'red');
  const original = d.sequence.slice();
  const sequence = optimizeSequence(d);
  expect(sequence.slice(0, 2)).toEqual(original.slice(0, 2));
  expect(new Set(sequence.slice(2))).toEqual(new Set(original.slice(2)));
  const plan = buildPlan({ ...d, sequence });
  expect(plan.stats.stops).toBe(1);
  const stop = plan.flags.findIndex((flag) => !!(flag & F.STOP));
  const firstAfter = plan.element.findIndex((element) =>
    original
      .slice(2)
      .some((entry) => entry.kind === 'element' && entry.elementId === plan.elementIds[element]),
  );
  expect(firstAfter).toBeGreaterThan(stop);
});

it('keeps unselected elements in relative order while optimizing selected ones', () => {
  const d = design(Array.from({ length: 8 }, (_, i) => ({ geom: rectGeom((7 - i) * 12, 0, 8, 8) })));
  const ids = d.sequence.flatMap((e) => (e.kind === 'element' ? [e.elementId] : []));
  const selected = ids.filter((_, i) => i % 2 === 0);
  const result = optimizeSequence(d, { elementIds: selected }).flatMap((e) =>
    e.kind === 'element' ? [e.elementId] : [],
  );
  expect(result.filter((id) => !selected.includes(id))).toEqual(ids.filter((id) => !selected.includes(id)));
  expect(new Set(result)).toEqual(new Set(ids));
});

it('scores wide-fill candidates using real jumps and travel, not only centres', () => {
  const d = design([
    { geom: rectGeom(0, 0, 80, 3) },
    { geom: rectGeom(35, 6, 10, 3) },
    { geom: rectGeom(0, 12, 80, 3) },
    { geom: rectGeom(35, 18, 10, 3) },
  ]);
  d.settings.defaultTie = 'never';
  for (const s of Object.values(d.shapes))
    Object.assign(s.fill!.params, { angle: 0, density: 0.4, underlay: 'none', pullComp: 0 });
  const score = (plan: StitchPlan) => {
    let cost = 10 * plan.stats.trims;
    for (let i = 1; i < plan.flags.length; i++) {
      const f = plan.flags[i];
      if (f & (F.TRIM | F.STOP | F.END | F.COLOR_CHANGE)) continue;
      const d = Math.hypot(plan.x[i] - plan.x[i - 1], plan.y[i] - plan.y[i - 1]);
      cost += d * (f & F.JUMP ? 3 : f & F.TRAVEL ? 1 : 0);
    }
    return cost;
  };
  const before = buildPlan(d);
  const after = buildPlan({ ...d, sequence: optimizeSequence(d) });
  expect(score(after)).toBeLessThan(score(before) - 40);
  expect(after.stats.colorChanges).toBe(before.stats.colorChanges);
});
