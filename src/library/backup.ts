// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Library backup and restore (FR-8.5): a ZIP of `.lumastitch` project files plus `manifest.json`
 * (and the PNG thumbnails, so the restored library looks the same straight away).
 *
 * The archive building and parsing is pure (see `buildBackupZip` / `readBackupZip`); the IndexedDB
 * access in `backupLibrary` / `restoreLibrary` is a thin layer on top.
 */
import { parseProjectFile, serializeProject } from '@/model/schema';
import type { Design } from '@/model/types';
import { safeFileName } from '@/io/project/files';
import { createLibraryEntry, listDesigns, loadDesign, saveDesign, type DesignMeta } from './library';
import { unzipFiles, zipFiles, type ZipEntry } from './zip';

export const BACKUP_FORMAT = 'lumastitch-library';
export const BACKUP_VERSION = 1;

/** Metadata carried over so restored cards show size, stitch count and thumbnail before reopening. */
export type BackupMetaExtras = Pick<DesignMeta, 'stitches' | 'colors' | 'widthMm' | 'heightMm'>;

export interface BackupManifestEntry extends BackupMetaExtras {
  id: string;
  name: string;
  /** Project file path inside the archive. */
  file: string;
  /** Thumbnail PNG path inside the archive, if any. */
  thumbnail?: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  designs: BackupManifestEntry[];
}

export interface BackupItem {
  meta: Pick<DesignMeta, 'id' | 'name'> & Partial<DesignMeta>;
  design: Design;
  /** PNG bytes of the thumbnail. */
  thumbnail?: Uint8Array;
}

export interface RestoredItem {
  design: Design;
  extras: BackupMetaExtras;
  thumbnail?: Uint8Array;
}

/** Archive path of a design's project file: `<safe name>-<id>.lumastitch`. */
export function backupFileName(name: string, id: string): string {
  const safeId = id.replace(/[^A-Za-z0-9_-]+/g, '_');
  return safeFileName(`${name || 'Untitled'}-${safeId}`, 'lumastitch');
}

/** Builds the backup archive from already-loaded designs. Pure. */
export function buildBackupZip(items: BackupItem[], now: Date = new Date()): Uint8Array {
  const enc = new TextEncoder();
  const files: ZipEntry[] = [];
  const designs: BackupManifestEntry[] = [];
  const used = new Set<string>(['manifest.json']);
  for (const { meta, design, thumbnail } of items) {
    const first = backupFileName(design.name || meta.name, meta.id);
    let file = first;
    for (let n = 2; used.has(file); n++) file = first.replace(/\.lumastitch$/, `-${n}.lumastitch`);
    used.add(file);
    files.push({ name: file, data: enc.encode(serializeProject(design)) });
    const entry: BackupManifestEntry = { id: meta.id, name: design.name || meta.name, file };
    if (thumbnail && thumbnail.length) {
      entry.thumbnail = `thumbnails/${file.replace(/\.lumastitch$/, '.png')}`;
      files.push({ name: entry.thumbnail, data: thumbnail });
    }
    for (const k of ['stitches', 'colors', 'widthMm', 'heightMm', 'createdAt', 'updatedAt'] as const) {
      const val = meta[k];
      if (typeof val === 'number' && Number.isFinite(val)) entry[k] = val;
    }
    designs.push(entry);
  }
  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    designs,
  };
  files.unshift({ name: 'manifest.json', data: enc.encode(JSON.stringify(manifest, null, 2)) });
  return zipFiles(files, { date: now });
}

function readManifest(entries: Map<string, Uint8Array>): BackupManifest | null {
  const raw = entries.get('manifest.json');
  if (!raw) return null;
  try {
    const m = JSON.parse(new TextDecoder().decode(raw));
    if (m?.format !== BACKUP_FORMAT || !Array.isArray(m.designs)) return null;
    if (typeof m.version === 'number' && m.version > BACKUP_VERSION) {
      throw new Error('This backup was made with a newer LumaStitch.');
    }
    return m as BackupManifest;
  } catch (err) {
    if (err instanceof Error && /newer/.test(err.message)) throw err;
    return null;
  }
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/**
 * Parses a backup archive. Every `.lumastitch` file in the archive is read (in manifest order first,
 * then any others), so a ZIP of hand-collected project files restores too. Pure apart from decompression.
 */
export async function readBackupZip(bytes: Uint8Array): Promise<{ items: RestoredItem[]; skipped: number }> {
  const entries = new Map((await unzipFiles(bytes)).map((e) => [e.name, e.data] as const));
  const manifest = readManifest(entries);
  const projectFiles = [...entries.keys()].filter(
    (n) => /\.lumastitch$/i.test(n) && !n.split('/').some((s) => s.startsWith('.') || s === '__MACOSX'),
  );
  if (!manifest && projectFiles.length === 0)
    throw new Error('This file is not a LumaStitch library backup.');

  const byFile = new Map(
    (manifest?.designs ?? []).filter((d) => typeof d?.file === 'string').map((d) => [d.file, d] as const),
  );
  const ordered = [...(manifest?.designs.map((d) => d.file).filter((f) => entries.has(f)) ?? [])];
  for (const f of projectFiles) if (!ordered.includes(f)) ordered.push(f);
  // Manifest entries pointing at missing files count as skipped.
  let skipped =
    (manifest?.designs.length ?? 0) - (manifest?.designs.filter((d) => entries.has(d.file)).length ?? 0);

  const dec = new TextDecoder();
  const items: RestoredItem[] = [];
  for (const file of ordered) {
    try {
      const design = parseProjectFile(dec.decode(entries.get(file)!));
      const m = byFile.get(file);
      const extras: BackupMetaExtras = {};
      if (m) {
        for (const k of ['stitches', 'colors', 'widthMm', 'heightMm'] as const) {
          const v = num(m[k]);
          if (v !== undefined) extras[k] = v;
        }
      }
      const thumbnail = m?.thumbnail ? entries.get(m.thumbnail) : undefined;
      items.push({ design, extras, thumbnail });
    } catch {
      skipped++;
    }
  }
  return { items, skipped };
}

// ---------------------------------------------------------------------------- IndexedDB layer

/** Zips every design in the local library. */
export async function backupLibrary(): Promise<Blob> {
  const metas = await listDesigns();
  const items: BackupItem[] = [];
  for (const meta of metas) {
    const design = await loadDesign(meta.id).catch(() => null);
    if (!design) continue;
    const thumbnail = meta.thumbnail ? new Uint8Array(await meta.thumbnail.arrayBuffer()) : undefined;
    items.push({ meta, design, thumbnail });
  }
  return new Blob([new Uint8Array(buildBackupZip(items))], { type: 'application/zip' });
}

/** Restores a backup as NEW library entries (nothing is overwritten). */
export async function restoreLibrary(blob: Blob): Promise<{ restored: number; skipped: number }> {
  const { items, skipped } = await readBackupZip(new Uint8Array(await blob.arrayBuffer()));
  let restored = 0;
  let failed = 0;
  // The library lists newest first and each save stamps "now", so restore oldest first to keep the order.
  for (const item of [...items].reverse()) {
    try {
      const id = await createLibraryEntry(item.design);
      const extras: Partial<DesignMeta> = { ...item.extras };
      if (item.thumbnail)
        extras.thumbnail = new Blob([new Uint8Array(item.thumbnail)], { type: 'image/png' });
      if (Object.keys(extras).length) await saveDesign(id, item.design, extras);
      restored++;
    } catch {
      failed++;
    }
  }
  return { restored, skipped: skipped + failed };
}
