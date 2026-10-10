// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Pattern fill: tatami whose needle penetrations form a visible texture. The pattern is a
 * per-row phase of the penetration grid (brick, diagonal, herringbone) or, for wave, rows that
 * follow a sine curve. Sections, travel, underlay and routing are tatami's.
 */
import type { StitchTypeDef } from '../../def';
import { num, str, type ParamDef } from '../../params/types';
import { buildCustomLayer } from '../tatami/layer';
import {
  prepareTatamiLike,
  routeTatami,
  tatamiDefaults,
  tatamiParams,
  type TatamiPrep,
  type TopLayerBuilder,
} from '../tatami';

const mod = (a: number, n: number) => ((a % n) + n) % n;

/** Penetration phase (fraction of the stitch length) of row k for a pattern repeating every n rows. */
export function patternPhase(pattern: string, n: number, offset: number): (k: number) => number {
  n = Math.max(1, Math.round(n));
  switch (pattern) {
    case 'brick':
      // Courses of n rows share their penetrations; alternate courses shift by half a stitch.
      return (k) => (mod(Math.floor(k / n), 2) ? 0.5 : 0);
    case 'diagonal':
      return (k) => mod(k, n) / n;
    case 'herringbone': {
      // Up n rows, then back down: chevrons.
      return (k) => {
        const m = mod(k, 2 * n);
        return (m <= n ? m : 2 * n - m) / n;
      };
    }
    default:
      return (k) => k * offset;
  }
}

const patternTop: TopLayerBuilder = (poly, params, base) => {
  const pattern = str(params, 'pattern', 'brick');
  const off = num(params, 'offset', 0.25);
  return buildCustomLayer(poly, base.angle, base.density, base.stitchLength, off, {
    phase: patternPhase(pattern, num(params, 'repeat', 4), off),
    wave:
      pattern === 'wave'
        ? {
            amp: Math.max(0, num(params, 'waveAmplitude', 1.5)),
            period: Math.max(1, num(params, 'waveLength', 12)),
          }
        : undefined,
  });
};

const patternParams: ParamDef[] = [
  {
    key: 'pattern',
    label: 'Pattern',
    help: 'Texture formed by the needle penetrations.',
    kind: 'enum',
    options: [
      { value: 'brick', label: 'Brick' },
      { value: 'diagonal', label: 'Diagonal' },
      { value: 'herringbone', label: 'Herringbone' },
      { value: 'wave', label: 'Wave' },
    ],
    group: 'basic',
  },
  {
    key: 'repeat',
    label: 'Pattern size',
    help: 'Rows per repeat: brick course height, diagonal or herringbone period.',
    kind: 'number',
    min: 2,
    max: 20,
    step: 1,
    group: 'basic',
    visibleIf: (p) => p.pattern !== 'wave',
  },
  {
    key: 'waveAmplitude',
    label: 'Wave height',
    help: 'How far the rows swing to each side.',
    kind: 'length',
    unit: 'mm',
    min: 0,
    max: 10,
    step: 0.1,
    group: 'basic',
    visibleIf: (p) => p.pattern === 'wave',
  },
  {
    key: 'waveLength',
    label: 'Wave length',
    help: 'Distance between wave crests along a row.',
    kind: 'length',
    unit: 'mm',
    min: 2,
    max: 50,
    step: 0.5,
    group: 'basic',
    visibleIf: (p) => p.pattern === 'wave',
  },
];

export const patternFillDef: StitchTypeDef<TatamiPrep> = {
  id: 'patternFill',
  label: 'Pattern fill',
  description: 'Tatami with a textured pattern of penetrations: brick, diagonal, herringbone or wave.',
  role: 'fill',
  params: [
    ...patternParams,
    ...tatamiParams.map((p) =>
      p.key === 'offset' ? { ...p, visibleIf: (v: Record<string, unknown>) => v.pattern === 'wave' } : p,
    ),
  ],
  defaults: { ...tatamiDefaults, pattern: 'brick', repeat: 4, waveAmplitude: 1.5, waveLength: 12 },
  appliesTo: (s) => s.hasClosed,
  prepare(geom, params, _el, ctx) {
    return prepareTatamiLike(geom, params, ctx, patternTop);
  },
  route: routeTatami,
};
