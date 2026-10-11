// SPDX-License-Identifier: GPL-3.0-or-later
/** Stitch type registry. Adding a type = a folder in stitches/ + one line here. */
import type { ElementRole, StitchType } from '@/model/types';
import type { StitchTypeDef } from './def';
import { appliqueDef } from './stitches/applique';
import { blanketDef } from './stitches/blanket';
import { contourDef } from './stitches/contour';
import { crossStitchDef } from './stitches/crossStitch';
import { gradientFillDef } from './stitches/gradientFill';
import { manualDef } from './stitches/manual';
import { meanderDef } from './stitches/meander';
import { motifRunDef } from './stitches/motifRun';
import { patternFillDef } from './stitches/patternFill';
import { rippleDef } from './stitches/ripple';
import { runningDef, tripleDef } from './stitches/running';
import { satinDef, zigzagDef } from './stitches/satin';
import { satinColumnDef } from './stitches/satinColumn';
import { satinFillDef } from './stitches/satinFill';
import { tatamiDef } from './stitches/tatami';
import { perPart } from './stitches/multipart';

const REGISTRY = new Map<StitchType, StitchTypeDef<any>>();

export function registerStitchType(def: StitchTypeDef<any>): void {
  REGISTRY.set(def.id, def);
}

// Fills without native multi-part handling are sewn part by part (see stitches/multipart.ts).
for (const d of [
  tatamiDef,
  perPart(satinFillDef),
  perPart(contourDef),
  runningDef,
  tripleDef,
  satinDef,
  satinColumnDef,
  zigzagDef,
])
  registerStitchType(d);
// P2 types.
for (const d of [
  patternFillDef,
  gradientFillDef,
  perPart(meanderDef),
  perPart(rippleDef),
  perPart(crossStitchDef),
  appliqueDef,
  motifRunDef,
  blanketDef,
  manualDef,
])
  registerStitchType(d);

export function getStitchType(id: StitchType): StitchTypeDef<any> {
  const d = REGISTRY.get(id);
  if (!d) throw new Error(`Unknown stitch type: ${id}`);
  return d;
}

export function hasStitchType(id: string): id is StitchType {
  return REGISTRY.has(id as StitchType);
}

export function stitchTypesFor(role: ElementRole): StitchTypeDef<any>[] {
  return [...REGISTRY.values()].filter((d) => d.role === role);
}
