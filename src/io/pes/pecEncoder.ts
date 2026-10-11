// SPDX-License-Identifier: GPL-3.0-or-later
// PEC section writer: label header, colour list, stitch block and thumbnails.
// Ported from pyembroidery's PecWriter.py (pyembroidery, MIT License, Copyright (c) 2018 Tatarize).
import { ByteWriter } from './bytes';
import { commandBounds, MC, type Bounds, type MachineCommand } from './machineCommands';
import { buildUniquePalette, type ColorMatch, type PaletteThread } from './pecPalette';
import { drawScaled, getBlank, PEC_ICON_HEIGHT, PEC_ICON_STRIDE } from './pecGraphics';
import { pyRound } from './pymath';

const MASK_07_BIT = 0b01111111;
export const PEC_JUMP_CODE = 0b00010000;
export const PEC_TRIM_CODE = 0b00100000;
export const PEC_FLAG_LONG = 0b10000000;

/** Result of writing the PEC header; PES v6 repeats it in its addendum. */
export interface PecColorInfo {
  /** [numColours − 1, idx0, idx1, …] or [] when there are no colours. */
  colorIndexList: number[];
  /** 0xRRGGBB per colour slot. */
  rgbList: number[];
}

export interface PecInput {
  /** Normalised commands (see `normalizeForPes`). */
  commands: readonly MachineCommand[];
  /** Thread per colour slot (pyembroidery `pattern.threadlist`): colour + identity key. */
  threads: readonly PaletteThread[];
  /** Label as given; truncated to 8 characters like pyembroidery. */
  label: string;
  colorMatch: ColorMatch;
  /** Imported needle programs must not acquire the legacy jump-ending needle. */
  preserveNeedles?: boolean;
}

/**
 * Makes a label safe for the fixed-width ASCII PEC header. pyembroidery writes the name
 * as UTF-8 after padding by *characters*, which corrupts the layout for non-ASCII names;
 * we transliterate (strip diacritics) and replace anything else outside printable ASCII
 * with '_'. Identical to pyembroidery for printable-ASCII names.
 */
export function pecLabel(name: string): string {
  const ascii = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7e]/g, '_');
  return ascii.slice(0, 8);
}

/** pyembroidery `write_pec`: header, stitch block, graphics. Returns the colour info. */
export function writePec(w: ByteWriter, input: PecInput): PecColorInfo {
  const extents = commandBounds(input.commands);
  const info = writePecHeader(w, input);
  writePecBlock(w, input.commands, extents, input.preserveNeedles);
  writePecGraphics(w, input.commands, extents);
  return info;
}

function writePecHeader(w: ByteWriter, input: PecInput): PecColorInfo {
  const label = pecLabel(input.label);
  w.utf8('LA:' + label.padEnd(16, ' ') + '\r');
  w.bytes([0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0xff, 0x00]);
  w.int8(PEC_ICON_STRIDE); // PEC byte stride
  w.int8(PEC_ICON_HEIGHT); // PEC icon height

  const colorIndexList = buildUniquePalette(input.threads, input.colorMatch);
  const rgbList = input.threads.map((t) => parseInt(t.color.replace('#', '').slice(0, 6), 16) & 0xffffff);

  const count = colorIndexList.length;
  if (count !== 0) {
    w.fill(0x20, 12);
    colorIndexList.unshift(count - 1);
    if (colorIndexList[0] >= 255) {
      throw new RangeError(`too many color changes, (${colorIndexList.length}) out of bounds (0, 255)`);
    }
    w.bytes(colorIndexList);
  } else {
    w.bytes([0x20, 0x20, 0x20, 0x20, 0x64, 0x20, 0x00, 0x20, 0x00, 0x20, 0x20, 0x20, 0xff]);
  }
  w.fill(0x20, 463 - count);
  return { colorIndexList, rgbList };
}

function writePecBlock(
  w: ByteWriter,
  commands: readonly MachineCommand[],
  extents: Bounds,
  preserveNeedles = false,
): void {
  const width = extents.maxX - extents.minX;
  const height = extents.maxY - extents.minY;
  const start = w.position;
  w.bytes([0x00, 0x00]);
  w.int24le(0); // placeholder: stitch block length
  w.bytes([0x31, 0xff, 0xf0]);
  w.int16le(pyRound(width));
  w.int16le(pyRound(height));
  w.int16le(0x1e0);
  w.int16le(0x1b0);
  pecEncode(w, commands, preserveNeedles);
  w.patchInt24le(start + 2, w.position - start);
}

function writePecGraphics(w: ByteWriter, commands: readonly MachineCommand[], extents: Bounds): void {
  // Overall icon: every STITCH (pyembroidery draws per stitch block onto one icon, buffer 4).
  const overall = getBlank();
  drawScaled(
    extents,
    commands.filter((c) => c.cmd === MC.STITCH),
    overall,
    PEC_ICON_STRIDE,
    4,
  );
  w.bytes(overall);
  // One icon per colour block (pyembroidery `get_as_colorblocks`: COLOR_CHANGE closes a block).
  let block: MachineCommand[] = [];
  let blockStart = 0;
  const flush = () => {
    const icon = getBlank();
    drawScaled(
      extents,
      block.filter((c) => c.cmd === MC.STITCH),
      icon,
      PEC_ICON_STRIDE,
    );
    w.bytes(icon);
  };
  for (let i = 0; i < commands.length; i++) {
    block.push(commands[i]);
    if (commands[i].cmd === MC.COLOR_CHANGE) {
      flush();
      block = [];
      blockStart = i + 1;
    }
  }
  if (blockStart !== commands.length) flush();
}

function writeValue(w: ByteWriter, value: number, long = false, flag = 0): void {
  if (!long && -64 < value && value < 63) {
    w.int8(value & MASK_07_BIT);
  } else {
    let v = value & 0b0000111111111111;
    v |= 0b1000000000000000;
    v |= flag << 8;
    w.int8((v >> 8) & 0xff);
    w.int8(v & 0xff);
  }
}

function writeStitch(w: ByteWriter, dx: number, dy: number): void {
  writeValue(w, dx);
  writeValue(w, dy);
}

/** pyembroidery `pec_encode`. */
export function pecEncode(w: ByteWriter, commands: readonly MachineCommand[], preserveNeedles = false): void {
  let colorTwo = true;
  let jumping = true;
  let init = true;
  let xx = 0;
  let yy = 0;
  for (const c of commands) {
    const dx = pyRound(c.x - xx);
    const dy = pyRound(c.y - yy);
    xx += dx;
    yy += dy;
    switch (c.cmd) {
      case MC.STITCH:
        if (jumping) {
          if (!preserveNeedles && dx !== 0 && dy !== 0) writeStitch(w, 0, 0);
          jumping = false;
        }
        writeStitch(w, dx, dy);
        break;
      case MC.JUMP:
        jumping = true;
        writeValue(w, dx, true, init ? PEC_JUMP_CODE : PEC_TRIM_CODE);
        writeValue(w, dy, true, init ? PEC_JUMP_CODE : PEC_TRIM_CODE);
        break;
      case MC.COLOR_CHANGE:
        if (jumping) {
          if (!preserveNeedles) writeStitch(w, 0, 0);
          jumping = false;
        }
        w.bytes([0xfe, 0xb0, colorTwo ? 0x02 : 0x01]);
        colorTwo = !colorTwo;
        break;
      case MC.STOP: // already converted into duplicate colours
      case MC.TRIM: // PEC has no standalone trim; jumps carry it
        break;
      case MC.END:
        w.int8(0xff);
        return;
    }
    init = false;
  }
}
