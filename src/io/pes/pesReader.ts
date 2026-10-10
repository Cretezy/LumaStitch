// SPDX-License-Identifier: GPL-3.0-or-later
// Brother PES / PEC reader. Parses the PEC stitch block (plus the PES v5+ thread table)
// back into absolute machine commands. Used for "Open .pes" and to verify our exports.
// Ported from pyembroidery's PesReader.py and PecReader.py, including
// EmbPattern.interpolate_duplicate_color_as_stop
// (pyembroidery, MIT License, Copyright (c) 2018 Tatarize).
import { ByteReader } from './bytes';
import { MC, type Bounds, type MachineCommand } from './machineCommands';
import { PEC_FLAG_LONG, PEC_JUMP_CODE, PEC_TRIM_CODE } from './pecEncoder';
import { PEC_PALETTE, PEC_PALETTE_SIZE } from './pecPalette';

export interface PesColor {
  /** PEC palette byte for this colour slot (index into PEC_PALETTE, modulo 65). */
  pecIndex: number;
  /** #rrggbb: from the PES thread table when present, else from the PEC palette. */
  color: string;
  /** Thread description (PES table) or PEC colour name. */
  name?: string;
  /** Catalogue code (PES table) or PEC palette number. */
  code?: string;
  brand?: string;
  chart?: string;
}

export interface PesMetadata {
  name?: string;
  category?: string;
  author?: string;
  keywords?: string;
  comments?: string;
}

export interface PesReadResult {
  /** PES version (1, 6, …; 0 for unrecognised PES headers, and for bare #PEC0001 files). */
  version: number;
  signature: string;
  /** PEC label (trimmed). */
  label: string;
  metadata: PesMetadata;
  /** Absolute positions in 0.1 mm, starting from (0, 0). Ends with END. */
  commands: MachineCommand[];
  /**
   * One entry per colour after duplicate colours were turned back into STOPs
   * (pyembroidery semantics): `colors.length === colorChangeCount + 1` when anything is sewn.
   */
  colors: PesColor[];
  /** Raw PEC colour bytes, one per colour slot (including STOP duplicates). */
  pecColorIndexes: number[];
  /** PES thread table (v5+), as stored. */
  threadTable: PesColor[];
  stitchCount: number;
  jumpCount: number;
  trimCount: number;
  colorChangeCount: number;
  stopCount: number;
  /** Bounds over every command position (pyembroidery `bounds()`), 0.1 mm. */
  bounds: Bounds;
  /** PEC thumbnails: overall + one per colour slot, 228 bytes each (48×38, 1 bpp). */
  thumbnails: Uint8Array[];
  pecOffset: number;
}

export class PesReadError extends Error {}

interface ThreadEntry {
  color: number; // 0xRRGGBB
  description?: string;
  catalogNumber?: string;
  brand?: string;
  chart?: string;
  pecIndex: number;
}

class Pattern {
  commands: MachineCommand[] = [];
  threads: ThreadEntry[] = [];
  x = 0;
  y = 0;
  add(cmd: MachineCommand['cmd'], dx = 0, dy = 0): void {
    this.x += dx;
    this.y += dy;
    this.commands.push({ x: this.x, y: this.y, cmd });
  }
}

export function readPes(bytes: Uint8Array): PesReadResult {
  const f = new ByteReader(bytes);
  const out = new Pattern();
  const metadata: PesMetadata = {};
  const tableThreads: ThreadEntry[] = [];
  const signature = f.string(8) ?? '';
  let version = 0;
  let pecOffset: number;

  if (signature === '#PEC0001') {
    pecOffset = 8;
  } else if (signature.startsWith('#PES')) {
    const off = f.int32le();
    if (off === null) throw new PesReadError('Truncated PES header');
    pecOffset = off;
    switch (signature) {
      case '#PES0100':
        version = 10;
        readPesHeaderV9V10(f, metadata, tableThreads, 38);
        break;
      case '#PES0090':
        version = 9;
        readPesHeaderV9V10(f, metadata, tableThreads, 30);
        break;
      case '#PES0080':
        version = 8;
        readPesHeaderTable(f, metadata, tableThreads, 38, 26);
        break;
      case '#PES0070':
        version = 7;
        readPesHeaderTable(f, metadata, tableThreads, 36, 24);
        break;
      case '#PES0060':
        version = 6;
        readPesHeaderTable(f, metadata, tableThreads, 36, 24);
        break;
      case '#PES0050':
        version = 5;
        readPesHeaderTable(f, metadata, tableThreads, 24, 24);
        break;
      case '#PES0055':
        version = 5.5;
        readPesHeaderTable(f, metadata, tableThreads, 24, 24);
        break;
      case '#PES0056':
        version = 5.6;
        readPesHeaderTable(f, metadata, tableThreads, 24, 24);
        break;
      case '#PES0040':
        version = 4;
        f.skip(4);
        readPesMetadata(f, metadata);
        break;
      case '#PES0030':
        version = 3;
        break;
      case '#PES0022':
        version = 2.2;
        break;
      case '#PES0020':
        version = 2;
        break;
      case '#PES0001':
        version = 1;
        break;
      default:
        break; // unrecognised header: just read the PEC block
    }
  } else {
    throw new PesReadError('Not a PES/PEC file');
  }

  if (pecOffset < 0 || pecOffset + 512 > bytes.length) throw new PesReadError('PEC offset out of range');
  f.seek(pecOffset);
  const pec = readPec(f, out, tableThreads);
  interpolateDuplicateColorAsStop(out);

  const colors = out.threads.map(toPesColor);
  const counts = { stitch: 0, jump: 0, trim: 0, cc: 0, stop: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of out.commands) {
    if (c.cmd === MC.STITCH) counts.stitch++;
    else if (c.cmd === MC.JUMP) counts.jump++;
    else if (c.cmd === MC.TRIM) counts.trim++;
    else if (c.cmd === MC.COLOR_CHANGE) counts.cc++;
    else if (c.cmd === MC.STOP) counts.stop++;
    if (c.x > maxX) maxX = c.x;
    if (c.x < minX) minX = c.x;
    if (c.y > maxY) maxY = c.y;
    if (c.y < minY) minY = c.y;
  }

  return {
    version,
    signature,
    label: pec.label,
    metadata,
    commands: out.commands,
    colors,
    pecColorIndexes: pec.colorBytes,
    threadTable: tableThreads.map(toPesColor),
    stitchCount: counts.stitch,
    jumpCount: counts.jump,
    trimCount: counts.trim,
    colorChangeCount: counts.cc,
    stopCount: counts.stop,
    bounds: { minX, minY, maxX, maxY },
    thumbnails: pec.graphics,
    pecOffset,
  };
}

