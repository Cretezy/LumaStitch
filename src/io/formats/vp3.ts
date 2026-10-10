// SPDX-License-Identifier: GPL-3.0-or-later
// Husqvarna Viking / Pfaff VP3 writer: nested length-prefixed big-endian blocks (file →
// design → one block per colour), each colour block carrying the thread RGB, catalogue
// code, name and brand, then stitch deltas relative to the block start. VP3 has no jump
// command: jumps are folded into the next stitch (long form beyond ±127).
// Ported from pyembroidery's Vp3Writer.py (pyembroidery, MIT License, Copyright (c) 2018 Tatarize).
import type { StitchPlan } from '@/engine/types';
import type { Design } from '@/model/types';
import { utf8Bytes } from '@/io/pes/bytes';
import { pyInt } from '@/io/pes/pymath';
import {
  MC,
  buildFormatPattern,
  commandBounds,
  countCommands,
  FormatWriter,
  type ChartResolver,
  type EncoderSettings,
  type FormatPattern,
  type FormatThread,
  type MachineCommand,
} from './encoder';

/**
 * Vp3Writer: FULL_JUMP = False, ROUND = True, MAX_JUMP_DISTANCE = 3200, MAX_STITCH_DISTANCE = 255.
 * Stops become colour changes to the same thread by default (VP3 has no stop command;
 * machines pause at every colour block), see `Vp3WriteOptions.stops`.
 */
export const VP3_SETTINGS: EncoderSettings = {
  maxJump: 3200,
  maxStitch: 255,
  fullJump: false,
  stops: 'colorChange',
};
/** pyembroidery's default (stops are dropped by the writer). */
export const VP3_SETTINGS_IGNORE_STOPS: EncoderSettings = { ...VP3_SETTINGS, stops: 'stop' };
/** Colour block counts are stored in one byte of the file header. */
export const VP3_MAX_COLOR_BLOCKS = 255;
/** Long-form stitch deltas are int16. */
export const VP3_MAX_DELTA = 32767;

const PRODUCER = 'Produced by     Software Ltd';

export interface Vp3WriteOptions {
  /**
   * 'colorChange' (default): every stop becomes a colour block with the same thread, so the
   * machine pauses there. 'ignore': pyembroidery's behaviour, stops are dropped.
   */
  stops?: 'colorChange' | 'ignore';
  resolveChart?: ChartResolver;
}

/** Writes a StitchPlan as a VP3 file. */
export function writeVp3(
  plan: StitchPlan,
  design: Pick<Design, 'name' | 'threads'>,
  opts: Vp3WriteOptions = {},
): Uint8Array {
  const settings = opts.stops === 'ignore' ? VP3_SETTINGS_IGNORE_STOPS : VP3_SETTINGS;
  return writeVp3Pattern(buildFormatPattern(plan, design, settings, opts.resolveChart));
}

/** String with a 16-bit big-endian byte-length prefix (UTF-8). */
function string8(w: FormatWriter, s: string): void {
  const b = utf8Bytes(s);
  w.int16be(b.length);
  w.bytes(b);
}

/** String with a 16-bit big-endian byte-length prefix (UTF-16BE). */
function string16(w: FormatWriter, s: string): void {
  w.int16be(s.length * 2);
  for (let i = 0; i < s.length; i++) w.int16be(s.charCodeAt(i));
}

/** Writes a 32-bit placeholder; the returned function patches in the distance to "here". */
function placeholder(w: FormatWriter): () => void {
  const at = w.position;
  w.int32be(0);
  return () => w.patchInt32be(at, w.position - at - 4);
}

/** pyembroidery `get_as_colorblocks`: split before every COLOR_CHANGE (which opens the next block). */
export function vp3ColorBlocks(
  pattern: FormatPattern,
): { commands: MachineCommand[]; thread: FormatThread }[] {
  const out: { commands: MachineCommand[]; thread: FormatThread }[] = [];
  const cmds = pattern.commands;
  let threadIndex = 0;
  let last = 0;
  const thread = (i: number) => pattern.threads[i] ?? { color: '#000000' };
  for (let pos = 0; pos < cmds.length; pos++) {
    if (cmds[pos].cmd !== MC.COLOR_CHANGE) continue;
    out.push({ commands: cmds.slice(last, pos), thread: thread(threadIndex++) });
    last = pos;
  }
  out.push({ commands: cmds.slice(last), thread: thread(threadIndex) });
  return out;
}

