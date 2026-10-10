// SPDX-License-Identifier: GPL-3.0-or-later
import type { ParamValue } from '@/model/types';

export type ParamGroup = 'basic' | 'underlay' | 'compensation' | 'advanced';

export interface ParamDef {
  key: string;
  label: string;
  help?: string;
  kind: 'length' | 'number' | 'angle' | 'fraction' | 'boolean' | 'enum';
  unit?: 'mm' | '°' | '%';
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: string }[];
  group: ParamGroup;
  /** Value may be the string 'auto' (shown as an "Auto" toggle). */
  allowAuto?: boolean;
  /** Hidden from the Inspector (engine-internal, e.g. set by the image digitizer). */
  hidden?: boolean;
  visibleIf?: (p: Record<string, ParamValue>) => boolean;
}

export type Params = Record<string, ParamValue>;

export function num(p: Params, key: string, fallback = 0): number {
  const v = p[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

export function str(p: Params, key: string, fallback = ''): string {
  const v = p[key];
  return typeof v === 'string' ? v : fallback;
}

export function bool(p: Params, key: string, fallback = false): boolean {
  const v = p[key];
  return typeof v === 'boolean' ? v : fallback;
}
