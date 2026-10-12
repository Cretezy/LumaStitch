// SPDX-License-Identifier: GPL-3.0-or-later
/** Search regular rotated grids; explicit placements remain editable after optimization. */
import { buildPlan } from '@/engine/plan';
import { COMMAND_MASK } from '@/engine/types';
import { multiHoopSchema } from '@/model/schema';
import type { Design, MultiHoopOptions, Vec2 } from '@/model/types';
import { toWorld } from './placement';

export function optimizeHoopLayout(design: Design, input: MultiHoopOptions): MultiHoopOptions {
  const options = multiHoopSchema.parse(input),
    plan = buildPlan(design);
  if (plan.diagnostics.some((d) => d.severity === 'error'))
    throw new Error('Resolve stitch-generation errors before optimizing hoop placements.');
  if (!plan.stats.stitches) throw new Error('The design has no stitches.');
  if (plan.flags.length > 500000) throw new Error('Multi-hooping is limited to 500,000 source commands.');
  const w = Math.floor((options.width - 2 * options.margin) * 5) / 5 - 1,
    h = Math.floor((options.height - 2 * options.margin) * 5) / 5 - 1,
    sx = w - options.overlap,
    sy = h - options.overlap;
  const points: Vec2[] = [];
  for (let i = 0; i < plan.flags.length; i++)
    if (!(plan.flags[i] & COMMAND_MASK))
      points.push([Math.round(plan.x[i] * 10) / 10, Math.round(plan.y[i] * 10) / 10]);
  let best: { angle: number; cols: number; rows: number; ox: number; oy: number; area: number } | undefined;
  // Five-degree search includes 90° swaps for rectangular hoops; this is a bounded grid
  // heuristic, not a claim of globally optimal free placement or preserved object ownership.
  for (let angle = -90; angle < 90; angle += 5) {
    const a = (angle * Math.PI) / 180,
      c = Math.cos(a),
      s = Math.sin(a);
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const [x, y] of points) {
      const lx = c * x + s * y,
        ly = -s * x + c * y;
      minX = Math.min(minX, lx);
      maxX = Math.max(maxX, lx);
      minY = Math.min(minY, ly);
      maxY = Math.max(maxY, ly);
    }
    const cols = Math.max(1, Math.ceil((maxX - minX + 6 - w) / sx) + 1),
      rows = Math.max(1, Math.ceil((maxY - minY + 6 - h) / sy) + 1),
      area = (maxX - minX) * (maxY - minY);
    if (cols * rows > 64) continue;
    if (
      best &&
      (cols * rows > best.cols * best.rows ||
        (cols * rows === best.cols * best.rows &&
          (area > best.area + 1e-6 ||
            (Math.abs(area - best.area) < 1e-6 && Math.abs(angle) >= Math.abs(best.angle)))))
    )
      continue;
    best = {
      angle,
      cols,
      rows,
      ox: (minX + maxX - (cols - 1) * sx) / 2,
      oy: (minY + maxY - (rows - 1) * sy) / 2,
      area,
    };
  }
  if (!best)
    throw new Error('No rotated grid fits within 64 hoopings. Increase the field or split the design first.');
  const placements: NonNullable<MultiHoopOptions['placements']> = [];
  for (let row = 0; row < best.rows; row++)
    for (let col = 0; col < best.cols; col++) {
      const column = row % 2 ? best.cols - col - 1 : col;
      placements.push({
        center: toWorld([best.ox + column * sx, best.oy + row * sy], { center: [0, 0], angle: best.angle }),
        angle: best.angle,
      });
    }
  return { ...options, placements };
}
