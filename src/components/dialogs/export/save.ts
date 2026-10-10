// SPDX-License-Identifier: GPL-3.0-or-later
import { saveFile } from '@/io/project/files';
import { useUi } from '@/store/uiStore';

type Accept = Record<string, string[]>;

export const ACCEPT_PES: Accept = { 'application/octet-stream': ['.pes'] };
export const ACCEPT_PNG: Accept = { 'image/png': ['.png'] };
export const ACCEPT_SVG: Accept = { 'image/svg+xml': ['.svg'] };
export const ACCEPT_PDF: Accept = { 'application/pdf': ['.pdf'] };

/** File-picker filter for a machine file extension (e.g. "dst"). */
export function acceptMachine(ext: string): Accept {
  return { 'application/octet-stream': [`.${ext}`] };
}

/** Saves a blob (file picker or download) and shows a toast. Resolves false when the user cancelled. */
export async function saveWithToast(
  blob: Blob,
  name: string,
  description: string,
  accept: Accept,
): Promise<boolean> {
  const res = await saveFile(blob, name, { description, accept });
  if (res === 'cancelled') return false;
  useUi.getState().showToast(res === 'saved' ? `Saved ${name}` : `Downloaded ${name}`, 'success');
  return true;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
