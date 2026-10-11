// SPDX-License-Identifier: GPL-3.0-or-later
import { buildPlan } from '@/engine/plan';
import { optimizeSequence } from '@/engine/sequence/optimize';
import { F } from '@/engine/types';
import { routingFixtures } from './fixtures';

export function measureRouting() {
  return routingFixtures().map(({ name, design }) => {
    const timings: number[] = [];
    let plan = buildPlan(design);
    for (let repeat = 0; repeat < 4; repeat++) {
      const before = performance.now();
      const sequence = optimizeSequence(design);
      plan = buildPlan({ ...design, sequence });
      if (repeat) timings.push(performance.now() - before);
    }
    let jumpMm = 0,
      travelMm = 0;
    const jumpSegments: number[][] = [],
      stitchSegments: number[][] = [];
    for (let i = 1; i < plan.flags.length; i++) {
      const f = plan.flags[i];
      if (f & (F.STOP | F.END | F.TRIM | F.COLOR_CHANGE)) continue;
      const line = [plan.x[i - 1], plan.y[i - 1], plan.x[i], plan.y[i]];
      const distance = Math.hypot(line[2] - line[0], line[3] - line[1]);
      if (f & F.JUMP) {
        jumpMm += distance;
        jumpSegments.push(line);
      } else {
        if (f & F.TRAVEL) travelMm += distance;
        stitchSegments.push(line);
      }
    }
    return {
      name,
      sequence: optimizeSequence(design).flatMap((e) => (e.kind === 'element' ? [e.elementId] : [])),
      ...plan.stats,
      jumpMm,
      travelMm,
      medianMs: timings.sort((a, b) => a - b)[1],
      bounds: plan.bounds,
      jumpSegments,
      stitchSegments,
    };
  });
}
