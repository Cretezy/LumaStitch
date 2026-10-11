// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, it } from 'vitest';
import { starterProfile, mergeProfiles, profileFileSchema } from './profiles';
import { inheritedParams, resolveParams } from '@/engine/params/resolve';
import { createDesign, createElement, createShape } from '@/model/factories';
import { rectGeom } from '@/geom/shapes';
import { buildPlan, createPlanCache } from '@/engine/plan';
import { useDoc } from '@/store/documentStore';
import { useUi } from '@/store/uiStore';
import { setDesignProps } from '@/store/commands';
import { parseProjectFile, serializeProject } from '@/model/schema';

it('applies profile defaults to all supported types while retaining element overrides', () => {
  const p = { ...starterProfile('knit'), fillSpacing: 0.7, satinSpacing: 0.6, pullComp: 0.45 };
  for (const type of ['tatami', 'patternFill', 'guidedFill'] as const)
    expect(inheritedParams(type, 'knit', p).density).toBe(0.7);
  for (const type of ['satin', 'satinFill', 'satinColumn', 'applique'] as const)
    expect(inheritedParams(type, 'knit', p).density).toBe(0.6);
  expect(resolveParams({ type: 'tatami', params: { density: 0.3 } }, 'knit', p).density).toBe(0.3);
  expect(inheritedParams('running', 'knit', p)).toEqual(inheritedParams('running', 'knit'));
});
it('invalidates generated stitches, saves portable defaults and restores profile application with undo', () => {
  const d = createDesign();
  d.threads.blue = { id: 'blue', name: 'Blue', color: '#234567' };
  const s = createShape('Fill', rectGeom(0, 0, 20, 20));
  s.fill = createElement('fill', 'tatami', 'blue');
  d.shapes[s.id] = s;
  d.zOrder = [s.id];
  d.sequence = [{ kind: 'element', elementId: s.fill.id }];
  const cache = createPlanCache(),
    before = buildPlan(d, { cache });
  useUi.getState().setSim({ active: false });
  useDoc.getState().load(d, 'test');
  setDesignProps({ fabricProfile: { ...starterProfile('woven'), fillSpacing: 0.8 } });
  const after = useDoc.getState().design!;
  expect(buildPlan(after, { cache }).stats.stitches).toBeLessThan(before.stats.stitches);
  expect(parseProjectFile(serializeProject(after))).toEqual(after);
  useDoc.getState().undo();
  expect(useDoc.getState().design).toEqual(d);
  useDoc.getState().redo();
  expect(useDoc.getState().design).toEqual(after);
  setDesignProps({ fabric: 'knit' });
  expect(useDoc.getState().design!.fabricProfile).toBeUndefined();
});
it('validates portable profile files and replaces matching names deterministically', () => {
  const a = starterProfile('woven'),
    b = { ...a, fillSpacing: 0.7 };
  expect(mergeProfiles([a], [b])).toEqual([b]);
  expect(() => profileFileSchema.parse({ version: 1, profiles: [{ ...a, fillSpacing: -1 }] })).toThrow();
  expect(() => profileFileSchema.parse({ version: 2, profiles: [a] })).toThrow();
});
