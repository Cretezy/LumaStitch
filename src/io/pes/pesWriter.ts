// SPDX-License-Identifier: GPL-3.0-or-later
// Brother PES writer (v1 and v6, plus the "truncated" debug variants).
// Ported from pyembroidery's PesWriter.py (pyembroidery, MIT License, Copyright (c) 2018 Tatarize).
import type { StitchPlan } from '@/engine/types';
import type { Design } from '@/model/types';
import { ByteWriter, utf8Bytes } from './bytes';
import {
  commandBounds,
  MC,
  normalizeForPes,
  toMachineCommands,
  type MachineCommand,
  type NormalizedPes,
} from './machineCommands';
import { pecLabel, writePec, type PecColorInfo } from './pecEncoder';
import { findNearestIndex, nearestPecIndexBy, type ColorMatch } from './pecPalette';
import { pyInt } from './pymath';

export const PES_VERSION_1_SIGNATURE = '#PES0001';
export const PES_VERSION_6_SIGNATURE = '#PES0060';
const EMB_ONE = 'CEmbOne';
const EMB_SEG = 'CSewSeg';

/** Thread metadata as stored in a PES v6 thread table (pyembroidery EmbThread fields). */
export interface PesThreadInfo {
  /** #rrggbb */
  color: string;
  description?: string;
  catalogNumber?: string;
  brand?: string;
  chart?: string;
}

export interface PesWriteOptions {
  /** PES version. Default 1. */
  version?: 1 | 6;
  /** pyembroidery's "truncated" variant (empty PES body, PEC only). Debug option. */
  truncated?: boolean;
  /**
   * v1 header hoop flag: 0 = 100×100 mm, 1 = 130×180 mm. Default 'auto' picks 0 when the
   * design fits in 100×100 mm, else 1. (pyembroidery always writes 1.)
   */
  hoop?: 'auto' | 0 | 1;
  /**
   * How threads are mapped onto the 64 PEC colours. Default 'ciede2000' (what the export
   * dialog previews via `nearestPecIndex`); 'pyembroidery' reproduces pyembroidery exactly.
   */
  colorMatch?: ColorMatch;
  /** Maps a `Thread.chart` id to human-readable brand / chart names for the v6 thread table. */
  resolveChart?: (chartId: string) => { brand?: string; chart?: string } | undefined;
}

/** A fully normalised pattern ready for the PES encoders. */
export interface PesPattern {
  preserveNeedles?: boolean;
  /** Normalised commands (`normalizeForPes`). */
  commands: MachineCommand[];
  /** One thread per PEC colour slot. */
  threads: PesThreadInfo[];
  /** Design name. Embedded in full in v6 metadata and truncated to 8 chars for the PEC label. */
  name: string;
}

/** Writes a StitchPlan as a PES file. */
export function writePes(
  plan: StitchPlan,
  design: Pick<Design, 'name' | 'threads'> & Partial<Pick<Design, 'shapes'>>,
  opts: PesWriteOptions = {},
): Uint8Array {
  return writePesPattern(buildPesPattern(plan, design, opts), opts);
}

/** StitchPlan → normalised PES pattern (commands + per-colour-slot threads). */
export function buildPesPattern(
  plan: StitchPlan,
  design: Pick<Design, 'name' | 'threads'> & Partial<Pick<Design, 'shapes'>>,
  opts: Pick<PesWriteOptions, 'resolveChart'> = {},
): PesPattern {
  const norm: NormalizedPes = normalizeForPes(toMachineCommands(plan));
  const threads = norm.colorSlots.map((b) => threadInfoForBlock(plan, design, b, opts.resolveChart));
  const preserveNeedles = Object.values(design.shapes ?? {}).some(
    (s) => s.outline?.type === 'manual' && s.outline.params.preserveCommands === true,
  );
  return {
    commands: norm.commands,
    threads,
    name: design.name,
    ...(preserveNeedles ? { preserveNeedles: true } : {}),
  };
}

