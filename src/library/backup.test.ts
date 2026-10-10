// SPDX-License-Identifier: GPL-3.0-or-later
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDesign } from '@/model/factories';
import { serializeProject } from '@/model/schema';
import type { Design } from '@/model/types';
import type { DesignMeta } from './library';
import {
  BACKUP_FORMAT,
  backupFileName,
  backupLibrary,
  buildBackupZip,
  readBackupZip,
  restoreLibrary,
  type BackupManifest,
} from './backup';
import { unzipFiles, zipFiles } from './zip';

// In-memory stand-in for the IndexedDB library.
const db = vi.hoisted(() => ({
  metas: [] as DesignMeta[],
  designs: new Map<string, Design>(),
  saved: [] as { id: string; design: Design; extra?: Partial<DesignMeta> }[],
  nextId: 0,
}));
vi.mock('./library', () => ({
  listDesigns: async () => db.metas,
  loadDesign: async (id: string) => db.designs.get(id) ?? null,
  createLibraryEntry: async (design: Design) => {
    const id = `new${++db.nextId}`;
    db.saved.push({ id, design });
    return id;
  },
  saveDesign: async (id: string, design: Design, extra?: Partial<DesignMeta>) => {
    db.saved.push({ id, design, extra });
  },
}));

const enc = new TextEncoder();
const dec = new TextDecoder();
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

function items() {
  return [
    {
      meta: {
        id: 'd1',
        name: 'Rose',
        stitches: 1234,
        colors: 3,
        widthMm: 80.5,
        heightMm: 60,
        updatedAt: 2000,
      },
      design: createDesign({ name: 'Rose', fabric: 'knit' }),
      thumbnail: PNG,
    },
    { meta: { id: 'd2', name: 'Logo: v2/final?' }, design: createDesign({ name: 'Logo: v2/final?' }) },
  ];
}

describe('backupFileName', () => {
  it('combines a safe name and the id', () => {
    expect(backupFileName('Logo: v2/final?', 'd2')).toBe('Logo_ v2_final_-d2.lumastitch');
    expect(backupFileName('', 'abc')).toBe('Untitled-abc.lumastitch');
  });
});

