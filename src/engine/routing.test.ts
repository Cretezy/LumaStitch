import { expect, it } from 'vitest';
import { partOrder } from './stitches/tatami';
import { postprocessRun } from './postprocess';
import { runFrom } from './stitches/common';
import { createDesign, createElement, createShape, createThread } from '@/model/factories';
import { rectGeom } from '@/geom/shapes';
import { buildPlan } from './plan';
import { F } from './types';

it('finishes at the requested part when there are 25 parts and no entry hint', () => {
  const parts = Array.from({ length: 25 }, (_, i) => ({
    outer: Float64Array.from([i * 4, 0, i * 4 + 2, 0, i * 4 + 2, 2, i * 4, 2]),
  }));
  const order = partOrder(parts, undefined, [0, 1]);
  expect(new Set(order).size).toBe(25);
  expect(order.at(-1)).toBe(0);
});

it('does not turn adjacent horizontal fill rows into diagonal stitches', () => {
  const run = runFrom([0, 0, 5, 0, 5, 0.2, 0, 0.2]);
  const result = postprocessRun(run, { minStitchLength: 0.3, maxStitchLength: 12 });
  expect(Array.from(result.xy)).toEqual(Array.from(run.xy));
});

it('still merges redundant short stitches and splits long ones', () => {
  const run = runFrom([0, 0, 0.1, 0, 0.2, 0, 5, 0]);
  const result = postprocessRun(run, { minStitchLength: 0.3, maxStitchLength: 2 });
  expect(result.flags.length).toBe(4);
  expect(Array.from(result.xy)).toEqual([0, 0, 5 / 3, 0, 10 / 3, 0, 5, 0]);
});

it('preserves short reversals instead of flattening them into the next stitch', () => {
  const run = runFrom([0, 0, 0.2, 0, -2, 0]);
  const result = postprocessRun(run, { minStitchLength: 0.3, maxStitchLength: 12 });
  expect(Array.from(result.xy)).toEqual(Array.from(run.xy));
});

it('reserves the exit part on both sides of the exact-order cutoff', () => {
  for (const count of [24, 25, 26]) {
    const parts = Array.from({ length: count }, (_, i) => ({
      outer: Float64Array.from([i * 4, 0, i * 4 + 2, 0, i * 4 + 2, 2, i * 4, 2]),
    }));
    for (const last of [0, 7, count - 1]) {
      for (const from of [undefined, [0, 1] as [number, number]]) {
        const order = partOrder(parts, from, [last * 4, 1]);
        expect(order.length).toBe(count);
        expect(new Set(order).size).toBe(count);
        expect(order.at(-1)).toBe(last);
      }
    }
  }
});

it('keeps dense rectangle fill stitches horizontal in the exported plan', () => {
  const d = createDesign();
  d.settings.defaultTie = 'never';
  const t = createThread('#ffaa00');
  const s = createShape('Dense rectangle', rectGeom(0, 0, 10, 4));
  s.fill = createElement('fill', 'tatami', t.id, {
    angle: 0,
    density: 0.2,
    underlay: 'none',
    pullComp: 0,
  });
  d.threads[t.id] = t;
  d.shapes[s.id] = s;
  d.zOrder = [s.id];
  d.sequence = [{ kind: 'element', elementId: s.fill.id }];
  const plan = buildPlan(d);
  const diagonals = [];
  for (let i = 1; i < plan.flags.length; i++) {
    if (plan.flags[i] & (F.JUMP | F.TRIM | F.STOP | F.END | F.TIE | F.TRAVEL)) continue;
    const dx = Math.abs(plan.x[i] - plan.x[i - 1]);
    const dy = Math.abs(plan.y[i] - plan.y[i - 1]);
    if (dx > 1 && dy > 0.1) diagonals.push([dx, dy]);
  }
  expect(diagonals).toEqual([]);
});
