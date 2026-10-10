// SPDX-License-Identifier: GPL-3.0-or-later
// Melco / Bernina EXP writer: no header, 2-byte signed stitch deltas and 4-byte 0x80-escaped
// commands (jump 0x80 0x04, trim 0x80 0x80, colour change / stop 0x80 0x01). No colours.
// Ported from pyembroidery's ExpWriter.py (pyembroidery, MIT License, Copyright (c) 2018 Tatarize).
import type { StitchPlan } from '@/engine/types';
import type { Design } from '@/model/types';
import { pyRound } from '@/io/pes/pymath';
import { MC, buildFormatPattern, FormatWriter, type EncoderSettings, type FormatPattern } from './encoder';

/** ExpWriter: FULL_JUMP = True, ROUND = True, max 127 (12.7 mm). */
export const EXP_SETTINGS: EncoderSettings = { maxJump: 127, maxStitch: 127, fullJump: true, stops: 'stop' };

/** Writes a StitchPlan as an EXP file. */
export function writeExp(plan: StitchPlan, design: Pick<Design, 'name' | 'threads'>): Uint8Array {
  return writeExpPattern(buildFormatPattern(plan, design, EXP_SETTINGS));
}

/** Encodes an already-normalised pattern (pyembroidery ExpWriter.write). */
export function writeExpPattern(pattern: FormatPattern): Uint8Array {
  const w = new FormatWriter(pattern.commands.length * 4 + 16);
  let xx = 0;
  let yy = 0;
  for (const c of pattern.commands) {
    const dx = pyRound(c.x - xx);
    const dy = pyRound(c.y - yy);
    xx += dx;
    yy += dy;
    if (c.cmd === MC.STITCH) {
      w.bytes([dx & 0xff, -dy & 0xff]);
    } else if (c.cmd === MC.JUMP) {
      w.bytes([0x80, 0x04, dx & 0xff, -dy & 0xff]);
    } else if (c.cmd === MC.TRIM) {
      w.bytes([0x80, 0x80, 0x07, 0x00]);
    } else if (c.cmd === MC.COLOR_CHANGE || c.cmd === MC.STOP) {
      w.bytes([0x80, 0x01, 0x00, 0x00]);
    }
    // END writes nothing.
  }
  return w.toUint8Array();
}
