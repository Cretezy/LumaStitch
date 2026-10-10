// SPDX-License-Identifier: GPL-3.0-or-later
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { crc32, unzipFiles, zipFiles } from './zip';

const enc = new TextEncoder();
const dec = new TextDecoder();

function hasCmd(cmd: string): boolean {
  try {
    execFileSync(cmd, ['-v'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const tmp = mkdtempSync(join(tmpdir(), 'lumastitch-zip-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('crc32', () => {
  it('matches the standard check value', () => {
    expect(crc32(enc.encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });
});

describe('zipFiles / unzipFiles', () => {
  const files = [
    { name: 'manifest.json', data: enc.encode('{"a":1}') },
    { name: 'Café ☕ 刺繍.lumastitch', data: enc.encode('x'.repeat(5000)) },
    { name: 'empty.txt', data: new Uint8Array() },
    { name: 'thumbs/bin.png', data: Uint8Array.from({ length: 256 }, (_, i) => i) },
  ];

  it('round-trips names (UTF-8) and contents', async () => {
    const zip = zipFiles(files);
    const back = await unzipFiles(zip);
    expect(back.map((f) => f.name)).toEqual(files.map((f) => f.name));
    back.forEach((f, i) => expect(Array.from(f.data)).toEqual(Array.from(files[i].data)));
  });

  it('reads from a subarray view', async () => {
    const zip = zipFiles(files);
    const padded = new Uint8Array(zip.length + 10);
    padded.set(zip, 7);
    const back = await unzipFiles(padded.subarray(7, 7 + zip.length));
    expect(back).toHaveLength(files.length);
  });

  it('handles an empty archive', async () => {
    expect(await unzipFiles(zipFiles([]))).toEqual([]);
  });

  it('rejects non-zip data and detects corruption', async () => {
    await expect(unzipFiles(enc.encode('definitely not a zip file at all'))).rejects.toThrow(/ZIP/);
    const zip = zipFiles([{ name: 'a.txt', data: enc.encode('hello world') }]);
    const bad = zip.slice();
    bad[30 + 'a.txt'.length] ^= 0xff; // flip a data byte
    await expect(unzipFiles(bad)).rejects.toThrow(/checksum/);
  });

  it.runIf(hasCmd('unzip'))('writes archives the system unzip accepts', () => {
    const path = join(tmp, 'ours.zip');
    writeFileSync(path, zipFiles(files));
    const out = execFileSync('unzip', ['-t', path]).toString();
    expect(out).toMatch(/No errors detected/);
  });

  it.runIf(hasCmd('zip'))('reads DEFLATE archives written by the system zip', async () => {
    const dir = join(tmp, 'src');
    mkdirSync(join(dir, 'sub'), { recursive: true });
    const big = JSON.stringify({
      shapes: Array.from({ length: 300 }, (_, i) => ({ id: `s${i}`, d: 'M0 0 L10 10 Z' })),
    });
    writeFileSync(join(dir, 'design.lumastitch'), big);
    writeFileSync(join(dir, 'sub', 'note.txt'), 'hello');
    const zipPath = join(tmp, 'sys.zip');
    execFileSync('zip', ['-q', '-r', '-9', zipPath, '.'], { cwd: dir });
    const back = await unzipFiles(new Uint8Array(readFileSync(zipPath)));
    const byName = new Map(back.map((f) => [f.name, dec.decode(f.data)]));
    expect(byName.get('design.lumastitch')).toBe(big);
    expect(byName.get('sub/note.txt')).toBe('hello');
    expect([...byName.keys()].some((n) => n.endsWith('/'))).toBe(false);
  });

  it.runIf(hasCmd('zip'))('reads streamed archives with data descriptors', async () => {
    const text = 'stream me '.repeat(200);
    const out = execFileSync('zip', ['-q', '-', '-'], { input: text });
    const back = await unzipFiles(new Uint8Array(out));
    expect(back).toHaveLength(1);
    expect(dec.decode(back[0].data)).toBe(text);
  });
});
