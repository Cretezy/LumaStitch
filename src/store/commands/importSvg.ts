// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * "Import SVG" command (SPEC FR-1.1, FR-1.1a, FR-1.1b, FR-1.7; ARCHITECTURE §8 steps 7–10).
 *
 * The importer (`@/io/svg-import`) produces shapes with default elements and one thread per exact
 * colour. This command commits them to the open design as ONE undo step:
 *   - threads: reuse an existing thread of the same colour (or the same chart thread when mapping),
 *     otherwise add the imported one; optionally map every colour to the nearest thread of a chart
 *     (FR-5.2a; the chart must be loaded first with `getChart`);
 *   - shapes: appended to `zOrder` in paint order; `sequence` gets each shape's fill then outline;
 *   - artwork backdrop: set when the design has none (or `replaceArtwork`);
 *   - an "Untitled" design is renamed after the file.
 *
 * The draft mutation is the pure function `applySvgImport`, testable in Node on a plain Design.
 */
import type { Draft } from 'immer';
import type { SvgImportResult } from '@/io/svg-import';
import { newId } from '@/lib/ids';
import type { Design, Id, Shape, Thread } from '@/model/types';
import { nearestThread } from '@/threads/nearest';
import { peekChart, type ChartThread, type ThreadChart } from '@/threads/charts';
import { exec } from '../documentStore';
import { useUi } from '../uiStore';

/** The parts of an `SvgImportResult` the command uses. */
export type SvgImportPayload = Pick<SvgImportResult, 'shapes' | 'threads' | 'artwork'> & { name?: string };

export interface ApplySvgImportOptions {
  /** Replace an existing artwork backdrop (default: only set it when the design has none). */
  replaceArtwork?: boolean;
  /** Map each imported colour to the nearest thread of this (loaded) chart. */
  chart?: ThreadChart | null;
  /** Name for an "Untitled" design (typically the file name without extension). */
  name?: string;
}

export interface ImportSvgOptions {
  replaceArtwork?: boolean;
  /** Chart id to map colours to (FR-5.2a). It must already be loaded (`await getChart(id)`). */
  mapToChart?: string | null;
  /** Name for an "Untitled" design; defaults to `result.name`. */
  name?: string;
}

const norm = (hex: string) => hex.trim().toLowerCase();

/** Strips a file extension and surrounding whitespace: "logo final.svg" → "logo final". */
export function baseFileName(fileName: string): string {
  return fileName.replace(/\.[^./\\]+$/, '').trim();
}

/** True for the default design name (so imports may rename it). */
export function isUntitledName(name: string): boolean {
  return /^untitled( design)?( \d+)?$/i.test(name.trim()) || name.trim() === '';
}

/**
 * Resolves the thread to use for a colour: an existing design thread when one matches, else a new
 * thread (added to `draft.threads`). With a chart, the colour is first replaced by the nearest chart
 * thread and matching is by chart + code.
 */
export class ThreadResolver {
  private readonly cache = new Map<string, Id>();
  /** Thread ids added to the design by this resolver. */
  readonly added: Id[] = [];

  constructor(
    private readonly draft: Design | Draft<Design>,
    private readonly chart: ThreadChart | null = null,
  ) {}

  /** Thread id for an exact colour (`template` supplies the name/id of an imported thread). */
  resolve(color: string, template?: Thread): Id {
    const key = norm(color);
    const hit = this.cache.get(key);
    if (hit) return hit;
    const id = this.chart ? this.resolveChart(key) : this.resolveExact(key, template);
    this.cache.set(key, id);
    return id;
  }

  private resolveExact(color: string, template?: Thread): Id {
    const existing = Object.values(this.draft.threads).find((t) => norm(t.color) === color);
    if (existing) return existing.id;
    const id = template && !this.draft.threads[template.id] ? template.id : newId('t');
    const t: Thread = { id, name: template?.name ?? color.toUpperCase(), color };
    this.add(t);
    return id;
  }