function toPesColor(t: ThreadEntry): PesColor {
  const c: PesColor = { pecIndex: t.pecIndex, color: '#' + t.color.toString(16).padStart(6, '0') };
  if (t.description !== undefined) c.name = t.description;
  if (t.catalogNumber !== undefined) c.code = t.catalogNumber;
  if (t.brand !== undefined) c.brand = t.brand;
  if (t.chart !== undefined) c.chart = t.chart;
  return c;
}

function readPesString(f: ByteReader): string | undefined {
  const length = f.int8();
  if (!length) return undefined;
  return f.string(length) ?? undefined;
}

function readPesMetadata(f: ByteReader, md: PesMetadata): void {
  const keys: (keyof PesMetadata)[] = ['name', 'category', 'author', 'keywords', 'comments'];
  for (const k of keys) {
    const v = readPesString(f);
    if (v) md[k] = v;
  }
}

function readPesThread(f: ByteReader, threads: ThreadEntry[]): void {
  const catalogNumber = readPesString(f);
  const color = f.int24be() ?? 0;
  f.skip(5);
  const description = readPesString(f);
  const brand = readPesString(f);
  const chart = readPesString(f);
  threads.push({ color, catalogNumber, description, brand, chart, pecIndex: -1 });
}

function readThreadTable(f: ByteReader, threads: ThreadEntry[]): void {
  if (f.int16le() !== 0) return; // programmable fills
  if (f.int16le() !== 0) return; // motifs
  if (f.int16le() !== 0) return; // feather patterns
  const count = f.int16le() ?? 0;
  for (let i = 0; i < count; i++) readPesThread(f, threads);
}

/** Versions 5–8: metadata, `skipA` bytes, image file string, `skipB` bytes, thread table. */
function readPesHeaderTable(
  f: ByteReader,
  md: PesMetadata,
  threads: ThreadEntry[],
  skipA: number,
  skipB: number,
): void {
  f.skip(4);
  readPesMetadata(f, md);
  f.skip(skipA);
  readPesString(f); // image file
  f.skip(skipB);
  readThreadTable(f, threads);
}

/** Versions 9 and 10: metadata, hoop name, image file, thread table. */
function readPesHeaderV9V10(f: ByteReader, md: PesMetadata, threads: ThreadEntry[], skipA: number): void {
  f.skip(4);
  readPesMetadata(f, md);
  f.skip(14);
  readPesString(f); // hoop name
  f.skip(skipA);
  readPesString(f); // image file
  f.skip(34);
  readThreadTable(f, threads);
}

function pecThreadEntry(index: number): ThreadEntry {
  const p = PEC_PALETTE[index % PEC_PALETTE_SIZE];
  if (!p) return { color: 0, pecIndex: index };
  return {
    color: (p.rgb[0] << 16) | (p.rgb[1] << 8) | p.rgb[2],
    description: p.name,
    catalogNumber: p.code,
    brand: 'Brother',
    chart: 'Brother',
    pecIndex: index,
  };
}

