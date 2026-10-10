// SPDX-License-Identifier: GPL-3.0-or-later
/** Sewing order: multi-part fills, jumps between parts, and the sequence optimiser. */
import { describe, expect, it } from 'vitest';
import { createDesign, createElement, createShape, createThread } from '@/model/factories';
import type { Design, PathGeom } from '@/model/types';
import { compound, rectGeom } from '@/geom/shapes';
import { buildPlan } from '../plan';
import { F, type StitchPlan } from '../types';
import { optimizeSequence } from './optimize';

function design(items: { geom: PathGeom; color?: string; outline?: boolean; fill?: boolean }[]): Design {
  const d = createDesign();
  for (const it of items) {
    const color = it.color ?? '#ff0000';
    let thread = Object.values(d.threads).find((t) => t.color === color);
    if (!thread) {
      thread = createThread(color);
      d.threads[thread.id] = thread;
    }
    const s = createShape('S' + d.zOrder.length, it.geom, {});
    if (it.fill !== false) s.fill = createElement('fill', 'tatami', thread.id, {});
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
