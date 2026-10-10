// SPDX-License-Identifier: GPL-3.0-or-later
// Janome JEF writer: header with date, colour and point counts, the smallest Janome hoop the
// design fits, hoop edge distances, JEF palette indexes per colour (0 marks a stop), then
// 2-byte stitch deltas with 0x80-escaped jump / colour-change commands.
// Ported from pyembroidery's JefWriter.py (pyembroidery, MIT License, Copyright (c) 2018 Tatarize).
import type { StitchPlan } from '@/engine/types';
import type { Design } from '@/model/types';
import { findNearestIndex, type ColorMatch, metricOf } from '@/io/pes/pecPalette';
import { pyRound } from '@/io/pes/pymath';
import {
  MC,
  buildFormatPattern,
  commandBounds,
  FormatWriter,
  threadKey,
  type ChartResolver,
  type EncoderSettings,
  type FormatPattern,
  type FormatThread,
} from './encoder';
import { JEF_THREADS } from './jefThreads';

/** JefWriter: FULL_JUMP = True, ROUND = True, max 127 (12.7 mm). */
export const JEF_SETTINGS: EncoderSettings = { maxJump: 127, maxStitch: 127, fullJump: true, stops: 'stop' };

/** JEF hoop codes (pyembroidery HOOP_*). */
export const JEF_HOOP = {
  H110X110: 0,
  H50X50: 1,
  H140X200: 2,
  H126X110: 3,
  H200X200: 4,
} as const;

/** Hoops in the order the writer tries them (smallest first), sizes in mm. */
export const JEF_HOOPS: readonly { code: number; label: string; w: number; h: number }[] = [
  { code: JEF_HOOP.H50X50, label: '50 × 50 mm', w: 50, h: 50 },
  { code: JEF_HOOP.H126X110, label: '126 × 110 mm', w: 126, h: 110 },
  { code: JEF_HOOP.H140X200, label: '140 × 200 mm', w: 140, h: 200 },
  { code: JEF_HOOP.H200X200, label: '200 × 200 mm', w: 200, h: 200 },
];

export interface JefWriteOptions {
  /**
   * Header timestamp, `YYYYMMDDHHMMSS` (14 digits) or a Date (local time). Default: now.
   * pyembroidery's `date` setting; fixed in tests for byte-exact comparisons.
   */
  date?: string | Date;
  /** Write explicit trim commands (pyembroidery `trims`, default false: trims are implied by jumps). */
  trims?: boolean;
  /** Commands per explicit trim (pyembroidery `trim_at`, default 3). */
  trimAt?: number;
  /**
   * How design colours are mapped onto the JEF palette. Default 'ciede2000';
   * 'pyembroidery' (red-mean) reproduces pyembroidery exactly.
   */
  colorMatch?: ColorMatch;
}

/** Writes a StitchPlan as a JEF file. */
export function writeJef(
  plan: StitchPlan,
  design: Pick<Design, 'name' | 'threads'>,
  opts: JefWriteOptions & { resolveChart?: ChartResolver } = {},
): Uint8Array {
  return writeJefPattern(buildFormatPattern(plan, design, JEF_SETTINGS, opts.resolveChart), opts);
}

/**
 * pyembroidery `get_jef_hoop_size` (strict "<" comparisons, units 0.1 mm). Returns the
 * 110 × 110 code when nothing fits, like pyembroidery.
 */
export function jefHoopFor(widthUnits: number, heightUnits: number): { code: number; fits: boolean } {
  for (const h of JEF_HOOPS)
    if (widthUnits < h.w * 10 && heightUnits < h.h * 10) return { code: h.code, fits: true };
  return { code: JEF_HOOP.H110X110, fits: false };
}

/** Design extents (0.1 mm, rounded half-to-even) as the JEF header stores them. */
export function jefDesignSize(pattern: Pick<FormatPattern, 'commands'>): { width: number; height: number } {
  const b = commandBounds(pattern.commands);
  if (!Number.isFinite(b.minX)) return { width: 0, height: 0 };
  return { width: pyRound(b.maxX - b.minX), height: pyRound(b.maxY - b.minY) };
}

export interface JefPaletteEntry {
  /** JEF palette index (0 = stop placeholder). */
  index: number;
  /** Colour slot (thread index) this entry belongs to; -1 for stop entries. */
  slot: number;
}

/**
 * The JEF colour list (pyembroidery's PATCH block): one entry per colour slot, nearest JEF
 * colour, but a different colour than the previous slot when two different threads would
 * collapse onto the same JEF colour; every STOP adds an entry that alternates 0 (stop) and
 * the previous colour.
 */
