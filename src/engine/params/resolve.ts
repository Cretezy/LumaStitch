// SPDX-License-Identifier: GPL-3.0-or-later
import type { FabricId, FabricProfile, StitchElement, StitchType } from '@/model/types';
import { getStitchType } from '../registry';
import { FABRIC_PRESETS } from './fabric';
import type { Params } from './types';

/** Inherited values: type defaults ← fabric preset (no element overrides). */
export function inheritedParams(type: StitchType, fabric: FabricId, profile?: FabricProfile): Params {
  const def = getStitchType(type);
  const preset =
    FABRIC_PRESETS[fabric]?.params[
      type === 'satinColumn'
        ? 'satinFill'
        : type === 'guidedFill'
          ? 'tatami'
          : type === 'appliqueBorder'
            ? 'applique'
            : type
    ] ?? {};
  const out: Params = { ...def.defaults };
  for (const k of Object.keys(preset)) if (k in def.defaults) out[k] = preset[k];
  if (profile) {
    const fill = ['tatami', 'patternFill', 'guidedFill'].includes(type);
    const satin = ['satin', 'satinFill', 'satinColumn', 'applique', 'appliqueBorder'].includes(type);
    if (fill || satin) {
      out.density = fill ? profile.fillSpacing : profile.satinSpacing;
      out.pullComp = profile.pullComp;
      if ('underlay' in out) out.underlay = fill ? profile.fillUnderlay : profile.satinUnderlay;
      if (fill && 'underlaySpacing' in out) out.underlaySpacing = profile.underlaySpacing;
    }
  }
  return out;
}

/** effective = { ...defaults, ...fabric preset, ...element overrides } (unknown keys dropped). */
export function resolveParams(
  el: Pick<StitchElement, 'type' | 'params'>,
  fabric: FabricId,
  profile?: FabricProfile,
): Params {
  const out = inheritedParams(el.type, fabric, profile);
  for (const k of Object.keys(el.params)) if (k in out) out[k] = el.params[k];
  return out;
}

/** Whether a parameter is overridden on the element. */
export function isOverridden(el: Pick<StitchElement, 'params'>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(el.params, key);
}