/** Encodes an already-normalised pattern (pyembroidery Vp3Writer.write). */
export function writeVp3Pattern(pattern: FormatPattern): Uint8Array {
  const w = new FormatWriter(1024 + pattern.commands.length * 3);
  w.ascii('%vsm%');
  w.int8(0);
  string16(w, PRODUCER);

  // write_file
  w.bytes([0x00, 0x02, 0x00]);
  const endOfFileBlock = placeholder(w);
  string16(w, '');
  const blocks = vp3ColorBlocks(pattern);
  const b = commandBounds(pattern.commands);
  w.int32be(pyInt(b.maxX * 100));
  w.int32be(pyInt(b.minY * -100));
  w.int32be(pyInt(b.minX * 100));
  w.int32be(pyInt(b.maxY * -100));
  w.int32be(pattern.commands.length - countCommands(pattern.commands, MC.END));
  w.int8(0);
  w.int8(blocks.length);
  w.int8(12);
  w.int8(0);
  w.int8(1); // number of designs

  // write_design_block
  w.bytes([0x00, 0x03, 0x00]);
  const endOfDesignBlock = placeholder(w);
  const width = b.maxX - b.minX;
  const height = b.maxY - b.minY;
  const halfW = width / 2;
  const halfH = height / 2;
  const cx = b.maxX - halfW;
  const cy = b.maxY - halfH;
  w.int32be(pyInt(cx) * 100);
  w.int32be(pyInt(cy) * -100);
  w.bytes([0, 0, 0]);
  w.int32be(pyInt(halfW) * -100);
  w.int32be(pyInt(halfW) * 100);
  w.int32be(pyInt(halfH) * -100);
  w.int32be(pyInt(halfH) * 100);
  w.int32be(pyInt(width) * 100);
  w.int32be(pyInt(height) * 100);
  string16(w, '');
  w.bytes([0x64, 0x64]);
  w.int32be(4096);
  w.int32be(0);
  w.int32be(0);
  w.int32be(4096);
  w.bytes([0x78, 0x78, 0x50, 0x50, 0x01, 0x00]); // "xxPP\x01\x00"
  string16(w, PRODUCER);
  w.int16be(blocks.length);
  blocks.forEach((blk, i) => writeColorBlock(w, i === 0, cx, cy, blk.commands, blk.thread));
  endOfDesignBlock();
  endOfFileBlock();
  return w.toUint8Array();
}

function writeColorBlock(
  w: FormatWriter,
  first: boolean,
  cx: number,
  cy: number,
  cmds: readonly MachineCommand[],
  thread: FormatThread,
): void {
  w.bytes([0x00, 0x05, 0x00]);
  const endOfColorBlock = placeholder(w);
  let firstX = 0;
  let firstY = 0;
  let lastX = 0;
  let lastY = 0;
  if (cmds.length > 0) {
    if (!first) {
      firstX = cmds[0].x;
      firstY = cmds[0].y;
    }
    lastX = cmds[cmds.length - 1].x;
    lastY = cmds[cmds.length - 1].y;
  }
  w.int32be(pyInt(firstX - cx) * 100);
  w.int32be(pyInt(-(firstY - cy)) * 100);
  writeThread(w, thread);
  w.int32be(pyInt(lastX - firstX) * 100);
  w.int32be(pyInt(-(lastY - firstY)) * 100);
  writeStitches(w, cmds, firstX, firstY);
  w.int8(0);
  endOfColorBlock();
}

function writeThread(w: FormatWriter, t: FormatThread): void {
  w.bytes([0x01, 0x00]); // single colour, no transition
  w.int24be(parseInt(t.color.slice(1), 16) || 0);
  w.bytes([0x00, 0x00, 0x00, 0x05, 0x28]); // no parts, no length, rayon 40 weight
  string8(w, t.catalogNumber ?? '');
  string8(w, t.description ?? t.color.toLowerCase());
  string8(w, t.brand ?? '');
}

function writeStitches(
  w: FormatWriter,
  cmds: readonly MachineCommand[],
  firstX: number,
  firstY: number,
): void {
  w.bytes([0x00, 0x01, 0x00]);
  const endOfStitches = placeholder(w);
  w.bytes([0x0a, 0xf6, 0x00]);
  let lastX = firstX;
  let lastY = firstY;
  for (const c of cmds) {
    if (c.cmd === MC.END) {
      w.bytes([0x80, 0x03]); // explicit trim at the end: the machine does not auto-trim
      break;
    }
    if (c.cmd === MC.TRIM) {
      w.bytes([0x80, 0x03]);
      continue;
    }
    // Colour changes delimit blocks; stops and jumps are not written (jumps fold into the next stitch).
    if (c.cmd !== MC.STITCH) continue;
    const dx = pyInt(c.x - lastX);
    const dy = pyInt(c.y - lastY);
    lastX += dx;
    lastY += dy;
    if (dx >= -127 && dx <= 127 && dy >= -127 && dy <= 127) {
      w.int8(dx);
      w.int8(dy);
    } else {
      w.bytes([0x80, 0x01]);
      w.int16be(dx);
      w.int16be(dy);
      w.bytes([0x80, 0x02]);
    }
  }
  endOfStitches();
}

/** Largest stitch delta (either axis) the writer will produce, for validation against int16. */
export function vp3MaxDelta(pattern: FormatPattern): number {
  let max = 0;
  vp3ColorBlocks(pattern).forEach((blk, b) => {
    const start = b === 0 || blk.commands.length === 0 ? undefined : blk.commands[0];
    let lx = start ? start.x : 0;
    let ly = start ? start.y : 0;
    for (const c of blk.commands) {
      if (c.cmd === MC.END) break;
      if (c.cmd !== MC.STITCH) continue;
      const dx = pyInt(c.x - lx);
      const dy = pyInt(c.y - ly);
      lx += dx;
      ly += dy;
      max = Math.max(max, Math.abs(dx), Math.abs(dy));
    }
  });
  return max;
}
