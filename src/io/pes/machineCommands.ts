// SPDX-License-Identifier: GPL-3.0-or-later
// StitchPlan → machine commands (integer 0.1 mm), plus a normalisation pass that
// reproduces what pyembroidery's encoder (EmbEncoder.Transcoder with the PesWriter
// settings) feeds to the PES/PEC writers, so our output is byte-identical.
// Normalisation ported from pyembroidery's EmbEncoder.py and EmbPattern.py
// (pyembroidery, MIT License, Copyright (c) 2018 Tatarize).
import { COMMAND_MASK, F, type StitchPlan } from '@/engine/types';

/** Machine command codes (same numbering as pyembroidery's EmbConstant). */
export const MC = {
  STITCH: 0,
  JUMP: 1,
  TRIM: 2,
  STOP: 3,
  END: 4,
  COLOR_CHANGE: 5,
} as const;
export type MachineCmd = (typeof MC)[keyof typeof MC];
export type MachineCmdName = keyof typeof MC;

export const MC_NAME: Record<MachineCmd, MachineCmdName> = {
  0: 'STITCH',
  1: 'JUMP',
  2: 'TRIM',
  3: 'STOP',
  4: 'END',
  5: 'COLOR_CHANGE',
};

export interface MachineCommand {
  /** Absolute position in 0.1 mm units, +y down. Integers, except interpolated split-jump points. */
  x: number;
  y: number;
  cmd: MachineCmd;
}

export interface MachineProgram {
  commands: MachineCommand[];
  /**
   * Colour segments are separated by COLOR_CHANGE and STOP commands. Entry `k` is the
   * index into `plan.colorBlocks` of the thread sewn in segment `k` (-1 when the plan has
   * no colour blocks). Length = (#COLOR_CHANGE + #STOP) + 1.
   */
  segmentBlocks: number[];
}

/** PesWriter settings: MAX_JUMP_DISTANCE / MAX_STITCH_DISTANCE (0.1 mm units). */
export const PES_MAX_JUMP = 2047;
export const PES_MAX_STITCH = 2047;

/** mm → integer 0.1 mm (never -0). */
export function toUnits(mm: number): number {
  return Math.round(mm * 10) || 0;
}

function blockIndexAt(plan: StitchPlan, i: number): number {
  const blocks = plan.colorBlocks;
  if (blocks.length === 0) return -1;
  let fallback = 0;
  for (let b = 0; b < blocks.length; b++) {
    const blk = blocks[b];
    if (i >= blk.start && i < blk.end) return b;
    if (blk.start <= i) fallback = b;
  }
  return fallback;
}

/**
 * Converts a plan into absolute integer 0.1 mm machine commands. Informational flag bits
 * (TIE/UNDERLAY/TRAVEL) are ignored. Positions are rounded per command, so deltas taken
 * from them never accumulate rounding error. An END is guaranteed as the last command;
 * anything after the plan's first END is dropped.
 */
export function toMachineCommands(plan: StitchPlan): MachineProgram {
  const n = plan.flags.length;
  const commands: MachineCommand[] = [];
  const segmentBlocks: number[] = [];
  // Index (in plan) of the boundary command that started the current segment.
  let segStartIndex = -1;
  let segFirstStitch = -1;
  let lastX = 0;
  let lastY = 0;

  const closeSegment = () => {
    let b: number;
    if (segFirstStitch >= 0) b = blockIndexAt(plan, segFirstStitch);
    else if (segStartIndex >= 0) b = blockIndexAt(plan, Math.min(segStartIndex + 1, Math.max(n - 1, 0)));
    else b = blockIndexAt(plan, 0);
    segmentBlocks.push(b);
  };

  let ended = false;
  for (let i = 0; i < n && !ended; i++) {
    const f = plan.flags[i] & COMMAND_MASK;
    const x = toUnits(plan.x[i]);
    const y = toUnits(plan.y[i]);
    const push = (cmd: MachineCmd) => commands.push({ x, y, cmd });
    if (f === 0) {
      push(MC.STITCH);
      if (segFirstStitch < 0) segFirstStitch = i;
    } else if (f & F.END) {
      push(MC.END);
      ended = true;
    } else if (f & (F.COLOR_CHANGE | F.STOP)) {
      closeSegment();
      push(f & F.COLOR_CHANGE ? MC.COLOR_CHANGE : MC.STOP);
      segStartIndex = i;
      segFirstStitch = -1;
    } else {
      if (f & F.TRIM) push(MC.TRIM);
      if (f & F.JUMP) push(MC.JUMP);
    }
    lastX = x;
    lastY = y;
  }
  closeSegment();
  if (!ended) commands.push({ x: lastX, y: lastY, cmd: MC.END });
  return { commands, segmentBlocks };
}

export interface NormalizedPes {
  /**
   * Low-level commands exactly as pyembroidery's PES writer would see them after
   * `get_normalized_pattern()` and `interpolate_stop_as_duplicate_color()`:
   * STITCH, JUMP, TRIM, COLOR_CHANGE (STOPs already converted) and a final END.
   */
  commands: MachineCommand[];
  /**
   * One entry per PEC colour (pyembroidery `pattern.threadlist`), holding the
   * `plan.colorBlocks` index of that colour. Length = #COLOR_CHANGE + 1 when anything is sewn.
   */
  colorSlots: number[];
  /** Number of colour changes that came from STOP commands. */
  stops: number;
}

