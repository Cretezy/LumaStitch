// SPDX-License-Identifier: GPL-3.0-or-later
// Shared plumbing for the non-PES machine formats (DST, JEF, EXP, VP3): a parametrised port
// of pyembroidery's encoder (EmbEncoder.Transcoder, as driven by EmbPattern.write_embroidery
// with each writer's MAX_JUMP_DISTANCE / MAX_STITCH_DISTANCE / FULL_JUMP / ROUND settings),
// thread records per colour slot, and a big-endian capable byte writer.
// Ported from pyembroidery's EmbEncoder.py, EmbPattern.py and EmbThread.py
// (pyembroidery, MIT License, Copyright (c) 2018 Tatarize).
import type { StitchPlan } from '@/engine/types';
import type { Design } from '@/model/types';
import { ByteWriter } from '@/io/pes/bytes';
import {
  MC,
  commandBounds,
  toMachineCommands,
  type Bounds,
  type MachineCmd,
  type MachineCommand,
  type MachineProgram,
} from '@/io/pes/machineCommands';

export { MC, commandBounds, type Bounds, type MachineCommand };

/** The writer-specific encoder settings pyembroidery reads from each writer module. */
export interface EncoderSettings {
  /** MAX_JUMP_DISTANCE (0.1 mm). Longer moves are split into equal jumps. */
  maxJump: number;
  /** MAX_STITCH_DISTANCE (0.1 mm). Longer stitches become jumps + a stitch (needle jump). */
  maxStitch: number;
  /**
   * FULL_JUMP: after a trim / colour change, jump all the way to the next stitch. Without it
   * the encoder only jumps to within stitch range and sews the remaining distance.
   */
  fullJump: boolean;
  /**
   * 'stop' keeps STOP commands (pyembroidery default for these writers). 'colorChange'
   * treats every STOP as a colour change to the same thread, like pyembroidery's
   * `interpolate_stop_as_duplicate_color()` applied to the pattern before writing.
   */
  stops: 'stop' | 'colorChange';
}

export interface EncodedProgram {
  /** Low-level commands: STITCH, JUMP, TRIM, STOP, COLOR_CHANGE and a final END. */
  commands: MachineCommand[];
  /**
   * One entry per thread in pyembroidery's normalised `threadlist`: the `plan.colorBlocks`
   * index sewn in that colour slot (-1 without colour blocks). Slots start at the first
   * stitch and at every COLOR_CHANGE (and every STOP in 'colorChange' mode).
   */
  colorSlots: number[];
}

/**
 * Port of pyembroidery `Transcoder.transcode_main` for the commands a StitchPlan produces,
 * with explicit_trim off, no ties, rounding on and long stitches → needle jumps.
 *
 * - The needle starts at (0, 0); after a trim or colour change, the next stitch is reached
 *   with jumps no longer than `maxJump` (and a final jump onto it when `fullJump`).
 * - TRIM is only emitted when the thread is not already trimmed.
 * - Interpolated jump positions are fractional; the format encoders round (or truncate) them.
 */
export function encodeProgram(program: MachineProgram, settings: EncoderSettings): EncodedProgram {
  const { maxJump, maxStitch, fullJump } = settings;
  const out: MachineCommand[] = [];
  const colorSlots: number[] = [];
  const segBlocks = program.segmentBlocks;
  const segBlock = (s: number) => (segBlocks.length ? segBlocks[Math.min(s, segBlocks.length - 1)] : -1);
  let nx = 0;
  let ny = 0;
  let trimmed = true;
  let order = -1;
  let seg = 0;

  const add = (cmd: MachineCmd, x = nx, y = ny) => out.push({ x, y, cmd });
  // interpolate_gap_stitches(…, JUMP): the gap jumps only, never the end point.
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
  const moveTo = (cmd: MachineCmd, x: number, y: number) => {
    add(cmd, x, y);
    nx = x;
    ny = y;
  };
  // next_change_sequence with thread_change_command = COLOR_CHANGE.
  const nextChange = () => {
    order++;
    colorSlots.push(segBlock(seg));
    if (order !== 0) add(MC.COLOR_CHANGE);
    trimmed = true;
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
        // jump_to_within_stitchrange
        interpolateGap(x, y, maxJump);
        if (fullJump && (nx !== x || ny !== y)) moveTo(MC.JUMP, x, y);
        moveTo(MC.STITCH, x, y);
      } else {
        // stitch_with_contingency → needle_to (CONTINGENCY_LONG_STITCH_JUMP_NEEDLE)
        interpolateGap(x, y, maxStitch);
        moveTo(MC.STITCH, x, y);
      }
    } else if (c.cmd === MC.JUMP) {
      // jump_to
      interpolateGap(x, y, maxJump);
      moveTo(MC.JUMP, x, y);
    } else if (c.cmd === MC.TRIM) {
      // tie_off_and_trim_if_needed
      if (!trimmed) {
        add(MC.TRIM);
        trimmed = true;
      }
    } else if (c.cmd === MC.COLOR_CHANGE) {
      seg++;
      // tie_off_trim_color_change
      nextChange();
    } else if (c.cmd === MC.STOP) {
      seg++;
      if (settings.stops === 'colorChange') nextChange();
      else {
        // stop_here
        add(MC.STOP);
        trimmed = true;
      }
    } else if (c.cmd === MC.END) {
      add(MC.END);
      sawEnd = true;
      break;
    }
  }
  if (!sawEnd) add(MC.END);
  return { commands: out, colorSlots };
}

