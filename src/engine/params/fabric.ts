// SPDX-License-Identifier: GPL-3.0-or-later
/** Fabric presets (SPEC §8.7). Starting values, to be tuned through sew tests. */
import type { FabricId, StitchType } from '@/model/types';
import type { Params } from './types';

export interface FabricPreset {
  id: FabricId;
  label: string;
  description: string;
  stabilizer: string;
  /** Per stitch type overrides. */
  params: Partial<Record<StitchType, Params>>;
}

const satinLike = (density: number, pullComp: number, extra: Params = {}): Params => ({
  density,
  pullComp,
  ...extra,
});

export const FABRIC_PRESETS: Record<FabricId, FabricPreset> = {
  woven: {
    id: 'woven',
    label: 'Woven (cotton, twill, denim)',
    description: 'Stable fabrics. The default.',
    stabilizer: 'Tear-away or cut-away stabiliser',
    params: {
      tatami: { density: 0.4, pullComp: 0.2, underlay: 'tatami', underlaySpacing: 3.0 },
      patternFill: { density: 0.4, pullComp: 0.2, underlay: 'tatami', underlaySpacing: 3.0 },
      applique: satinLike(0.4, 0.2),
      satin: satinLike(0.4, 0.2, { underlay: 'auto', underlayBoost: 0 }),
      satinFill: satinLike(0.4, 0.2, { underlay: 'auto', underlayBoost: 0 }),
    },
  },
  knit: {
    id: 'knit',
    label: 'Knit (T-shirt, polo)',
    description: 'Stretchy fabrics: more pull compensation and heavier underlay.',
    stabilizer: 'Cut-away stabiliser',
    params: {
      tatami: { density: 0.42, pullComp: 0.35, underlay: 'edgeTatami', underlaySpacing: 2.5 },
      patternFill: { density: 0.42, pullComp: 0.35, underlay: 'edgeTatami', underlaySpacing: 2.5 },
      applique: satinLike(0.42, 0.35),
      satin: satinLike(0.42, 0.35, { underlay: 'auto', underlayBoost: 1 }),
      satinFill: satinLike(0.42, 0.35, { underlay: 'auto', underlayBoost: 1 }),
    },
  },
  pile: {
    id: 'pile',
    label: 'Pile (fleece, towel)',
    description: 'Lofty fabrics: heavy underlay to flatten the pile.',
    stabilizer: 'Water-soluble topping',
    params: {
      tatami: { density: 0.42, pullComp: 0.35, underlay: 'edgeTatami', underlaySpacing: 2.0 },
      patternFill: { density: 0.42, pullComp: 0.35, underlay: 'edgeTatami', underlaySpacing: 2.0 },
      applique: satinLike(0.4, 0.35),
      satin: satinLike(0.4, 0.35, { underlay: 'auto', underlayBoost: 1 }),
      satinFill: satinLike(0.4, 0.35, { underlay: 'auto', underlayBoost: 1 }),
    },
  },
  lightweight: {
    id: 'lightweight',
    label: 'Lightweight (silk, organza)',
    description: 'Delicate fabrics: lighter density and underlay.',
    stabilizer: 'Wash-away or light tear-away',
    params: {
      tatami: { density: 0.45, pullComp: 0.15, underlay: 'edge' },
      patternFill: { density: 0.45, pullComp: 0.15, underlay: 'edge' },
      applique: satinLike(0.45, 0.15),
      satin: satinLike(0.45, 0.15, { underlay: 'center', underlayBoost: 0 }),
      satinFill: satinLike(0.45, 0.15, { underlay: 'center', underlayBoost: 0 }),
    },
  },
};

export const FABRIC_IDS = Object.keys(FABRIC_PRESETS) as FabricId[];
