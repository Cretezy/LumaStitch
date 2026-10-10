// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Minimal, dependency-free ZIP support for library backups.
 *
 * - Writer: STORE (no compression), CRC-32, UTF-8 file names. Project files are JSON and thumbnails are
 *   PNG, so compression would buy little for the extra code.
 * - Reader: STORE and DEFLATE (via `DecompressionStream('deflate-raw')`, available in modern browsers and
 *   Node ≥ 18). Reads the central directory, so archives written with data descriptors work too.
 *   ZIP64, encryption and multi-disk archives are not supported.
 */

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const FLAG_UTF8 = 0x0800;
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

// ---------------------------------------------------------------------------- CRC-32

let crcTable: Uint32Array | null = null;

function table(): Uint32Array {
  if (crcTable) return crcTable;
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  crcTable = t;
  return t;
}

/** CRC-32 (IEEE 802.3), as used by ZIP. */
export function crc32(data: Uint8Array): number {
  const t = table();
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = t[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------------------- writer

function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.min(Math.max(d.getFullYear(), 1980), 2107);
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/** Builds a ZIP archive (STORE method) from the given files. */
export function zipFiles(files: ZipEntry[], opts: { date?: Date } = {}): Uint8Array {
  const enc = new TextEncoder();
  const { time, date } = dosDateTime(opts.date ?? new Date());
  const prepared = files.map((f) => ({ name: enc.encode(f.name), data: f.data, crc: crc32(f.data) }));

  let localSize = 0;
  let centralSize = 0;
  for (const f of prepared) {
    localSize += 30 + f.name.length + f.data.length;
    centralSize += 46 + f.name.length;
  }
  if (prepared.length > 0xffff || localSize + centralSize > 0xffffffff)
    throw new Error('Archive too large (ZIP64 is not supported).');

  const out = new Uint8Array(localSize + centralSize + 22);
  const v = new DataView(out.buffer);
  const offsets: number[] = [];
  let p = 0;

  for (const f of prepared) {
    offsets.push(p);
    v.setUint32(p, SIG_LOCAL, true);
    v.setUint16(p + 4, 20, true); // version needed
    v.setUint16(p + 6, FLAG_UTF8, true);
    v.setUint16(p + 8, METHOD_STORE, true);
    v.setUint16(p + 10, time, true);
    v.setUint16(p + 12, date, true);
    v.setUint32(p + 14, f.crc, true);
    v.setUint32(p + 18, f.data.length, true);
    v.setUint32(p + 22, f.data.length, true);
    v.setUint16(p + 26, f.name.length, true);
    v.setUint16(p + 28, 0, true); // extra length
    out.set(f.name, p + 30);
    out.set(f.data, p + 30 + f.name.length);
    p += 30 + f.name.length + f.data.length;
  }

  const centralStart = p;
  prepared.forEach((f, i) => {
    v.setUint32(p, SIG_CENTRAL, true);
    v.setUint16(p + 4, 20, true); // version made by
    v.setUint16(p + 6, 20, true); // version needed
    v.setUint16(p + 8, FLAG_UTF8, true);
    v.setUint16(p + 10, METHOD_STORE, true);
    v.setUint16(p + 12, time, true);
    v.setUint16(p + 14, date, true);
    v.setUint32(p + 16, f.crc, true);
    v.setUint32(p + 20, f.data.length, true);
    v.setUint32(p + 24, f.data.length, true);
    v.setUint16(p + 28, f.name.length, true);
    // extra length, comment length, disk number, internal attrs, external attrs: all zero
    v.setUint32(p + 42, offsets[i], true);
    out.set(f.name, p + 46);
    p += 46 + f.name.length;
  });

  v.setUint32(p, SIG_EOCD, true);
  v.setUint16(p + 8, prepared.length, true);
  v.setUint16(p + 10, prepared.length, true);
  v.setUint32(p + 12, p - centralStart, true);
  v.setUint32(p + 16, centralStart, true);
  return out;
}

// ---------------------------------------------------------------------------- reader

function findEocd(v: DataView): number {
  // The EOCD record is 22 bytes plus a comment of up to 65535 bytes.
  const min = Math.max(0, v.byteLength - 22 - 0xffff);
  for (let p = v.byteLength - 22; p >= min; p--) {
    if (v.getUint32(p, true) === SIG_EOCD) return p;
  }
  throw new Error('Not a ZIP file.');
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined')
    throw new Error('This browser cannot read compressed ZIP files.');
  const stream = new Blob([new Uint8Array(data)])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Reads every file in a ZIP archive (directories are skipped). Supports STORE and DEFLATE.
 * Throws on malformed archives, unsupported methods or CRC mismatches.
 */
export async function unzipFiles(bytes: Uint8Array): Promise<ZipEntry[]> {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 22) throw new Error('Not a ZIP file.');
  const eocd = findEocd(v);
  const count = v.getUint16(eocd + 10, true);
  const cdSize = v.getUint32(eocd + 12, true);
  const cdOffset = v.getUint32(eocd + 16, true);
  if (cdOffset === 0xffffffff || count === 0xffff) throw new Error('ZIP64 archives are not supported.');
  if (cdOffset + cdSize > bytes.byteLength) throw new Error('The ZIP file is truncated or corrupt.');

  const utf8 = new TextDecoder('utf-8');
  const latin1 = new TextDecoder('latin1');
  const out: ZipEntry[] = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > bytes.byteLength || v.getUint32(p, true) !== SIG_CENTRAL)
      throw new Error('The ZIP file is corrupt (bad central directory).');
    const flags = v.getUint16(p + 8, true);
    const method = v.getUint16(p + 10, true);
    const crc = v.getUint32(p + 16, true);
    const compSize = v.getUint32(p + 20, true);
    const size = v.getUint32(p + 24, true);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    const localOffset = v.getUint32(p + 42, true);
    const nameBytes = bytes.subarray(p + 46, p + 46 + nameLen);
    // Bit 11 marks UTF-8; most tools also write UTF-8 without it, so try UTF-8 first and fall back.
    let name: string;
    try {
      name =
        flags & FLAG_UTF8
          ? utf8.decode(nameBytes)
          : new TextDecoder('utf-8', { fatal: true }).decode(nameBytes);
    } catch {
      name = latin1.decode(nameBytes);
    }
    p += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith('/')) continue;
    if (flags & 0x0001) throw new Error(`"${name}" is encrypted.`);
    if (compSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff)
      throw new Error('ZIP64 archives are not supported.');
    if (localOffset + 30 > bytes.byteLength || v.getUint32(localOffset, true) !== SIG_LOCAL)
      throw new Error('The ZIP file is corrupt (bad local header).');
    const start =
      localOffset + 30 + v.getUint16(localOffset + 26, true) + v.getUint16(localOffset + 28, true);
    if (start + compSize > bytes.byteLength) throw new Error('The ZIP file is truncated.');
    const raw = bytes.subarray(start, start + compSize);

    let data: Uint8Array;
    if (method === METHOD_STORE) data = raw.slice();
    else if (method === METHOD_DEFLATE) data = await inflateRaw(raw);
    else throw new Error(`"${name}" uses an unsupported compression method (${method}).`);
    if (data.length !== size || crc32(data) !== crc)
      throw new Error(`"${name}" is corrupt (checksum mismatch).`);
    out.push({ name, data });
  }
  return out;
}
