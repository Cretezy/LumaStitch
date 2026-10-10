// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Thread chart registry. Built-in charts are JSON files generated from
 * Ink/Stitch's palettes (see scripts/import-palettes.ts and charts/manifest.ts);
 * each is a separate lazily-loaded chunk. Other modules may register extra
 * charts at runtime with `registerChart`.
 */
import { normalizeHex } from './color';
import { CHART_MANIFEST, INKSTITCH_COMMIT } from './charts/manifest';

export { INKSTITCH_COMMIT };

export interface ChartThread {
  code: string;
  name: string;
  /** Lowercase `#rrggbb`. */
  color: string;
}

export interface ThreadChart {
  id: string;
  name: string;
  brand: string;
  threads: ChartThread[];
}

export interface ChartMeta {
  id: string;
  name: string;
  brand: string;
  count: number;
}

type Loader = () => Promise<ThreadChart>;

const globbed = import.meta.glob<ThreadChart>('./charts/*.json', { import: 'default' });

const loaders = new Map<string, Loader>();
for (const [path, load] of Object.entries(globbed)) {
  const id = path.replace(/^.*\//, '').replace(/\.json$/, '');
  loaders.set(id, load);
}

const metas = new Map<string, ChartMeta>();
for (const m of CHART_MANIFEST) {
  if (loaders.has(m.id)) metas.set(m.id, { id: m.id, name: m.name, brand: m.brand, count: m.count });
}

const cache = new Map<string, Promise<ThreadChart>>();
const loaded = new Map<string, ThreadChart>();

/** All available charts, sorted by brand then name. */
export function listCharts(): ChartMeta[] {
  return [...metas.values()].sort(
    (a, b) => a.brand.localeCompare(b.brand, 'en') || a.name.localeCompare(b.name, 'en'),
  );
}

export function hasChart(id: string): boolean {
  return metas.has(id);
}

export function getChartMeta(id: string): ChartMeta | undefined {
  return metas.get(id);
}

/** Load a chart (cached). Rejects for unknown ids. */
export function getChart(id: string): Promise<ThreadChart> {
  let p = cache.get(id);
  if (!p) {
    const load = loaders.get(id);
    if (!load) return Promise.reject(new Error(`Unknown thread chart: ${id}`));
    p = load().then((chart) => {
      loaded.set(id, chart);
      return chart;
    });
    p.catch(() => cache.delete(id));
    cache.set(id, p);
  }
  return p;
}

/** The chart if it has already been loaded (synchronous; for render paths). */
export function peekChart(id: string): ThreadChart | undefined {
  return loaded.get(id);
}

/**
 * Register (or replace) a chart at runtime, e.g. the Brother PEC 64 palette.
 * Colours are normalised to lowercase `#rrggbb`.
 */
export function registerChart(chart: ThreadChart): void {
  const c: ThreadChart = {
    id: chart.id,
    name: chart.name,
    brand: chart.brand,
    threads: chart.threads.map((t) => ({ code: t.code, name: t.name, color: normalizeHex(t.color) })),
  };
  const p = Promise.resolve(c);
  loaders.set(c.id, () => p);
  cache.set(c.id, p);
  loaded.set(c.id, c);
  metas.set(c.id, { id: c.id, name: c.name, brand: c.brand, count: c.threads.length });
}

/** Find a thread by exact code (case-insensitive, leading zeros ignored). */
export function findByCode(chart: ThreadChart, code: string): ChartThread | undefined {
  const q = normCode(code);
  return chart.threads.find((t) => normCode(t.code) === q);
}

function normCode(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/^0+(?=.)/, '');
}

/**
 * Search a chart by code or name, case-insensitively. Ranking (best first):
 * exact code, code prefix, exact name, name prefix, name word prefix, code
 * substring, name substring. Ties keep chart order. An empty query returns
 * every thread.
 */
export function searchChart(chart: ThreadChart, query: string, limit = Infinity): ChartThread[] {
  const q = query.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!q) return chart.threads.slice(0, limit);
  const qc = normCode(q);
  const ranked: { rank: number; i: number }[] = [];
  chart.threads.forEach((t, i) => {
    const code = t.code.toLowerCase();
    const nc = normCode(t.code);
    const name = t.name.toLowerCase();
    let rank: number;
    if (code === q || (nc !== '' && nc === qc)) rank = 0;
    else if (code.startsWith(q) || (nc !== '' && nc.startsWith(qc))) rank = 1;
    else if (name === q) rank = 2;
    else if (name.startsWith(q)) rank = 3;
    else if (name.split(/[\s\-/.]+/).some((w) => w.startsWith(q))) rank = 4;
    else if (code.includes(q)) rank = 5;
    else if (name.includes(q)) rank = 6;
    else return;
    ranked.push({ rank, i });
  });
  ranked.sort((a, b) => a.rank - b.rank || a.i - b.i);
  return ranked.slice(0, limit).map((r) => chart.threads[r.i]);
}
