// SPDX-License-Identifier: GPL-3.0-or-later
// Codec layouts ported from pyembroidery DstReader/JefReader/ExpReader/Vp3Reader (MIT,
// Copyright (c) 2018 Tatarize). Strict bounds checks and explicit unsupported-command errors added.
import { readPes, type PesColor } from '@/io/pes/pesReader';
import { MC, type MachineCommand, type MachineCmd } from '@/io/pes/machineCommands';
import { JEF_THREADS } from '@/io/formats/jefThreads';

export interface MachineReadResult {
  commands: MachineCommand[];
  colors: Pick<PesColor, 'color' | 'name' | 'code'>[];
  name: string;
  notes: string[];
}
class Reader {
  pos = 0;
  constructor(readonly data: Uint8Array) {}
  take(n: number) {
    if (!Number.isSafeInteger(n) || n < 0 || this.pos + n > this.data.length)
      throw new Error('Truncated or invalid machine file.');
    const b = this.data.subarray(this.pos, this.pos + n);
    this.pos += n;
    return b;
  }
  u8() {
    return this.take(1)[0];
  }
  i8() {
    const v = this.u8();
    return v < 128 ? v : v - 256;
  }
  u16() {
    const b = this.take(2);
    return b[0] * 256 + b[1];
  }
  i16() {
    const n = this.u16();
    return n < 32768 ? n : n - 65536;
  }
  u32(little = false) {
    const b = this.take(4);
    return new DataView(b.buffer, b.byteOffset, 4).getUint32(0, little);
  }
  i32() {
    return this.u32() | 0;
  }
  str() {
    return new TextDecoder().decode(this.take(this.u16()));
  }
  seek(pos: number) {
    if (!Number.isSafeInteger(pos) || pos < 0 || pos > this.data.length)
      throw new Error('Invalid machine-file offset.');
    this.pos = pos;
  }
}
const fallback = (i: number) => ({
  color: ['#234a73', '#a43d36', '#41825c', '#b68729', '#764f91'][i % 5],
  name: `Color ${i + 1} (assign thread)`,
});