/**
 * Port of pyembroidery `Transcoder.transcode_main` restricted to the commands we emit,
 * with PesWriter's settings (max_jump = max_stitch = 2047, full_jump, round, no ties,
 * implicit trims, long stitches → needle jumps), followed by
 * `interpolate_stop_as_duplicate_color`.
 *
 * Notable behaviour (all pyembroidery's):
 * - The needle starts at (0, 0); the first stitch is preceded by a JUMP to it.
 * - Every stitch after a TRIM / colour change gets a JUMP to it unless already there.
 * - TRIM is only emitted when the thread is not already trimmed; JUMPs never trim by
 *   themselves here (the PEC encoder marks every jump but the very first with the
 *   trim flag anyway).
 * - Moves longer than 2047 units on either axis are split into equal JUMP steps
 *   (fractional positions, rounded half-to-even later by the encoders).
 * - A STOP becomes a COLOR_CHANGE that repeats the thread (a new colour slot).
 */
export function normalizeForPes(
  program: MachineProgram,
  maxJump = PES_MAX_JUMP,
  maxStitch = PES_MAX_STITCH,
): NormalizedPes {
  const out: MachineCommand[] = [];
  const colorSlots: number[] = [];
  const segBlocks = program.segmentBlocks;
  const segBlock = (s: number) => (segBlocks.length ? segBlocks[Math.min(s, segBlocks.length - 1)] : -1);
  let nx = 0;
  let ny = 0;
  let trimmed = true;
  let order = -1;
  let seg = 0;
  let stops = 0;

  const add = (cmd: MachineCmd, x = nx, y = ny) => out.push({ x, y, cmd });
  const interpolateGap = (x1: number, y1: number, maxLength: number) => {
    const dx = x1 - nx;
    const dy = y1 - ny;
    if (Math.abs(dx) > maxLength || Math.abs(dy) > maxLength) {
      const stepsX = Math.ceil(Math.abs(dx / maxLength));
      const stepsY = Math.ceil(Math.abs(dy / maxLength));
      const steps = stepsX > stepsY ? stepsX : stepsY;
      const sx = dx / steps;
      const sy = dy / steps;
      let qx = nx;
      let qy = ny;
      for (let q = 1; q < steps; q++) {
        qx += sx;
        qy += sy;
        add(MC.JUMP, qx, qy);
        nx = qx;
        ny = qy;
      }
    }
  };
  const jumpAt = (x: number, y: number) => {
    add(MC.JUMP, x, y);
    nx = x;
    ny = y;
  };
  const stitchAt = (x: number, y: number) => {
    add(MC.STITCH, x, y);
    nx = x;
    ny = y;
  };

  let sawEnd = false;
  for (const c of program.commands) {
    const { x, y } = c;
    if (c.cmd === MC.STITCH) {
      if (trimmed) {
        // declare_not_trimmed
        if (order === -1) {
          order = 0;
          colorSlots.push(segBlock(seg));
        }
        trimmed = false;
        // jump_to_within_stitchrange (full_jump)
        interpolateGap(x, y, maxJump);
        if (nx !== x || ny !== y) jumpAt(x, y);
        stitchAt(x, y);
      } else {
        // stitch_with_contingency → needle_to (CONTINGENCY_LONG_STITCH_JUMP_NEEDLE)
        interpolateGap(x, y, maxStitch);
        stitchAt(x, y);
      }
    } else if (c.cmd === MC.JUMP) {
      interpolateGap(x, y, maxJump);
      jumpAt(x, y);
    } else if (c.cmd === MC.TRIM) {
      if (!trimmed) {
        add(MC.TRIM);
        trimmed = true;
      }
    } else if (c.cmd === MC.COLOR_CHANGE) {
      seg++;
      // tie_off_trim_color_change → next_change_sequence
      order++;
      colorSlots.push(segBlock(seg));
      if (order !== 0) add(MC.COLOR_CHANGE);
      trimmed = true;
    } else if (c.cmd === MC.STOP) {
      seg++;
      // stop_here, later interpolate_stop_as_duplicate_color → COLOR_CHANGE + new colour slot
      add(MC.COLOR_CHANGE);
      colorSlots.push(segBlock(seg));
      stops++;
      trimmed = true;
    } else if (c.cmd === MC.END) {
      add(MC.END);
      sawEnd = true;
      break;
    }
  }
  if (!sawEnd) add(MC.END);
  return { commands: out, colorSlots, stops };
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** pyembroidery `pattern.bounds()`: over every command position. Empty → ±Infinity. */
export function commandBounds(commands: readonly MachineCommand[]): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of commands) {
    if (c.x > maxX) maxX = c.x;
    if (c.x < minX) minX = c.x;
    if (c.y > maxY) maxY = c.y;
    if (c.y < minY) minY = c.y;
  }
  return { minX, minY, maxX, maxY };
}