/** Thread record as pyembroidery's EmbThread carries it. */
export interface FormatThread {
  /** #rrggbb */
  color: string;
  description?: string;
  catalogNumber?: string;
  brand?: string;
  chart?: string;
}

/** Resolves a `Thread.chart` id to human-readable brand / chart names. */
export type ChartResolver = (chartId: string) => { brand?: string; chart?: string } | undefined;

/** A normalised pattern, ready for a format writer. */
export interface FormatPattern {
  commands: MachineCommand[];
  /** One thread per colour slot (pyembroidery `threadlist`). */
  threads: FormatThread[];
  /** Design name. */
  name: string;
}

/** StitchPlan → pattern normalised with a writer's encoder settings. */
export function buildFormatPattern(
  plan: StitchPlan,
  design: Pick<Design, 'name' | 'threads'>,
  settings: EncoderSettings,
  resolveChart?: ChartResolver,
): FormatPattern {
  const enc = encodeProgram(toMachineCommands(plan), settings);
  const threads = enc.colorSlots.map((b) => threadForBlock(plan, design, b, resolveChart));
  return { commands: enc.commands, threads, name: design.name };
}

function threadForBlock(
  plan: StitchPlan,
  design: Pick<Design, 'threads'>,
  blockIndex: number,
  resolveChart: ChartResolver | undefined,
): FormatThread {
  const block = blockIndex >= 0 ? plan.colorBlocks[blockIndex] : undefined;
  if (!block) return { color: '#000000' };
  const t = design.threads[block.threadId];
  const info: FormatThread = { color: block.color.toLowerCase() };
  if (!t) return info;
  if (t.name) info.description = t.name;
  if (t.code) info.catalogNumber = t.code;
  if (t.chart) {
    const r = resolveChart?.(t.chart);
    info.brand = r?.brand ?? t.chart;
    info.chart = r?.chart ?? t.chart;
  }
  return info;
}

/** pyembroidery `EmbThread.__eq__`: colour and every metadata field. */
export function threadKey(t: FormatThread): string {
  return JSON.stringify([
    t.color.toLowerCase(),
    t.description ?? null,
    t.catalogNumber ?? null,
    t.brand ?? null,
    t.chart ?? null,
  ]);
}

/** Number of commands of a kind (pyembroidery `count_stitch_commands`). */
export function countCommands(commands: readonly MachineCommand[], cmd: MachineCmd): number {
  let n = 0;
  for (const c of commands) if (c.cmd === cmd) n++;
  return n;
}

/**
 * Printable-ASCII machine label: accents are stripped, other characters become '_'.
 * Formats with fixed-size text headers need single-byte characters.
 */
export function asciiLabel(name: string, maxChars: number): string {
  const ascii = (name.trim() || 'Untitled')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7e]/g, '_');
  return ascii.slice(0, maxChars);
}

/** ByteWriter with the big-endian helpers VP3 needs. */
export class FormatWriter extends ByteWriter {
  int24be(v: number): void {
    this.bytes([(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff]);
  }

  int32be(v: number): void {
    this.bytes([(v >> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff]);
  }

  patchInt32be(pos: number, v: number): void {
    this.patchInt16le(pos, ((v >>> 24) & 0xff) | (((v >>> 16) & 0xff) << 8));
    this.patchInt16le(pos + 2, ((v >>> 8) & 0xff) | ((v & 0xff) << 8));
  }

  /** ASCII text (callers pass printable ASCII). */
  ascii(s: string): void {
    for (let i = 0; i < s.length; i++) this.int8(s.charCodeAt(i));
  }
}
