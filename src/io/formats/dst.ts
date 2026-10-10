// SPDX-License-Identifier: GPL-3.0-or-later
// Tajima DST writer: 512-byte text header (label, stitch count, colour count, extents),
// then 3-byte stitch records with balanced-ternary deltas. Trims are written as three
// small jumps, colour changes and stops as stop records. DST stores no thread colours.
// Ported from pyembroidery's DstWriter.py (pyembroidery, MIT License, Copyright (c) 2018 Tatarize).
import type { StitchPlan } from '@/engine/types';
import type { Design } from '@/model/types';
import { pyInt, pyRound } from '@/io/pes/pymath';
import {
  MC,
  asciiLabel,
  buildFormatPattern,
  commandBounds,
  countCommands,
  FormatWriter,
  type EncoderSettings,
  type FormatPattern,
} from './encoder';

/** DstWriter: SEQUIN_CONTINGENCY = UTILIZE, FULL_JUMP = False, ROUND = True, max 121 (12.1 mm). */
export const DST_SETTINGS: EncoderSettings = { maxJump: 121, maxStitch: 121, fullJump: false, stops: 'stop' };
/** Largest delta one record encodes (1 + 3 + 9 + 27 + 81). */
export const DST_MAX_DELTA = 121;
export const DST_HEADER_SIZE = 512;
/** The LA: header field is 16 characters wide. */
export const DST_LABEL_CHARS = 16;

export interface DstWriteOptions {
  /** Number of jump records a trim is written as (pyembroidery `trim_at`, default 3). */
  trimAt?: number;
}

/** The machine label stored in the header (printable ASCII, 16 characters). */
export function dstLabel(name: string): string {
  return asciiLabel(name, DST_LABEL_CHARS);
}

/** Writes a StitchPlan as a DST file. */
export function writeDst(
  plan: StitchPlan,
  design: Pick<Design, 'name' | 'threads'>,
  opts: DstWriteOptions = {},
): Uint8Array {
  return writeDstPattern(buildFormatPattern(plan, design, DST_SETTINGS), opts);
}

const bit = (b: number) => 1 << b;

/** pyembroidery `encode_record`. Throws when a delta exceeds ±121. */
export function encodeDstRecord(x: number, yIn: number, cmd: number): [number, number, number] {
  let y = -yIn; // DST is +y up
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  if (cmd === MC.JUMP) b2 += bit(7);
  if (cmd === MC.STITCH || cmd === MC.JUMP) {
    b2 += bit(0) + bit(1);
    if (x > 40) {
      b2 += bit(2);
      x -= 81;
    }
    if (x < -40) {
      b2 += bit(3);
      x += 81;
    }
    if (x > 13) {
      b1 += bit(2);
      x -= 27;
    }
    if (x < -13) {
      b1 += bit(3);
      x += 27;
    }
    if (x > 4) {
      b0 += bit(2);
      x -= 9;
    }
    if (x < -4) {
      b0 += bit(3);
      x += 9;
    }
    if (x > 1) {
      b1 += bit(0);
      x -= 3;
    }
    if (x < -1) {
      b1 += bit(1);
      x += 3;
    }
    if (x > 0) {
      b0 += bit(0);
      x -= 1;
    }
    if (x < 0) {
      b0 += bit(1);
      x += 1;
    }
    if (x !== 0) throw new RangeError('The dx value given to the DST writer exceeds the maximum allowed.');
    if (y > 40) {
      b2 += bit(5);
      y -= 81;
    }
    if (y < -40) {
      b2 += bit(4);
      y += 81;
    }
    if (y > 13) {
      b1 += bit(5);
      y -= 27;
    }
    if (y < -13) {
      b1 += bit(4);
      y += 27;
    }
    if (y > 4) {
      b0 += bit(5);
      y -= 9;
    }
    if (y < -4) {
      b0 += bit(4);
      y += 9;
    }
    if (y > 1) {
      b1 += bit(7);
      y -= 3;
    }
    if (y < -1) {
      b1 += bit(6);
      y += 3;
    }
    if (y > 0) {
      b0 += bit(7);
      y -= 1;
    }
    if (y < 0) {
      b0 += bit(6);
      y += 1;
    }
    if (y !== 0) throw new RangeError('The dy value given to the DST writer exceeds the maximum allowed.');
  } else if (cmd === MC.COLOR_CHANGE || cmd === MC.STOP) {
    b2 = 0b11000011;
  } else if (cmd === MC.END) {
    b2 = 0b11110011;
  }
  return [b0, b1, b2];
}

/** Python `"%Nd" % v` (v truncated toward zero), right-aligned. */
const padNum = (v: number, width: number) => String(pyInt(v)).padStart(width, ' ');

/** Encodes an already-normalised pattern (pyembroidery DstWriter.write, default header). */
export function writeDstPattern(pattern: FormatPattern, opts: DstWriteOptions = {}): Uint8Array {
  const trimAt = opts.trimAt ?? 3;
  const { commands } = pattern;
  const w = new FormatWriter(DST_HEADER_SIZE + commands.length * 3 + 16);
  const b = commandBounds(commands);
  const label = dstLabel(pattern.name);

  w.ascii(`LA:${label.padEnd(16, ' ')}\r`);
  w.ascii(`ST:${padNum(commands.length, 7)}\r`);
  w.ascii(`CO:${padNum(countCommands(commands, MC.COLOR_CHANGE), 3)}\r`);
  w.ascii(`+X:${padNum(Math.abs(b.maxX), 5)}\r`);
  w.ascii(`-X:${padNum(Math.abs(b.minX), 5)}\r`);
  w.ascii(`+Y:${padNum(Math.abs(b.maxY), 5)}\r`);
  w.ascii(`-Y:${padNum(Math.abs(b.minY), 5)}\r`);
  let ax = 0;
  let ay = 0;
  if (commands.length > 0) {
    const last = commands[commands.length - 1];
    ax = pyInt(last.x);
    ay = -pyInt(last.y) || 0;
  }
  w.ascii(ax >= 0 ? `AX:+${padNum(ax, 5)}\r` : `AX:-${padNum(Math.abs(ax), 5)}\r`);
  w.ascii(ay >= 0 ? `AY:+${padNum(ay, 5)}\r` : `AY:-${padNum(Math.abs(ay), 5)}\r`);
  w.ascii(`MX:+${padNum(0, 5)}\r`);
  w.ascii(`MY:+${padNum(0, 5)}\r`);
  w.ascii(`PD:${'******'.padStart(6, ' ')}\r`);
  w.int8(0x1a);
  w.fill(0x20, DST_HEADER_SIZE - w.position);

  let xx = 0;
  let yy = 0;
  for (const c of commands) {
    const dx = pyRound(c.x - xx);
    const dy = pyRound(c.y - yy);
    xx += dx;
    yy += dy;
    if (c.cmd === MC.TRIM) {
      let delta = -4;
      w.bytes(encodeDstRecord(-delta / 2, -delta / 2, MC.JUMP));
      for (let p = 1; p < trimAt - 1; p++) {
        w.bytes(encodeDstRecord(delta, delta, MC.JUMP));
        delta = -delta;
      }
      w.bytes(encodeDstRecord(delta / 2, delta / 2, MC.JUMP));
    } else {
      w.bytes(encodeDstRecord(dx, dy, c.cmd));
    }
  }
  return w.toUint8Array();
}