export function readMachine(data: Uint8Array, extension: string): MachineReadResult {
  if (data.length > 50_000_000) throw new Error('Machine files are limited to 50 MB.');
  const ext = extension.toLowerCase().replace(/^\./, '');
  if (ext === 'pes') {
    const p = readPes(data);
    if (p.commands.length > 1_000_000) throw new Error('Machine files are limited to one million commands.');
    if (!p.commands.some((c) => c.cmd === MC.STITCH))
      throw new Error('This machine file has no needle stitches.');
    return { commands: p.commands, colors: p.colors, name: p.metadata.name ?? p.label, notes: [] };
  }
  const r = new Reader(data);
  const result: MachineReadResult = { commands: [], colors: [], name: '', notes: [] };
  let x = 0,
    y = 0;
  const emit = (cmd: MachineCmd, dx = 0, dy = 0) => {
    x += dx;
    y += dy;
    result.commands.push({ x, y, cmd });
    if (result.commands.length > 1_000_000)
      throw new Error('Machine files are limited to one million commands.');
  };
  if (ext === 'dst') {
    const header = new TextDecoder().decode(r.take(512));
    if (!header.startsWith('LA:')) throw new Error('Not a DST file (missing LA header).');
    result.name = header.match(/LA:([^\r\n]*)/)?.[1].trim() ?? '';
    for (const match of header.matchAll(/TC:([0-9a-fA-F]{6}),([^,\r\n]*),([^\r\n]*)/g))
      result.colors.push({ color: `#${match[1]}`, name: match[2], code: match[3] });
    let ended = false;
    while (r.pos < data.length) {
      const [a, b, c] = r.take(3),
        bit = (v: number, p: number) => (v >> p) & 1;
      const dx =
        (bit(c, 2) - bit(c, 3)) * 81 +
        (bit(b, 2) - bit(b, 3)) * 27 +
        (bit(a, 2) - bit(a, 3)) * 9 +
        (bit(b, 0) - bit(b, 1)) * 3 +
        bit(a, 0) -
        bit(a, 1);
      const dy = -(
        (bit(c, 5) - bit(c, 4)) * 81 +
        (bit(b, 5) - bit(b, 4)) * 27 +
        (bit(a, 5) - bit(a, 4)) * 9 +
        (bit(b, 7) - bit(b, 6)) * 3 +
        bit(a, 7) -
        bit(a, 6)
      );
      if ((c & 0xf3) === 0xf3) {
        ended = true;
        break;
      }
      if ((c & 0xc3) === 0xc3) emit(MC.COLOR_CHANGE, dx, dy);
      else if ((c & 0x43) === 0x43)
        throw new Error('DST sequin commands require a supported sequin workflow.');
      else emit((c & 0x83) === 0x83 ? MC.JUMP : MC.STITCH, dx, dy);
    }
    if (!ended) throw new Error('DST end record is missing.');
    result.notes.push(
      'DST has no standard thread colors or distinct stop command. Color changes need thread assignment. Jump sequences are preserved; ambiguous trim sequences are not guessed.',
    );
  } else if (ext === 'exp' || ext === 'jef') {
    const slots: ((typeof result.colors)[number] | null)[] = [];
    let slot = 0;
    if (ext === 'jef') {
      const offset = r.u32(true);
      r.seek(24);
      const count = r.u32(true);
      if (count < 1 || count > 10000 || offset < 116 + count * 4) throw new Error('Invalid JEF header.');
      r.seek(116);
      for (let i = 0; i < count; i++) {
        const code = Math.abs(r.u32(true) | 0);
        slots.push(code === 0 ? null : JEF_THREADS[code % JEF_THREADS.length]);
      }
      result.colors.push(slots[0] ?? fallback(0));
      r.seek(offset);
      result.notes.push(
        'JEF jump records are preserved. Trim interpretation depends on the machine; no distance-based trim guesses are added.',
      );
    } else
      result.notes.push(
        'EXP has no embedded thread palette; assign the displayed placeholder colors to the intended threads.',
      );
    let ended = false;
    while (r.pos < data.length) {
      const a = r.u8(),
        b = r.u8();
      if (a !== 0x80) {
        emit(MC.STITCH, a < 128 ? a : a - 256, -(b < 128 ? b : b - 256));
        continue;
      }
      if (ext === 'jef' && b === 0x10) {
        ended = true;
        break;
      }
      const dx = r.i8(),
        dy = -r.i8();
      if (b === 1) {
        if (ext === 'jef') {
          slot++;
          if (slot >= slots.length) throw new Error('JEF color change exceeds its thread table.');
          if (!slots[slot]) emit(MC.STOP);
          else {
            emit(MC.COLOR_CHANGE);
            result.colors.push(slots[slot]!);
          }
        } else {
          emit(MC.COLOR_CHANGE);
          if (dx || dy) emit(MC.JUMP, dx, dy);
        }
      } else if ((ext === 'jef' && b === 2) || (ext === 'exp' && b === 4)) emit(MC.JUMP, dx, dy);
      else if (ext === 'exp' && b === 0x80) emit(MC.TRIM);
      else if (ext === 'exp' && b === 2) emit(MC.STITCH, dx, dy);
      else throw new Error(`Unsupported ${ext.toUpperCase()} control 0x${b.toString(16)}.`);
    }
    if (ext === 'jef' && !ended) throw new Error('JEF file has no end command.');
  } else if (ext === 'vp3') {
    if (new TextDecoder().decode(r.take(6)) !== '%vsm%\0') throw new Error('Not a VP3 file.');
    r.str();
    r.take(7);
    r.str();
    r.take(32);
    const cx = r.i32() / 100,
      cy = -r.i32() / 100;
    r.take(27);
    r.str();
    r.take(24);
    r.str();
    const count = r.u16();
    if (!count) throw new Error('VP3 has no color blocks.');
    for (let block = 0; block < count; block++) {
      const marker = r.take(3);
      if (marker[0] !== 0 || marker[1] !== 5 || marker[2] !== 0) throw new Error('Invalid VP3 color block.');
      const length = r.u32(),
        end = r.pos + length;
      if (end > data.length) throw new Error('Truncated VP3 color block.');
      const ax = r.i32() / 100 + cx,
        ay = -r.i32() / 100 + cy;
      if (block) emit(MC.COLOR_CHANGE);
      // Correct upstream's && test: an offset on either axis needs positioning.
      if (ax !== 0 || ay !== 0) emit(MC.JUMP, ax - x, ay - y);
      const colors = r.u8();
      r.u8();
      let color = '#000000';
      for (let i = 0; i < colors; i++) {
        color = '#' + [...r.take(3)].map((v) => v.toString(16).padStart(2, '0')).join('');
        r.take(3);
      }
      r.take(2);
      const code = r.str(),
        name = r.str();
      r.str();
      result.colors.push({ color, code, name });
      r.take(15);
      const stitchHeader = r.take(3);
      if (stitchHeader[0] !== 10 || stitchHeader[1] !== 246) throw new Error('Invalid VP3 stitch block.');
      while (r.pos + 1 < end) {
        const a = r.u8(),
          b = r.u8();
        if (a !== 0x80) emit(MC.STITCH, a < 128 ? a : a - 256, b < 128 ? b : b - 256);
        else if (b === 1) {
          const dx = r.i16(),
            dy = r.i16();
          emit(MC.STITCH, dx, dy);
          if (r.u8() !== 0x80 || r.u8() !== 2) throw new Error('Invalid VP3 long stitch terminator.');
        } else if (b === 3) emit(MC.TRIM);
        else if (b !== 2) throw new Error(`Unsupported VP3 control ${b}.`);
        if (r.pos > end) throw new Error('VP3 stitch exceeds its color block.');
      }
      r.seek(end);
    }
    result.notes.push(
      'VP3 has no separate stop instruction; stored color boundaries are imported as color changes.',
    );
  } else throw new Error(`Unsupported machine format: ${ext}`);
  emit(MC.END);
  const needed = 1 + result.commands.filter((c) => c.cmd === MC.COLOR_CHANGE).length;
  while (result.colors.length < needed) result.colors.push(fallback(result.colors.length));
  if (!result.commands.some((c) => c.cmd === MC.STITCH))
    throw new Error('The machine file contains no stitches.');
  return result;
}
