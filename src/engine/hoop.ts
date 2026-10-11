// SPDX-License-Identifier: GPL-3.0-or-later
import type { Hoop } from '@/model/types';
import { F, type Diagnostic, type StitchPlan } from './types';

export function hoopFit(plan: StitchPlan, hoop: Hoop): { outside: number; center: [number, number] } {
  const center: [number, number] = [
    (plan.bounds.minX + plan.bounds.maxX) / 2,
    (plan.bounds.minY + plan.bounds.maxY) / 2,
  ];
  const rx = hoop.width / 2 - hoop.margin,
    ry = hoop.height / 2 - hoop.margin;
  let outside = 0;
  for (let i = 0; i < plan.flags.length; i++) {
    if (plan.flags[i] & (F.TRIM | F.COLOR_CHANGE | F.STOP | F.END)) continue;
    const x = Math.abs(plan.x[i] - center[0]),
      y = Math.abs(plan.y[i] - center[1]);
    if (
      rx <= 0 ||
      ry <= 0 ||
      (hoop.shape === 'ellipse' ? (x / rx) ** 2 + (y / ry) ** 2 > 1 + 1e-7 : x > rx + 1e-5 || y > ry + 1e-5)
    )
      outside++;
  }
  return { outside, center };
}

export function hoopWarnings(plan: StitchPlan, hoop?: Hoop): Diagnostic[] {
  if (!hoop || !plan.stats.stitches) return [];
  const { outside } = hoopFit(plan, hoop);
  return outside
    ? [
        {
          severity: 'warning',
          code: 'export.hoop',
          message: `${outside} needle or jump positions fall outside the selected ${hoop.width} × ${hoop.height} mm ${hoop.shape} sewing field with ${hoop.margin} mm margin. Resize, use a larger field, or split into multiple hoopings.`,
        },
      ]
    : [];
}
