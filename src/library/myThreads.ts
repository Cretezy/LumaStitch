// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * "My threads" (FR-5.2b, P1): a user-level palette of the spools the user owns,
 * stored in IndexedDB (idb-keyval, key 'myThreads') and shared by all designs.
 * IndexedDB access is kept to `loadMyThreads`/`saveMyThreads`; everything else
 * is pure.
 */
import { get, set, type UseStore } from 'idb-keyval';
import { normalizeHex } from '@/threads/color';
import type { ThreadChart } from '@/threads/charts';

export interface MyThread {
  id: string;
  name: string;
  /** Lowercase `#rrggbb`. */
  color: string;
  code?: string;
  /** Chart id the thread came from, if any. */
  chart?: string;
}

export interface MyThreads {
  threads: MyThread[];
}

export const MY_THREADS_KEY = 'myThreads';

export function emptyMyThreads(): MyThreads {
  return { threads: [] };
}

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Validate/repair untrusted stored data. Invalid entries are dropped, duplicate ids keep the first. */
export function normalizeMyThreads(raw: unknown): MyThreads {
  const list = (raw as { threads?: unknown } | null)?.threads;
  if (!Array.isArray(list)) return emptyMyThreads();
  const seen = new Set<string>();
  const threads: MyThread[] = [];
  for (const t of list as unknown[]) {
    if (!t || typeof t !== 'object') continue;
    const r = t as Record<string, unknown>;
    if (typeof r.id !== 'string' || !r.id || seen.has(r.id)) continue;
    if (typeof r.color !== 'string' || !HEX.test(r.color.trim())) continue;
    const color = normalizeHex(r.color);
    const out: MyThread = { id: r.id, name: typeof r.name === 'string' ? r.name : color, color };
    if (typeof r.code === 'string' && r.code) out.code = r.code;
    if (typeof r.chart === 'string' && r.chart) out.chart = r.chart;
    seen.add(r.id);
    threads.push(out);
  }
  return { threads };
}

export async function loadMyThreads(store?: UseStore): Promise<MyThreads> {
  return normalizeMyThreads(await get(MY_THREADS_KEY, store));
}

export async function saveMyThreads(value: MyThreads, store?: UseStore): Promise<void> {
  await set(MY_THREADS_KEY, normalizeMyThreads(value), store);
}

/**
 * Stable id for a chart thread, so re-adding the same spool is a no-op. The
 * colour is included because a few charts reuse a code for different colours.
 */
export function chartThreadId(chartId: string, code: string, color: string): string {
  return `${chartId}:${code}:${normalizeHex(color).slice(1)}`;
}

/**
 * Threads from a chart: all of them, or only those whose code is in `codes`
 * (in the order of `codes`; unknown codes are ignored).
 */
export function fromChart(chart: ThreadChart, codes?: readonly string[]): MyThread[] {
  const make = (t: ThreadChart['threads'][number]): MyThread => {
    const m: MyThread = {
      id: chartThreadId(chart.id, t.code, t.color),
      name: t.name,
      color: normalizeHex(t.color),
      chart: chart.id,
    };
    if (t.code) m.code = t.code;
    return m;
  };
  if (!codes) return dedupeById(chart.threads.map(make));
  const byCode = new Map<string, ThreadChart['threads'][number]>();
  for (const t of chart.threads) {
    const k = t.code.trim().toLowerCase();
    if (!byCode.has(k)) byCode.set(k, t);
  }
  const out: MyThread[] = [];
  for (const c of codes) {
    const t = byCode.get(c.trim().toLowerCase());
    if (t) out.push(make(t));
  }
  return dedupeById(out);
}

export type DesignColor = string | { color: string; name?: string; code?: string; chart?: string };

/**
 * Threads from a design's colours (hex strings or `Thread`-like objects),
 * one per distinct colour, in first-seen order.
 */
export function fromDesignColors(colors: readonly DesignColor[]): MyThread[] {
  const out: MyThread[] = [];
  const seen = new Set<string>();
  for (const c of colors) {
    const src = typeof c === 'string' ? { color: c } : c;
    if (!HEX.test(src.color.trim())) continue;
    const color = normalizeHex(src.color);
    if (seen.has(color)) continue;
    seen.add(color);
    const id = src.chart && src.code ? chartThreadId(src.chart, src.code, color) : `color:${color}`;
    const m: MyThread = { id, name: src.name?.trim() || color, color };
    if (src.code) m.code = src.code;
    if (src.chart) m.chart = src.chart;
    out.push(m);
  }
  return out;
}

/** Append threads whose id is not already present. */
export function mergeMyThreads(current: MyThreads, added: readonly MyThread[]): MyThreads {
  const ids = new Set(current.threads.map((t) => t.id));
  const threads = [...current.threads];
  for (const t of added) {
    if (ids.has(t.id)) continue;
    ids.add(t.id);
    threads.push(t);
  }
  return { threads };
}

/** Remove threads by id. */
export function removeMyThreads(current: MyThreads, ids: readonly string[]): MyThreads {
  const drop = new Set(ids);
  return { threads: current.threads.filter((t) => !drop.has(t.id)) };
}

function dedupeById(list: MyThread[]): MyThread[] {
  const seen = new Set<string>();
  return list.filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));
}
