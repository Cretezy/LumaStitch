// SPDX-License-Identifier: GPL-3.0-or-later
/** File open/save helpers: File System Access API where available, else <input type=file> / <a download>. */

type Accept = Record<string, string[]>;

const handles = new Map<string, any>();

export function hasFsAccess(): boolean {
  return typeof window !== 'undefined' && 'showSaveFilePicker' in window;
}

export function safeFileName(name: string, ext: string): string {
  const base = (name || 'Untitled').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'Untitled';
  return base.endsWith('.' + ext) ? base : `${base}.${ext}`;
}

/** Saves bytes/text. `key` remembers the file handle so later saves write in place. */
export async function saveFile(
  data: Blob,
  suggestedName: string,
  opts: { description: string; accept: Accept; key?: string; saveAs?: boolean },
): Promise<'saved' | 'downloaded' | 'cancelled'> {
  if (hasFsAccess()) {
    try {
      let handle = opts.key && !opts.saveAs ? handles.get(opts.key) : undefined;
      if (!handle) {
        handle = await (window as any).showSaveFilePicker({
          suggestedName,
          types: [{ description: opts.description, accept: opts.accept }],
        });
        if (opts.key) handles.set(opts.key, handle);
      }
      const w = await handle.createWritable();
      await w.write(data);
      await w.close();
      return 'saved';
    } catch (err: any) {
      if (err?.name === 'AbortError') return 'cancelled';
      // Fall through to download (e.g. permission revoked).
    }
  }
  downloadBlob(data, suggestedName);
  return 'downloaded';
}

export function downloadBlob(data: Blob, name: string): void {
  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** Lets the user pick one file. Resolves null when cancelled. */
export async function pickFile(opts: { description: string; accept: Accept }): Promise<File | null> {
  if ('showOpenFilePicker' in window) {
    try {
      const [h] = await (window as any).showOpenFilePicker({
        types: [{ description: opts.description, accept: opts.accept }],
        multiple: false,
      });
      return await h.getFile();
    } catch (err: any) {
      if (err?.name === 'AbortError') return null;
    }
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = Object.values(opts.accept).flat().join(',') + ',' + Object.keys(opts.accept).join(',');
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

export const ACCEPT_PROJECT: Accept = { 'application/json': ['.lumastitch'] };
export const ACCEPT_IMPORT: Accept = {
  'image/svg+xml': ['.svg'],
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/webp': ['.webp'],
};
export const ACCEPT_ANY: Accept = {
  ...ACCEPT_IMPORT,
  ...ACCEPT_PROJECT,
  'application/octet-stream': ['.pes', '.dst', '.jef', '.exp', '.vp3'],
};

export type FileKind = 'svg' | 'image' | 'project' | 'machine' | 'unknown';

export function fileKind(f: File): FileKind {
  const n = f.name.toLowerCase();
  if (n.endsWith('.svg') || f.type === 'image/svg+xml') return 'svg';
  if (/\.(png|jpe?g|webp)$/.test(n) || /^image\/(png|jpeg|webp)$/.test(f.type)) return 'image';
  if (n.endsWith('.lumastitch')) return 'project';
  if (/\.(pes|dst|jef|exp|vp3)$/.test(n)) return 'machine';
  return 'unknown';
}