/** pyembroidery `map_pec_colors`. */
function mapPecColors(colorBytes: number[], chart: ThreadEntry[], out: Pattern): void {
  if (chart.length === 0) {
    for (const b of colorBytes) out.threads.push(pecThreadEntry(b));
  } else if (chart.length >= colorBytes.length) {
    // 1:1 mode
    chart.forEach((t, i) => out.threads.push({ ...t, pecIndex: colorBytes[i] ?? -1 }));
  } else {
    // Tabled mode: how PEC allocates pre-defined threads to blocks.
    const queue = chart.slice();
    const map = new Map<number, ThreadEntry>();
    for (const b of colorBytes) {
      const idx = b % PEC_PALETTE_SIZE;
      let t = map.get(idx);
      if (!t) {
        const next = queue.shift();
        t = next ? { ...next, pecIndex: b } : pecThreadEntry(idx);
        map.set(idx, t);
      }
      out.threads.push(t);
    }
  }
}

function readPec(
  f: ByteReader,
  out: Pattern,
  chart: ThreadEntry[],
): { label: string; colorBytes: number[]; graphics: Uint8Array[] } {
  f.skip(3); // LA:
  const label = (f.string(16) ?? '').trim();
  f.skip(0xf); // \r, spaces, 0xFF 0x00
  const stride = f.int8() ?? 6;
  const iconHeight = f.int8() ?? 38;
  f.skip(0xc);
  const colorChanges = f.int8() ?? 0;
  // Deviation: 0xFF marks "no colours" (pyembroidery would read 256 colour bytes).
  const countColors = colorChanges === 0xff ? 0 : colorChanges + 1;
  const colorBytes = Array.from(f.bytes(colorChanges === 0xff ? 256 : countColors)).slice(0, countColors);
  mapPecColors(colorBytes, chart, out);
  f.skip(0x1d0 - colorChanges);
  const blockLen = f.int24le();
  if (blockLen === null) throw new PesReadError('Truncated PEC stitch block');
  const stitchBlockEnd = blockLen - 5 + f.pos;
  f.skip(0x0b);
  readPecStitches(f, out);
  f.seek(stitchBlockEnd);
  const size = stride * iconHeight;
  const graphics: Uint8Array[] = [];
  for (let i = 0; i < countColors + 1; i++) {
    if (f.pos + size > f.length) break;
    graphics.push(f.bytes(size));
  }
  return { label, colorBytes, graphics };
}

function signed12(b: number): number {
  b &= 0xfff;
  return b > 0x7ff ? -0x1000 + b : b;
}

function signed7(b: number): number {
  return b > 63 ? -128 + b : b;
}

/** pyembroidery `read_pec_stitches`. */
function readPecStitches(f: ByteReader, out: Pattern): void {
  while (true) {
    const val1 = f.int8();
    let val2 = f.int8();
    if (val1 === null || val2 === null || (val1 === 0xff && val2 === 0x00)) break;
    if (val1 === 0xfe && val2 === 0xb0) {
      f.skip(1);
      out.add(MC.COLOR_CHANGE);
      continue;
    }
    let jump = false;
    let trim = false;
    let x: number;
    let y: number;
    if ((val1 & PEC_FLAG_LONG) !== 0) {
      if ((val1 & PEC_TRIM_CODE) !== 0) trim = true;
      if ((val1 & PEC_JUMP_CODE) !== 0) jump = true;
      x = signed12((val1 << 8) | val2);
      val2 = f.int8();
      if (val2 === null) break;
    } else {
      x = signed7(val1);
    }
    if ((val2 & PEC_FLAG_LONG) !== 0) {
      if ((val2 & PEC_TRIM_CODE) !== 0) trim = true;
      if ((val2 & PEC_JUMP_CODE) !== 0) jump = true;
      const val3 = f.int8();
      if (val3 === null) break;
      y = signed12((val2 << 8) | val3);
    } else {
      y = signed7(val2);
    }
    if (jump) {
      out.add(MC.JUMP, x, y);
    } else if (trim) {
      out.add(MC.TRIM);
      out.add(MC.JUMP, x, y);
    } else {
      out.add(MC.STITCH, x, y);
    }
  }
  out.add(MC.END);
}

function sameThread(a: ThreadEntry, b: ThreadEntry): boolean {
  return (
    a.color === b.color &&
    a.description === b.description &&
    a.catalogNumber === b.catalogNumber &&
    a.brand === b.brand &&
    a.chart === b.chart
  );
}

/** pyembroidery `interpolate_duplicate_color_as_stop`. */
function interpolateDuplicateColorAsStop(p: Pattern): void {
  let threadIndex = 0;
  let initColor = true;
  let lastChange = -1;
  for (let pos = 0; pos < p.commands.length; pos++) {
    const cmd = p.commands[pos].cmd;
    if (cmd === MC.STITCH) {
      if (initColor) {
        if (lastChange >= 0 && threadIndex !== 0) {
          if (threadIndex >= p.threads.length) return; // non-existent threads cannot double
          if (sameThread(p.threads[threadIndex - 1], p.threads[threadIndex])) {
            p.threads.splice(threadIndex, 1);
            p.commands[lastChange] = { ...p.commands[lastChange], cmd: MC.STOP };
          } else {
            threadIndex++;
          }
        } else {
          threadIndex++;
        }
        initColor = false;
      }
    } else if (cmd === MC.COLOR_CHANGE) {
      initColor = true;
      lastChange = pos;
    }
  }
}
