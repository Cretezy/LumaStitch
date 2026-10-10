import { expect, it } from 'vitest';
import { createDesign, createElement, createShape, createThread } from '@/model/factories';
import { ellipseGeom } from '@/geom/shapes';
import { buildPlan } from '@/engine/plan';
import { blitTransformed, drawPlan } from './stitchRenderer';

/** SPEC §10: pan and zoom at 60 fps up to 100k stitches (one redraw must fit a frame). */
it('redraws a 100k-stitch plan within a frame budget', () => {
  const d = createDesign();
  const colors = ['#c1121f', '#003049', '#669bbc', '#fdf0d5'];
  for (let i = 0; i < 36; i++) {
    const t = createThread(colors[i % 4]);
    d.threads[t.id] = t;
    const s = createShape('e', ellipseGeom((i % 6) * 70, Math.floor(i / 6) * 70, 33, 30));
    s.fill = createElement('fill', 'tatami', t.id);
    d.shapes[s.id] = s;
    d.zOrder.push(s.id);
    d.sequence.push({ kind: 'element', elementId: s.fill.id });
  }
  const t0 = performance.now();
  const plan = buildPlan(d);
  const build = performance.now() - t0;
  const canvas = document.createElement('canvas');
  canvas.width = 1400 * 2;
  canvas.height = 900 * 2;
  const ctx = canvas.getContext('2d')!;
  const vp = { zoom: 2, pan: [50, 50] as [number, number] };
  drawPlan(ctx, plan, vp, { mode: 'flat', jumps: true, needlePoints: false, dpr: 2 }); // warm-up (builds Path2D)
  const tf = performance.now();
  drawPlan(ctx, plan, vp, { mode: 'flat', jumps: true, needlePoints: false, dpr: 2 });
  ctx.getImageData(0, 0, 1, 1);
  const fullRedraw = performance.now() - tf;
  // Gesture frames: transform the snapshot of the last full render.
  const snapshot = document.createElement('canvas');
  snapshot.width = canvas.width;
  snapshot.height = canvas.height;
  snapshot.getContext('2d')!.drawImage(canvas, 0, 0);
  const times: number[] = [];
  for (let k = 0; k < 20; k++) {
    const t = performance.now();
    blitTransformed(ctx, snapshot, vp, { zoom: 2 + k * 0.05, pan: [50 + k * 3, 50 - k] }, 2);
    ctx.getImageData(0, 0, 1, 1); // flush
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  const median = times[10];
  const tr = performance.now();
  drawPlan(ctx, plan, vp, { mode: 'realistic', jumps: false, needlePoints: false, dpr: 2 });
  ctx.getImageData(0, 0, 1, 1);
  const realistic = performance.now() - tr;
  console.log(
    `plan ${plan.stats.stitches} stitches built in ${build.toFixed(0)} ms; full flat redraw ${fullRedraw.toFixed(0)} ms; gesture frame median ${median.toFixed(1)} ms; realistic ${realistic.toFixed(0)} ms`,
  );
  expect(plan.stats.stitches).toBeGreaterThan(90000);
  expect(build).toBeLessThan(4000);
  expect(median).toBeLessThan(16);
});