function threadInfoForBlock(
  plan: StitchPlan,
  design: Pick<Design, 'threads'>,
  blockIndex: number,
  resolveChart: PesWriteOptions['resolveChart'],
): PesThreadInfo {
  const block = blockIndex >= 0 ? plan.colorBlocks[blockIndex] : undefined;
  if (!block) return { color: '#000000' };
  const t = design.threads[block.threadId];
  const info: PesThreadInfo = { color: block.color.toLowerCase() };
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

/** Identity of a thread record (pyembroidery `EmbThread.__eq__` compares all metadata). */
function threadKey(t: PesThreadInfo): string {
  return JSON.stringify([t.description ?? null, t.catalogNumber ?? null, t.brand ?? null, t.chart ?? null]);
}

/** Encodes an already-normalised pattern. */
export function writePesPattern(pattern: PesPattern, opts: PesWriteOptions = {}): Uint8Array {
  const version = opts.version ?? 1;
  const w = new ByteWriter(4096 + pattern.commands.length * 12);
  const ctx: WriteContext = {
    w,
    pattern,
    colorMatch: opts.colorMatch ?? 'ciede2000',
    label: pattern.name || 'Untitled',
  };
  if (opts.truncated) {
    if (version === 1) writeTruncatedVersion1(ctx);
    else writeTruncatedVersion6(ctx);
  } else if (version === 1) {
    writeVersion1(ctx, opts.hoop ?? 'auto');
  } else {
    writeVersion6(ctx);
  }
  return w.toUint8Array();
}

interface WriteContext {
  w: ByteWriter;
  pattern: PesPattern;
  colorMatch: ColorMatch;
  label: string;
}

function pec(ctx: WriteContext): PecColorInfo {
  return writePec(ctx.w, {
    commands: ctx.pattern.commands,
    threads: ctx.pattern.threads.map((t) => ({ color: t.color, key: threadKey(t) })),
    label: ctx.label,
    colorMatch: ctx.colorMatch,
    preserveNeedles: ctx.pattern.preserveNeedles,
  });
}

function writeTruncatedVersion1(ctx: WriteContext): void {
  const { w } = ctx;
  w.utf8(PES_VERSION_1_SIGNATURE);
  w.bytes([0x16, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  pec(ctx);
}

function writeTruncatedVersion6(ctx: WriteContext): void {
  const { w } = ctx;
  w.utf8(PES_VERSION_6_SIGNATURE);
  const placeholder = w.position;
  w.int32le(0);
  writePesHeaderV6(ctx, 0);
  w.fill(0x00, 5);
  w.int16le(0);
  w.int16le(0);
  w.patchInt32le(placeholder, w.position);
  pec(ctx);
  writePesAddendum(w, { colorIndexList: [0xff], rgbList: [] });
  w.int16le(0);
}

interface Extents {
  left: number;
  top: number;
  right: number;
  bottom: number;
  cx: number;
  cy: number;
}

function extentsOf(commands: readonly MachineCommand[]): Extents {
  const b = commandBounds(commands);
  const cx = (b.maxX + b.minX) / 2;
  const cy = (b.maxY + b.minY) / 2;
  return { left: b.minX - cx, top: b.minY - cy, right: b.maxX - cx, bottom: b.maxY - cy, cx, cy };
}

function writeVersion1(ctx: WriteContext, hoop: 'auto' | 0 | 1): void {
  const { w, pattern } = ctx;
  w.utf8(PES_VERSION_1_SIGNATURE);
  const ext = extentsOf(pattern.commands);
  const hoopFlag =
    hoop === 'auto' ? (ext.right - ext.left <= 1000 && ext.bottom - ext.top <= 1000 ? 0 : 1) : hoop;
  const placeholder = w.position;
  w.int32le(0); // placeholder for PEC block offset
  if (pattern.commands.length === 0) {
    writePesHeaderV1(w, hoopFlag, 0);
    w.int16le(0x0000);
    w.int16le(0x0000);
  } else {
    writePesHeaderV1(w, hoopFlag, 1);
    w.int16le(0xffff);
    w.int16le(0x0000);
    const chartColors = (color: string) => nearestPecIndexBy(color, ctx.colorMatch);
    writePesBlocks(w, pattern, chartColors, ext);
  }
  w.patchInt32le(placeholder, w.position);
  pec(ctx);
}

function writeVersion6(ctx: WriteContext): void {
  const { w, pattern } = ctx;
  w.utf8(PES_VERSION_6_SIGNATURE);
  const ext = extentsOf(pattern.commands);
  const placeholder = w.position;
  w.int32le(0);
  if (pattern.commands.length === 0) {
    writePesHeaderV6(ctx, 0);
    w.int16le(0x0000);
    w.int16le(0x0000);
  } else {
    writePesHeaderV6(ctx, 1);
    w.int16le(0xffff);
    w.int16le(0x0000);
    // v6 uses the pattern's own thread list as the chart: nearest = last thread with the same RGB.
    const threadColors = pattern.threads.map((t) => t.color);
    const log = writePesBlocks(w, pattern, (c) => findNearestIndex(c, threadColors, 'redmean'), ext);
    // In version 6 there is some node, tree, order thing.
    w.int32le(0);
    w.int32le(0);
    for (let i = 0; i < log.length; i++) {
      w.int32le(i);
      w.int32le(0);
    }
  }
  w.patchInt32le(placeholder, w.position);
  const colorInfo = pec(ctx);
  writePesAddendum(w, colorInfo);
  w.int16le(0x0000); // found in version 6, not 5/4
}

function writePesHeaderV1(w: ByteWriter, hoopFlag: number, distinctBlockObjects: number): void {
  w.int16le(0x01); // scale to fit
  w.int16le(hoopFlag); // 0 = 100x100, 1 = 130x180 hoop
  w.int16le(distinctBlockObjects);
}

function writePesHeaderV6(ctx: WriteContext, distinctBlockObjects: number): void {
  const { w, pattern } = ctx;
  w.int16le(0x01); // 0 = 100x100, 130x180 hoop
  w.utf8('02'); // 2-digit ascii number
  writePesString8(w, pattern.name || undefined); // name
  writePesString8(w, undefined); // category
  writePesString8(w, undefined); // author
  writePesString8(w, undefined); // keywords
  writePesString8(w, undefined); // comments
  w.int16le(0); // OptimizeHoopChange = False
  w.int16le(0); // Design Page Is Custom = False
  w.int16le(0x64); // Hoop Width
  w.int16le(0x64); // Hoop Height
  w.int16le(0); // Use Existing Design Area = False
  w.int16le(0xc8); // designWidth
  w.int16le(0xc8); // designHeight
  w.int16le(0x64); // designPageSectionWidth
  w.int16le(0x64); // designPageSectionHeight
  w.int16le(0x64); // p6 # 100
  w.int16le(0x07); // designPageBackgroundColor
  w.int16le(0x13); // designPageForegroundColor
  w.int16le(0x01); // ShowGrid
  w.int16le(0x01); // WithAxes
  w.int16le(0x00); // SnapToGrid
  w.int16le(100); // GridInterval
  w.int16le(0x01); // p9 curves?
  w.int16le(0x00); // OptimizeEntryExitPoints
  w.int8(0); // fromImageStringLength
  w.float32le(1);
  w.float32le(0);
  w.float32le(0);
  w.float32le(1);
  w.float32le(0);
  w.float32le(0);
  w.int16le(0); // numberOfProgrammableFillPatterns
  w.int16le(0); // numberOfMotifPatterns
  w.int16le(0); // featherPatternCount
  w.int16le(pattern.threads.length); // numberOfColors
  for (const t of pattern.threads) writePesThread(w, t);
  w.int16le(distinctBlockObjects);
}

function writePesAddendum(w: ByteWriter, info: PecColorInfo): void {
  const count = info.colorIndexList.length;
  w.bytes(info.colorIndexList);
  w.fill(0x20, 128 - count);
  for (let i = 0; i < info.rgbList.length; i++) w.fill(0x00, 0x90);
  for (const rgb of info.rgbList) w.int24le(rgb);
}

/**
 * pyembroidery `write_pes_string_8`. Deviation: the length byte is the UTF-8 *byte* length
 * (pyembroidery writes the character count, which breaks non-ASCII strings) and strings are
 * cut at 255 bytes on a character boundary. Identical for ASCII.
 */
function writePesString8(w: ByteWriter, s: string | undefined): void {
  if (s === undefined) {
    w.int8(0);
    return;
  }
  let bytes = utf8Bytes(s);
  if (bytes.length > 255) {
    let cut = 255;
    while (cut > 0 && (bytes[cut] & 0xc0) === 0x80) cut--;
    bytes = bytes.slice(0, cut);
  }
  w.int8(bytes.length);
  w.bytes(bytes);
}

function writePesString16(w: ByteWriter, s: string): void {
  w.int16le(s.length);
  w.utf8(s);
}

function writePesThread(w: ByteWriter, t: PesThreadInfo): void {
  const rgb = parseInt(t.color.replace('#', '').slice(0, 6), 16) & 0xffffff;
  writePesString8(w, t.catalogNumber);
  w.int8((rgb >> 16) & 0xff);
  w.int8((rgb >> 8) & 0xff);
  w.int8(rgb & 0xff);
  w.int8(0); // unknown
  w.int32le(0xa); // A is custom color
  writePesString8(w, t.description);
  writePesString8(w, t.brand);
  writePesString8(w, t.chart);
}

/** Returns the colour log ([section, colorCode] per colour transition). */
function writePesBlocks(
  w: ByteWriter,
  pattern: PesPattern,
  colorCodeOf: (color: string) => number,
  ext: Extents,
): [number, number][] {
  writePesString16(w, EMB_ONE);
  const placeholder = writePesSewSegHeader(w, ext);
  w.int16le(0xffff);
  w.int16le(0x0000); // FFFF0000 means more blocks exist
  writePesString16(w, EMB_SEG);
  const [sections, colorlog] = writePesEmbSewSegSegments(w, pattern, colorCodeOf, ext);
  w.patchInt16le(placeholder, sections);
  w.int16le(0x0000);
  w.int16le(0x0000); // 00000000 means no more blocks
  return colorlog;
}

function writePesSewSegHeader(w: ByteWriter, ext: Extents): number {
  const width = ext.right - ext.left;
  const height = ext.bottom - ext.top;
  const hoopHeight = 1800;
  const hoopWidth = 1300;
  for (let i = 0; i < 8; i++) w.int16le(0); // left, top, right, bottom ×2
  let transX = 0;
  let transY = 0;
  transX += 350;
  transY += 100 + height;
  transX += hoopWidth / 2;
  transY += hoopHeight / 2;
  transX += -width / 2;
  transY += -height / 2;
  w.float32le(1);
  w.float32le(0);
  w.float32le(0);
  w.float32le(1);
  w.float32le(transX);
  w.float32le(transY);
  w.int16le(1);
  w.int16le(0);
  w.int16le(0);
  w.int16le(pyInt(width));
  w.int16le(pyInt(height));
  w.fill(0x00, 8);
  const placeholder = w.position;
  w.int16le(0); // sections
  return placeholder;
}

/** pyembroidery `get_as_command_blocks`: runs of identical commands. */
function* commandBlocks(commands: readonly MachineCommand[]): Generator<readonly MachineCommand[]> {
  let lastPos = 0;
  let lastCommand = -1;
  for (let pos = 0; pos < commands.length; pos++) {
    const command = commands[pos].cmd;
    if (command === lastCommand || lastCommand === -1) {
      lastCommand = command;
      continue;
    }
    lastCommand = command;
    yield commands.slice(lastPos, pos);
    lastPos = pos;
  }
  yield commands.slice(lastPos);
}

/** pyembroidery `get_as_segments_blocks`. */
function* segmentBlocks(
  pattern: PesPattern,
  colorCodeOf: (color: string) => number,
  adjustX: number,
  adjustY: number,
): Generator<{ block: [number, number][]; colorCode: number; flag: number }> {
  const threadAt = (i: number) => pattern.threads[i]?.color ?? '#000000';
  let colorIndex = 0;
  let colorCode = colorCodeOf(threadAt(colorIndex));
  colorIndex++;
  let stitchedX = 0;
  let stitchedY = 0;
  for (const cb of commandBlocks(pattern.commands)) {
    if (cb.length === 0) continue;
    const command = cb[0].cmd;
    const block: [number, number][] = [];
    let flag: number;
    if (command === MC.JUMP) {
      block.push([stitchedX - adjustX, stitchedY - adjustY]);
      const last = cb[cb.length - 1];
      block.push([last.x - adjustX, last.y - adjustY]);
      flag = 1;
    } else if (command === MC.COLOR_CHANGE) {
      colorCode = colorCodeOf(threadAt(colorIndex));
      colorIndex++;
      continue;
    } else if (command === MC.STITCH) {
      for (const s of cb) {
        stitchedX = s.x;
        stitchedY = s.y;
        block.push([stitchedX - adjustX, stitchedY - adjustY]);
      }
      flag = 0;
    } else {
      continue;
    }
    yield { block, colorCode, flag };
  }
}

function writePesEmbSewSegSegments(
  w: ByteWriter,
  pattern: PesPattern,
  colorCodeOf: (color: string) => number,
  ext: Extents,
): [number, [number, number][]] {
  let section = 0;
  const colorlog: [number, number][] = [];
  let previousColorCode = -1;
  let flag = -1;
  const adjustX = ext.left + ext.cx;
  const adjustY = ext.bottom + ext.cy;
  for (const segs of segmentBlocks(pattern, colorCodeOf, adjustX, adjustY)) {
    if (flag !== -1) w.int16le(0x8003); // section end
    flag = segs.flag;
    if (previousColorCode !== segs.colorCode) {
      colorlog.push([section, segs.colorCode]);
      previousColorCode = segs.colorCode;
    }
    w.int16le(flag);
    w.int16le(segs.colorCode);
    w.int16le(segs.block.length);
    for (const [x, y] of segs.block) {
      w.int16le(pyInt(x));
      w.int16le(pyInt(y));
    }
    section++;
  }
  w.int16le(colorlog.length);
  for (const [s, c] of colorlog) {
    w.int16le(s);
    w.int16le(c);
  }
  return [section, colorlog];
}

/** The PEC label that will be embedded for a design name (≤ 8 printable ASCII chars). */
export function pesLabelFor(name: string): string {
  return pecLabel(name || 'Untitled');
}
