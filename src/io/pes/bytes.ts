// SPDX-License-Identifier: GPL-3.0-or-later
// Little/big-endian byte writer and reader used by the PES/PEC codecs.
// Mirrors the helpers in pyembroidery's WriteHelper.py / ReadHelper.py
// (pyembroidery, MIT License, Copyright (c) 2018 Tatarize).
// No DOM APIs: safe in Web Workers and Node.

const UTF8 = new TextEncoder();
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

/** Growable byte buffer with absolute-position patching (the `f.seek()` + write idiom). */
export class ByteWriter {
  private buf: Uint8Array;
  private view: DataView;
  private len = 0;

  constructor(initialCapacity = 4096) {
    this.buf = new Uint8Array(Math.max(16, initialCapacity));
    this.view = new DataView(this.buf.buffer);
  }

  /** Current write position (== length; this writer only appends, patches are explicit). */
  get position(): number {
    return this.len;
  }

  private ensure(extra: number): void {
    const need = this.len + extra;
    if (need <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < need) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
    this.view = new DataView(next.buffer);
  }

  int8(v: number): void {
    this.ensure(1);
    this.buf[this.len++] = v & 0xff;
  }

  int16le(v: number): void {
    this.ensure(2);
    this.view.setUint16(this.len, v & 0xffff, true);
    this.len += 2;
  }

  int16be(v: number): void {
    this.ensure(2);
    this.view.setUint16(this.len, v & 0xffff, false);
    this.len += 2;
  }

  int24le(v: number): void {
    this.ensure(3);
    this.buf[this.len++] = v & 0xff;
    this.buf[this.len++] = (v >> 8) & 0xff;
    this.buf[this.len++] = (v >> 16) & 0xff;
  }

  int32le(v: number): void {
    this.ensure(4);
    this.view.setUint32(this.len, v >>> 0, true);
    this.len += 4;
  }

  float32le(v: number): void {
    this.ensure(4);
    this.view.setFloat32(this.len, v, true);
    this.len += 4;
  }

  bytes(data: ArrayLike<number>): void {
    this.ensure(data.length);
    for (let i = 0; i < data.length; i++) this.buf[this.len++] = data[i] & 0xff;
  }

  /** Writes `count` copies of `value`. Negative counts write nothing (Python `[x] * -n == []`). */
  fill(value: number, count: number): void {
    if (count <= 0) return;
    this.ensure(count);
    this.buf.fill(value & 0xff, this.len, this.len + count);
    this.len += count;
  }

  /** UTF-8 string, no length prefix (pyembroidery `write_string_utf8`). */
  utf8(s: string): void {
    this.bytes(UTF8.encode(s));
  }

  patchInt16le(pos: number, v: number): void {
    this.view.setUint16(pos, v & 0xffff, true);
  }

  patchInt24le(pos: number, v: number): void {
    this.buf[pos] = v & 0xff;
    this.buf[pos + 1] = (v >> 8) & 0xff;
    this.buf[pos + 2] = (v >> 16) & 0xff;
  }

  patchInt32le(pos: number, v: number): void {
    this.view.setUint32(pos, v >>> 0, true);
  }

  toUint8Array(): Uint8Array {
    return this.buf.slice(0, this.len);
  }
}

export function utf8Bytes(s: string): Uint8Array {
  return UTF8.encode(s);
}

/** Sequential reader. Reads past the end return `null` (like pyembroidery's ReadHelper). */
export class ByteReader {
  pos = 0;
  private readonly view: DataView;

  constructor(readonly data: Uint8Array) {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }

  get length(): number {
    return this.data.length;
  }

  seek(pos: number): void {
    this.pos = pos;
  }

  skip(n: number): void {
    this.pos += n;
  }

  int8(): number | null {
    if (this.pos < 0 || this.pos + 1 > this.data.length) {
      this.pos = Math.max(this.pos, this.data.length);
      return null;
    }
    return this.data[this.pos++];
  }

  int16le(): number | null {
    if (this.pos < 0 || this.pos + 2 > this.data.length) return null;
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }

  int24le(): number | null {
    if (this.pos < 0 || this.pos + 3 > this.data.length) return null;
    const d = this.data;
    const v = d[this.pos] | (d[this.pos + 1] << 8) | (d[this.pos + 2] << 16);
    this.pos += 3;
    return v;
  }

  int24be(): number | null {
    if (this.pos < 0 || this.pos + 3 > this.data.length) return null;
    const d = this.data;
    const v = (d[this.pos] << 16) | (d[this.pos + 1] << 8) | d[this.pos + 2];
    this.pos += 3;
    return v;
  }

  int32le(): number | null {
    if (this.pos < 0 || this.pos + 4 > this.data.length) return null;
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }

  /** Reads up to `n` bytes (fewer at EOF). */
  bytes(n: number): Uint8Array {
    const start = Math.min(Math.max(this.pos, 0), this.data.length);
    const end = Math.min(start + Math.max(n, 0), this.data.length);
    this.pos = Math.max(this.pos, 0) + n;
    return this.data.slice(start, end);
  }

  /** UTF-8 string of `n` bytes, or null when not valid UTF-8 (pyembroidery `read_string_8`). */
  string(n: number): string | null {
    const b = this.bytes(n);
    try {
      return UTF8_DECODER.decode(b);
    } catch {
      return null;
    }
  }
}
