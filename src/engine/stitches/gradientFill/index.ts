// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Gradient fill: tatami whose row spacing changes linearly from a start density to an end density
 * across the shape (perpendicular to the rows), for shading and colour blends. Sections, travel,
 * underlay and routing are tatami's.
 */
import type { ParamDef } from '../../params/types';
import type { StitchTypeDef } from '../../def';
import { num } from '../../params/types';
import { buildCustomLayer } from '../tatami/layer';
import {
  prepareTatamiLike,
  routeTatami,
  tatamiDefaults,
  tatamiParams,
  type TatamiPrep,
  type TopLayerBuilder,
} from '../tatami';

/**
 * Row positions from `minY` to `maxY` whose spacing varies linearly from `a` (at minY) to `b`
 * (at maxY). The first row sits half a spacing in from the edge.
 */
export function gradientRows(minY: number, maxY: number, a: number, b: number): number[] {
  const span = maxY - minY;
  if (!(span > 0)) return [];
  const d = (y: number) => Math.max(0.05, a + ((b - a) * (y - minY)) / span);
  const ys: number[] = [];
  let y = minY + d(minY) / 2;
  while (y < maxY && ys.length < 100000) {
    ys.push(y);
    // Midpoint rule so the spacing between two rows matches the gradient at their middle.
    const d0 = d(y);
    y += d(y + d0 / 2);
  }
  return ys;
}

const gradientTop: TopLayerBuilder = (poly, params, base) => {
  const a = Math.max(0.1, num(params, 'densityStart', 0.4));
  const b = Math.max(0.1, num(params, 'densityEnd', 2));
  return buildCustomLayer(poly, base.angle, (a + b) / 2, base.stitchLength, num(params, 'offset', 0.25), {
    rowYs: (minY, maxY) => gradientRows(minY, maxY, a, b),
  });
};

const densityParam = (key: string, label: string, help: string): ParamDef => ({
  key,
  label,
  help,
  kind: 'length',
  unit: 'mm',
  min: 0.2,
  max: 5,
  step: 0.05,
  group: 'basic',
});

export const gradientFillDef: StitchTypeDef<TatamiPrep> = {
  id: 'gradientFill',
  label: 'Gradient fill',
  description: 'Tatami that fades from dense to open across the shape. For shading and colour blends.',
  role: 'fill',
  params: [
    ...tatamiParams.filter((p) => p.key === 'angle'),
    densityParam(
      'densityStart',
      'Start density',
      'Row spacing on the first side of the shape (perpendicular to the rows). Smaller is denser.',
    ),
    densityParam('densityEnd', 'End density', 'Row spacing on the opposite side. Smaller is denser.'),
    ...tatamiParams.filter((p) => p.key !== 'angle' && p.key !== 'density'),
  ],
  defaults: {
    ...Object.fromEntries(Object.entries(tatamiDefaults).filter(([k]) => k !== 'density')),
    densityStart: 0.4,
    densityEnd: 2.0,
    pullComp: 0.15,
    underlay: 'none',
  },
  appliesTo: (s) => s.hasClosed,
  prepare(geom, params, _el, ctx) {
    return prepareTatamiLike(geom, params, ctx, gradientTop);
  },
  route: routeTatami,
};
