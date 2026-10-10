// SPDX-License-Identifier: GPL-3.0-or-later
import type { Id, Vec2 } from '@/model/types';

/** Command flags. Low bits are machine commands; high bits are informational only. */
export const F = {
  STITCH: 0,
  JUMP: 1,
  TRIM: 2,
  COLOR_CHANGE: 4,
  STOP: 8,
  END: 16,
  // informational only (rendering/stats); export ignores them
  TIE: 32,
  UNDERLAY: 64,
  TRAVEL: 128,
} as const;
export type Flag = number;
/** Mask of the bits that are machine commands. */
export const COMMAND_MASK = F.JUMP | F.TRIM | F.COLOR_CHANGE | F.STOP | F.END;

/** Output of one element generator: needle points in sewing order. */
export interface StitchRun {
  /** Interleaved mm. */
  xy: Float64Array;
  /**
   * Per point: JUMP for internal jumps (JUMP | TRIM: no inside path, always trim), UNDERLAY,
   * TRAVEL, TIE. JUMP | STOP means "stop the machine here, then continue at this point" (the
   * sequencer emits tie-off, STOP, TRIM, JUMP, tie-in, like a stop entry in the sequence).
   */
  flags: Uint8Array;
}

export type Severity = 'error' | 'warning' | 'info';

export interface Diagnostic {
  severity: Severity;
  code: string;
  message: string;
  elementId?: Id;
  at?: Vec2;
}

export interface ColorBlock {
  threadId: Id;
  color: string;
  start: number;
  end: number;
}

export interface ElementRange {
  elementId: Id;
  start: number;
  end: number;
}

export interface PlanStats {
  stitches: number;
  jumps: number;
  trims: number;
  colorChanges: number;
  stops: number;
  threadLengthMm: number;
  estSeconds: number;
}

export interface StitchPlan {
  revision: number;
  /** One entry per command (mm). */
  x: Float32Array;
  y: Float32Array;
  flags: Uint8Array;
  /** Index into elementIds; 0xffffffff for commands not owned by an element. */
  element: Uint32Array;
  elementIds: Id[];
  elementRanges: ElementRange[];
  colorBlocks: ColorBlock[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  stats: PlanStats;
  diagnostics: Diagnostic[];
}

export const NO_ELEMENT = 0xffffffff;