describe('buildBackupZip', () => {
  it('writes project files, thumbnails and a manifest', async () => {
    const zip = buildBackupZip(items(), new Date('2026-10-10T12:00:00Z'));
    const files = await unzipFiles(zip);
    const names = files.map((f) => f.name);
    expect(names[0]).toBe('manifest.json');
    expect(names).toContain('Rose-d1.lumastitch');
    expect(names).toContain('Logo_ v2_final_-d2.lumastitch');
    expect(names).toContain('thumbnails/Rose-d1.png');

    const manifest: BackupManifest = JSON.parse(dec.decode(files[0].data));
    expect(manifest).toMatchObject({
      format: BACKUP_FORMAT,
      version: 1,
      exportedAt: '2026-10-10T12:00:00.000Z',
    });
    expect(manifest.designs).toEqual([
      {
        id: 'd1',
        name: 'Rose',
        file: 'Rose-d1.lumastitch',
        thumbnail: 'thumbnails/Rose-d1.png',
        stitches: 1234,
        colors: 3,
        widthMm: 80.5,
        heightMm: 60,
        updatedAt: 2000,
      },
      { id: 'd2', name: 'Logo: v2/final?', file: 'Logo_ v2_final_-d2.lumastitch' },
    ]);

    const project = JSON.parse(dec.decode(files.find((f) => f.name === 'Rose-d1.lumastitch')!.data));
    expect(project.format).toBe('lumastitch-project');
    expect(project.design.fabric).toBe('knit');
  });

  it('keeps file names unique', async () => {
    const d = createDesign({ name: 'A' });
    const zip = buildBackupZip([
      { meta: { id: 'x/1', name: 'A' }, design: d },
      { meta: { id: 'x?1', name: 'A' }, design: d },
    ]);
    const names = (await unzipFiles(zip)).map((f) => f.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('readBackupZip', () => {
  it('round-trips designs, metadata and thumbnails in manifest order', async () => {
    const { items: out, skipped } = await readBackupZip(buildBackupZip(items()));
    expect(skipped).toBe(0);
    expect(out.map((i) => i.design.name)).toEqual(['Rose', 'Logo: v2/final?']);
    expect(out[0].design.fabric).toBe('knit');
    expect(out[0].extras).toEqual({ stitches: 1234, colors: 3, widthMm: 80.5, heightMm: 60 });
    expect(Array.from(out[0].thumbnail!)).toEqual(Array.from(PNG));
    expect(out[1].thumbnail).toBeUndefined();
  });

  it('skips corrupt project files and missing manifest entries', async () => {
    const manifest: BackupManifest = {
      format: BACKUP_FORMAT,
      version: 1,
      exportedAt: new Date().toISOString(),
      designs: [
        { id: 'a', name: 'Good', file: 'good.lumastitch' },
        { id: 'b', name: 'Bad', file: 'bad.lumastitch' },
        { id: 'c', name: 'Gone', file: 'missing.lumastitch' },
      ],
    };
    const zip = zipFiles([
      { name: 'manifest.json', data: enc.encode(JSON.stringify(manifest)) },
      { name: 'good.lumastitch', data: enc.encode(serializeProject(createDesign({ name: 'Good' }))) },
      { name: 'bad.lumastitch', data: enc.encode('{"format":"nope"}') },
    ]);
    const r = await readBackupZip(zip);
    expect(r.items.map((i) => i.design.name)).toEqual(['Good']);
    expect(r.skipped).toBe(2);
  });

  it('accepts a plain zip of project files without a manifest', async () => {
    const zip = zipFiles([
      { name: 'folder/one.lumastitch', data: enc.encode(serializeProject(createDesign({ name: 'One' }))) },
      { name: '__MACOSX/folder/._one.lumastitch', data: enc.encode('junk') },
      { name: 'readme.txt', data: enc.encode('hi') },
    ]);
    const r = await readBackupZip(zip);
    expect(r.items.map((i) => i.design.name)).toEqual(['One']);
    expect(r.skipped).toBe(0);
  });

  it('rejects archives that are not backups', async () => {
    await expect(readBackupZip(zipFiles([{ name: 'a.txt', data: enc.encode('x') }]))).rejects.toThrow(
      /not a LumaStitch library backup/,
    );
    const newer = zipFiles([
      {
        name: 'manifest.json',
        data: enc.encode(JSON.stringify({ format: BACKUP_FORMAT, version: 99, designs: [] })),
      },
    ]);
    await expect(readBackupZip(newer)).rejects.toThrow(/newer/);
  });
});

describe('backupLibrary / restoreLibrary (IndexedDB layer)', () => {
  beforeEach(() => {
    db.metas = [];
    db.designs.clear();
    db.saved = [];
    db.nextId = 0;
  });

  it('backs up the library and restores it as new entries, oldest first', async () => {
    const now = Date.now();
    db.metas = [
      {
        id: 'd1',
        name: 'Newest',
        createdAt: now,
        updatedAt: now,
        thumbnail: new Blob([PNG], { type: 'image/png' }),
        stitches: 10,
      },
      { id: 'd2', name: 'Older', createdAt: now, updatedAt: now - 1000 },
      { id: 'd3', name: 'Dangling meta', createdAt: now, updatedAt: now - 2000 },
    ];
    db.designs.set('d1', createDesign({ name: 'Newest' }));
    db.designs.set('d2', createDesign({ name: 'Older' }));

    const blob = await backupLibrary();
    expect(blob.type).toBe('application/zip');

    const r = await restoreLibrary(blob);
    expect(r).toEqual({ restored: 2, skipped: 0 });
    const created = db.saved.filter((s) => !s.extra);
    expect(created.map((s) => s.design.name)).toEqual(['Older', 'Newest']);
    const withExtras = db.saved.find((s) => s.extra)!;
    expect(withExtras.extra!.stitches).toBe(10);
    expect(withExtras.extra!.thumbnail).toBeInstanceOf(Blob);
    expect(db.saved.every((s) => s.id.startsWith('new'))).toBe(true);
  });
});
