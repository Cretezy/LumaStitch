// SPDX-License-Identifier: GPL-3.0-or-later
import type { FabricId, StitchElement, StitchType } from '@/model/types';
import { getStitchType } from '../registry';
import { FABRIC_PRESETS } from './fabric';
import type { Params } from './types';

/** Inherited values: type defaults ← fabric preset (no element overrides). */
export function inheritedParams(type: StitchType, fabric: FabricId): Params {
  const def = getStitchType(type);
  const preset =
    FABRIC_PRESETS[fabric]?.params[
      type === 'satinColumn' ? 'satinFill' : type === 'guidedFill' ? 'tatami' : type
    ] ?? {};
  const out: Params = { ...def.defaults };
  for (const k of Object.keys(preset)) if (k in def.defaults) out[k] = preset[k];
  return out;
}

/** effective = { ...defaults, ...fabric preset, ...element overrides } (unknown keys dropped). */
export function resolveParams(el: Pick<StitchElement, 'type' | 'params'>, fabric: FabricId): Params {
  const out = inheritedParams(el.type, fabric);
  for (const k of Object.keys(el.params)) if (k in out) out[k] = el.params[k];
  return out;
}

/** Whether a parameter is overridden on the element. */
export function isOverridden(el: Pick<StitchElement, 'params'>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(el.params, key);
}
