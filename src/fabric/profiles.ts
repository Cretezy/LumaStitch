// SPDX-License-Identifier: GPL-3.0-or-later
import { z } from 'zod';
import { fabricProfileSchema } from '@/model/schema';
import type { FabricId, FabricProfile } from '@/model/types';
import { FABRIC_PRESETS } from '@/engine/params/fabric';
import { getPref, setPref } from '@/library/library';

export const profileFileSchema = z.object({
  version: z.literal(1),
  profiles: z.array(fabricProfileSchema).max(100),
});
const KEY = 'fabricCalibrationProfiles';
export function starterProfile(fabric: FabricId): FabricProfile {
  const p = FABRIC_PRESETS[fabric],
    fill = p.params.tatami!,
    satin = p.params.satin!;
  return {
    name: `My ${fabric} calibration`,
    baseFabric: fabric,
    fillSpacing: Number(fill.density),
    satinSpacing: Number(satin.density),
    pullComp: Number(fill.pullComp),
    fillUnderlay: fill.underlay as FabricProfile['fillUnderlay'],
    satinUnderlay: satin.underlay as FabricProfile['satinUnderlay'],
    underlaySpacing: Number(fill.underlaySpacing ?? 3),
    stabilizer: p.stabilizer,
    needle: '',
    thread: '',
    notes: '',
  };
}
export async function loadProfiles(): Promise<FabricProfile[]> {
  const saved = await getPref<unknown>(KEY);
  return saved === undefined ? [] : profileFileSchema.parse(saved).profiles;
}
export async function saveProfiles(profiles: FabricProfile[]): Promise<void> {
  const file = profileFileSchema.parse({ version: 1, profiles });
  await setPref(KEY, file);
  if (JSON.stringify(await getPref(KEY)) !== JSON.stringify(file))
    throw new Error('Profiles could not be saved in this browser. Download a profile backup.');
}
export function mergeProfiles(existing: FabricProfile[], incoming: FabricProfile[]): FabricProfile[] {
  const map = new Map(existing.map((p) => [p.name, p]));
  for (const p of incoming) map.set(p.name, p);
  return profileFileSchema.parse({ version: 1, profiles: [...map.values()] }).profiles;
}
