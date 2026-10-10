// SPDX-License-Identifier: GPL-3.0-or-later
/** Local project library in IndexedDB: designs, metadata (with thumbnails) and preferences. */
import { createStore, del, entries, get, set, type UseStore } from 'idb-keyval';
import { newId } from '@/lib/ids';
import { parseDesign } from '@/model/schema';
import type { Design } from '@/model/types';

export interface DesignMeta {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  thumbnail?: Blob;
  stitches?: number;
  colors?: number;
  widthMm?: number;
  heightMm?: number;
}

let stores: { designs: UseStore; meta: UseStore; prefs: UseStore } | null = null;
function db() {
  if (!stores) {
    stores = {
      designs: createStore('lumastitch-designs', 'designs'),
      meta: createStore('lumastitch-meta', 'meta'),
      prefs: createStore('lumastitch-prefs', 'prefs'),
    };
  }
  return stores;
}

export async function listDesigns(): Promise<DesignMeta[]> {
  const all = (await entries<string, DesignMeta>(db().meta)).map(([, m]) => m);
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getMeta(id: string): Promise<DesignMeta | undefined> {
  return get<DesignMeta>(id, db().meta);
}

export async function loadDesign(id: string): Promise<Design | null> {
  const raw = await get(id, db().designs);
  if (!raw) return null;
  return parseDesign(raw);
}

export async function saveDesign(id: string, design: Design, extra: Partial<DesignMeta> = {}): Promise<void> {
  const prev = await get<DesignMeta>(id, db().meta);
  const now = Date.now();
  const meta: DesignMeta = {
    ...(prev ?? { id, createdAt: now }),
    ...extra,
    id,
    name: design.name,
    updatedAt: now,
  };
  if (extra.thumbnail === undefined && prev?.thumbnail) meta.thumbnail = prev.thumbnail;
  await set(id, design, db().designs);
  await set(id, meta, db().meta);
}

/** Creates a new library entry for a design and returns its id. */
export async function createLibraryEntry(design: Design): Promise<string> {
  const id = newId('d');
  await saveDesign(id, design);
  return id;
}

export async function deleteDesign(id: string): Promise<void> {
  await del(id, db().designs);
  await del(id, db().meta);
  if ((await getPref<string>('lastOpenId')) === id) await setPref('lastOpenId', null);
}

export async function duplicateDesign(id: string): Promise<string | null> {
  const d = await loadDesign(id);
  if (!d) return null;
  const meta = await getMeta(id);
  const copy: Design = { ...d, name: `${d.name} copy` };
  const nid = newId('d');
  await saveDesign(nid, copy, {
    thumbnail: meta?.thumbnail,
    stitches: meta?.stitches,
    colors: meta?.colors,
    widthMm: meta?.widthMm,
    heightMm: meta?.heightMm,
  });
  return nid;
}

export async function renameDesign(id: string, name: string): Promise<void> {
  const d = await loadDesign(id);
  if (!d) return;
  await saveDesign(id, { ...d, name });
}

export async function getPref<T>(key: string): Promise<T | undefined> {
  try {
    return await get<T>(key, db().prefs);
  } catch {
    return undefined;
  }
}

export async function setPref<T>(key: string, value: T): Promise<void> {
  try {
    await set(key, value, db().prefs);
  } catch {
    /* storage unavailable */
  }
}

/** Ask the browser not to evict our data under storage pressure. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