  private resolveChart(color: string): Id {
    const chart = this.chart!;
    const r = nearestThread(color, chart.threads);
    if (r.index < 0) return this.resolveExact(color);
    const ct: ChartThread = chart.threads[r.index];
    const ctColor = norm(ct.color);
    const existing =
      Object.values(this.draft.threads).find((t) => t.chart === chart.id && t.code === ct.code) ??
      Object.values(this.draft.threads).find((t) => norm(t.color) === ctColor && !t.chart && !t.code);
    if (existing) return existing.id;
    const t: Thread = {
      id: newId('t'),
      name: ct.name || ct.code,
      color: ctColor,
      chart: chart.id,
      code: ct.code,
    };
    this.add(t);
    return t.id;
  }

  private add(t: Thread) {
    this.draft.threads[t.id] = t;
    this.added.push(t.id);
  }
}

/**
 * Pure draft mutation for an SVG import. Returns the ids of the added shapes (paint order).
 * Shapes are copied (shape / element ids are renewed only when they collide with existing ones).
 */
export function applySvgImport(
  draft: Design | Draft<Design>,
  result: SvgImportPayload,
  opts: ApplySvgImportOptions = {},
): Id[] {
  const resolver = new ThreadResolver(draft, opts.chart ?? null);
  const importThreads = new Map(result.threads.map((t) => [t.id, t]));
  const threadFor = (importId: Id): Id => {
    const t = importThreads.get(importId);
    // Unknown thread id (shouldn't happen): keep whatever exists, else make a black thread.
    if (!t) return draft.threads[importId] ? importId : resolver.resolve('#000000');
    return resolver.resolve(t.color, t);
  };

  const existingEls = new Set<Id>();
  for (const sh of Object.values(draft.shapes)) {
    if (sh.fill) existingEls.add(sh.fill.id);
    if (sh.outline) existingEls.add(sh.outline.id);
  }
  const ids: Id[] = [];
  for (const src of result.shapes) {
    const s: Shape = structuredClone(src);
    if (draft.shapes[s.id]) s.id = newId('s');
    for (const el of [s.fill, s.outline]) {
      if (!el) continue;
      if (existingEls.has(el.id)) el.id = newId('e');
      existingEls.add(el.id);
      el.threadId = threadFor(el.threadId);
    }
    draft.shapes[s.id] = s;
    draft.zOrder.push(s.id);
    if (s.fill) draft.sequence.push({ kind: 'element', elementId: s.fill.id });
    if (s.outline) draft.sequence.push({ kind: 'element', elementId: s.outline.id });
    ids.push(s.id);
  }

  if (!draft.artwork || opts.replaceArtwork) draft.artwork = structuredClone(result.artwork);
  const name = opts.name ?? result.name;
  if (name && isUntitledName(draft.name)) draft.name = baseFileName(name) || draft.name;
  return ids;
}

/**
 * Commits an SVG import to the open design (one undo step "Import SVG") and selects the new shapes.
 * Returns the new shape ids (empty when no design is open or nothing was imported).
 */
export function importSvgIntoDesign(result: SvgImportResult, opts: ImportSvgOptions = {}): Id[] {
  let chart: ThreadChart | null = null;
  if (opts.mapToChart) {
    chart = peekChart(opts.mapToChart) ?? null;
    if (!chart) throw new Error(`Thread chart "${opts.mapToChart}" is not loaded yet.`);
  }
  let ids: Id[] = [];
  exec('Import SVG', (d) => {
    ids = applySvgImport(d, result, {
      replaceArtwork: opts.replaceArtwork,
      chart,
      name: opts.name ?? result.name,
    });
  });
  // Select after the recipe ran (ids are only known then); undo restores the previous selection.
  if (ids.length) useUi.getState().setSelection({ shapeIds: ids, elementIds: [], nodes: [] });
  return ids;
}
