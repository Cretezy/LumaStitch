// SPDX-License-Identifier: GPL-3.0-or-later
import type {
  DesignSettings,
  ElementRole,
  PathGeom,
  StitchElement,
  StitchType,
  Vec2,
  ArtPaint,
} from '@/model/types';
import type { PolyShape } from '@/geom/types';
import type { ParamDef, Params } from './params/types';
import type { Diagnostic, StitchRun } from './types';

export interface ShapeInfo {
  hasClosed: boolean;
  hasOpen: boolean;
}

export interface Hints {
  entry?: Vec2;
  exit?: Vec2;
  /** True when `exit` was placed by the user (not inferred from the next element). */
  userExit?: boolean;
  /** True when `entry` was placed by the user. */
  userEntry?: boolean;
}

export interface EngineCtx {
  settings: DesignSettings;
  diag(code: string, message: string, at?: Vec2, severity?: Diagnostic['severity']): void;
  /** Curve flattening tolerance (mm). */
  tolerance: number;
  /** Original artwork paint of the shape (satin width defaults to stroke width). */
  art?: ArtPaint;
  /** For cutout growth: union of regions sewn later that may cover this fill's seams. */
  growClip?: PolyShape;
}

export interface StitchTypeDef<Prep = unknown> {
  id: StitchType;
  label: string;
  /** Short help shown in the type picker. */
  description: string;
  role: ElementRole;
  params: ParamDef[];
  defaults: Params;
  aliasOf?: StitchType;
  appliesTo(shape: ShapeInfo): boolean;
  /** Heavy work depending only on geometry and parameters (cached). */
  prepare(geom: PathGeom, params: Params, el: StitchElement, ctx: EngineCtx): Prep;
  /** Cheap work depending on neighbours: choose entry/exit, order sections, emit needle points. */
  route(prep: Prep, hints: Hints, ctx: EngineCtx): StitchRun;
}

export function emptyRun(): StitchRun {
  return { xy: new Float64Array(0), flags: new Uint8Array(0) };
}