export function jefPalette(pattern: FormatPattern, colorMatch: ColorMatch = 'ciede2000'): JefPaletteEntry[] {
  const metric = metricOf(colorMatch);
  const jefColors: (string | null)[] = JEF_THREADS.map((t) => (t ? t.color : null));
  const palette: JefPaletteEntry[] = [];
  let lastIndex = -1;
  let lastKey: string | null = null;
  let toggled = false;
  let slot = 0;
  for (const c of pattern.commands) {
    if (c.cmd === MC.COLOR_CHANGE || slot === 0) {
      const thread: FormatThread = pattern.threads[slot] ?? { color: '#000000' };
      const key = threadKey(thread);
      let index = findNearestIndex(thread.color, jefColors, metric);
      if (index === lastIndex && lastKey !== key) {
        const without = jefColors.slice();
        without[index] = null;
        index = findNearestIndex(thread.color, without, metric);
      }
      palette.push({ index, slot });
      slot++;
      lastIndex = index;
      lastKey = key;
      toggled = false;
    }
    if (c.cmd === MC.STOP) {
      toggled = !toggled;
      palette.push({ index: toggled ? 0 : lastIndex, slot: -1 });
    }
  }
  return palette;
}

/** `YYYYMMDDHHMMSS` in local time (Python `datetime.today().strftime`). */
export function jefDateString(d: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getFullYear(), 4)}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function writeHoopEdgeDistance(w: FormatWriter, x: number, y: number): void {
  if (Math.min(x, y) >= 0) {
    w.int32le(x);
    w.int32le(y);
    w.int32le(x);
    w.int32le(y);
  } else {
    for (let i = 0; i < 4; i++) w.int32le(-1);
  }
}

/** Encodes an already-normalised pattern (pyembroidery JefWriter.write). */
export function writeJefPattern(pattern: FormatPattern, opts: JefWriteOptions = {}): Uint8Array {
  const trims = opts.trims ?? false;
  const trimAt = opts.trimAt ?? 3;
  const date =
    typeof opts.date === 'string'
      ? opts.date
      : jefDateString(opts.date instanceof Date ? opts.date : new Date());
  const { commands } = pattern;
  const palette = jefPalette(pattern, opts.colorMatch);
  const colorCount = palette.length;

  const w = new FormatWriter(256 + colorCount * 8 + commands.length * 4);
  w.int32le(0x74 + colorCount * 8);
  w.int32le(0x14);
  w.ascii(date);
  w.int8(0);
  w.int8(0);
  w.int32le(colorCount);
  let pointCount = 1; // the END command
  for (const c of commands) {
    if (c.cmd === MC.STITCH) pointCount += 1;
    else if (c.cmd === MC.JUMP) pointCount += 2;
    else if (c.cmd === MC.TRIM) {
      if (trims) pointCount += 2 * trimAt;
    } else if (c.cmd === MC.COLOR_CHANGE || c.cmd === MC.STOP) pointCount += 2;
    else if (c.cmd === MC.END) break;
  }
  w.int32le(pointCount);
  const { width, height } = jefDesignSize(pattern);
  w.int32le(jefHoopFor(width, height).code);
  const halfW = pyRound(width / 2);
  const halfH = pyRound(height / 2);
  // Distance from the centre of the hoop.
  w.int32le(halfW);
  w.int32le(halfH);
  w.int32le(halfW);
  w.int32le(halfH);
  writeHoopEdgeDistance(w, 550 - halfW, 550 - halfH); // 110 × 110
  writeHoopEdgeDistance(w, 250 - halfW, 250 - halfH); // 50 × 50
  writeHoopEdgeDistance(w, 700 - halfW, 1000 - halfH); // 140 × 200
  writeHoopEdgeDistance(w, 700 - halfW, 1000 - halfH); // custom hoop
  for (const p of palette) w.int32le(p.index);
  for (let i = 0; i < colorCount; i++) w.int32le(0x0d);

  let xx = 0;
  let yy = 0;
  for (const c of commands) {
    const dx = pyRound(c.x - xx);
    const dy = pyRound(c.y - yy);
    xx += dx;
    yy += dy;
    if (c.cmd === MC.STITCH) {
      w.int8(dx);
      w.int8(-dy);
    } else if (c.cmd === MC.COLOR_CHANGE || c.cmd === MC.STOP) {
      w.bytes([0x80, 0x01]);
      w.int8(dx);
      w.int8(-dy);
    } else if (c.cmd === MC.TRIM) {
      if (trims) for (let i = 0; i < trimAt; i++) w.bytes([0x80, 0x02, 0x00, 0x00]);
    } else if (c.cmd === MC.JUMP) {
      w.bytes([0x80, 0x02]);
      w.int8(dx);
      w.int8(-dy);
    } else if (c.cmd === MC.END) {
      break;
    }
  }
  w.bytes([0x80, 0x10]);
  return w.toUint8Array();
}
