// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Auto-digitize (SPEC §9, ARCHITECTURE §12): colours → overlap removal → stroke conversion →
 * classification (worker) → sequence optimisation → one undoable commit + summary.
 */
import { produce, type Draft } from 'immer';
import { AUTO } from '@/engine/autodigitize/config';
import type { AnalyzeShapeInput, ShapeDecision } from '@/engine/autodigitize/classify';
import { optimizeSequence } from '@/engine/sequence/optimize';
import { difference, makeValid, offset, offsetClosedStroke, offsetPolylines, unionAll } from '@/geom/clipper';
import { flattenGeom } from '@/geom/flatten';
import { booleanGeoms, simplifyGeom, splitSubpaths } from '@/geom/paperAdapter';
import { bboxIntersects, polyShapeArea, polyShapeBBox } from '@/geom/polygon';
import type { BBox, PolyShape } from '@/geom/types';
import { newId } from '@/lib/ids';
import { createElement, hasClosedSubpath } from '@/model/factories';
import { polyShapeToGeom } from '@/model/geomOps';
import type { Design, FabricId, Id, PathGeom, Shape, StitchElement, Thread } from '@/model/types';
import { getChart } from '@/threads/charts';
import { reduceColors } from '@/threads/kmeans';
import { nearestThread } from '@/threads/nearest';
import { normalizeHex } from '@/threads/color';
import { loadMyThreads } from '@/library/myThreads';
import { getPref, setPref } from '@/library/library';
import { engine } from '@/worker/engineClient';
import { analyzeShapes } from '@/engine/autodigitize/classify';
import { exec, useDoc } from '../documentStore';
import { useUi } from '../uiStore';

export interface AutoDigitizeOptions {
  fabric: FabricId;
  /** 'exact' keeps imported colours; 'chart' maps to `chartId`; 'myThreads' maps to the user's palette. */
  colors: 'exact' | 'chart' | 'myThreads';
  chartId?: string;
  /** 0 = no limit. */
  maxColors: number;
  removeOverlaps: boolean;
  /** mm */
  minDetail: number;
  outlines: 'auto' | 'running' | 'triple' | 'satin' | 'none';
  /** Leave elements the user edited by hand alone (P1). */
  keepEdits: boolean;
  /** Image digitizer hand-off: grow cutouts under later regions by this much (mm). */
  cutoutGrowth?: number;
  /** Restrict to these shapes (default: selection if any, else all). */
  shapeIds?: Id[];
}

export interface AutoDigitizeSummary {
  fills: number;
  satins: number;
  runs: number;
  colors: number;
  dropped: number;
  droppedIds: Id[];
  message: string;
}

export const DEFAULT_AUTO_OPTIONS: AutoDigitizeOptions = {
  fabric: 'woven',
  colors: 'exact',
  maxColors: 0,
  removeOverlaps: true,
  minDetail: 0.8,
  outlines: 'auto',
  keepEdits: false,
};

export async function loadAutoOptions(): Promise<AutoDigitizeOptions> {
  const saved = (await getPref<Partial<AutoDigitizeOptions>>('autoDigitizeOptions')) ?? {};
  const fabric = useDoc.getState().design?.fabric ?? saved.fabric ?? 'woven';
  return { ...DEFAULT_AUTO_OPTIONS, ...saved, fabric, shapeIds: undefined, cutoutGrowth: undefined };
}

interface Region {
  /** Source shape id (results replace it). */
  sourceId: Id;
  id: Id;
  name: string;
  geom: PathGeom;
  fillColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
  isNew: boolean;
  /** Carries only the source shape's stroke (its fill was clipped or split). */
  outlineOnly?: boolean;
  /** A stroke wider than satin, converted to a fill. */
  strokeFill?: boolean;
}

function shapePoly(s: Shape): PolyShape {
  return makeValid(flattenGeom(s.geom).rings, s.geom.fillRule);
}

/** Colour of the fill/stroke as auto-digitize sees it: original paint, else the current thread colour. */
function paintColors(d: Design, s: Shape): { fill?: string; stroke?: string; strokeWidth?: number } {
  const fill = s.art.fill ?? (s.fill ? d.threads[s.fill.threadId]?.color : undefined);
  const strokeW =
    s.art.strokeWidth ??
    (s.outline && typeof s.outline.params.width === 'number'
      ? (s.outline.params.width as number)
      : s.outline
        ? 0.4
        : undefined);
  const stroke = s.art.stroke ?? (s.outline ? d.threads[s.outline.threadId]?.color : undefined);
  return {
    fill: fill && hasClosedSubpath(s.geom) ? normalizeHex(fill) : undefined,
    stroke: stroke && strokeW ? normalizeHex(stroke) : undefined,
    strokeWidth: stroke ? strokeW : undefined,
  };
}

async function colorMapping(
  colors: { color: string; weight: number }[],
  opts: AutoDigitizeOptions,
): Promise<Map<string, Omit<Thread, 'id'>>> {
  const out = new Map<string, Omit<Thread, 'id'>>();
  if (!colors.length) return out;
  const max = opts.maxColors > 0 ? opts.maxColors : Infinity;
  const red = reduceColors(colors, max, { threshold: AUTO.mergeDeltaE });
  let candidates: { color: string; name: string; code?: string; chart?: string }[] | null = null;
  if (opts.colors === 'chart' && opts.chartId) {
    const chart = await getChart(opts.chartId);
    candidates = chart.threads.map((t) => ({ color: t.color, name: t.name, code: t.code, chart: chart.id }));
  } else if (opts.colors === 'myThreads') {
    const mine = await loadMyThreads();
    if (mine.threads.length)
      candidates = mine.threads.map((t) => ({ color: t.color, name: t.name, code: t.code, chart: t.chart }));
  }
  red.clusters.forEach((c, ci) => {
    // Exact mode keeps a real imported colour (the dominant member) rather than the mean.
    const exact = colors[c.dominant]?.color ?? c.color;
    let thread: Omit<Thread, 'id'> = { name: exact.toUpperCase(), color: exact };
    if (candidates?.length) {
      const n = nearestThread(c.color, candidates);
      const t = candidates[n.index];
      thread = { name: t.name, color: t.color, code: t.code, chart: t.chart };
    }
    red.mapping.forEach((m, i) => {
      if (m === ci) out.set(colors[i].color, thread);
    });
  });
  return out;
}

/** Runs the analysis in the engine worker, falling back to the main thread (e.g. tests). */
async function analyze(shapes: AnalyzeShapeInput[], opts: AutoDigitizeOptions): Promise<ShapeDecision[]> {
  const options = { minDetail: opts.minDetail, maxSatinWidth: AUTO.maxSatinWidth, outlines: opts.outlines };
  try {
    if (typeof Worker !== 'undefined') return (await engine().analyze({ shapes, options })).decisions;
  } catch (err) {
    console.warn('analyze in worker failed, running on main thread', err);
  }
  return analyzeShapes(shapes, options).decisions;
}

let running = false;

export async function autoDigitize(
  partial: Partial<AutoDigitizeOptions> = {},
): Promise<AutoDigitizeSummary | null> {
  if (running) {
    useUi.getState().showToast('Auto-digitize is already running.');
    return null;
  }
  running = true;
  try {
    return await run(partial);
  } finally {
    running = false;
  }
}

async function run(partial: Partial<AutoDigitizeOptions>): Promise<AutoDigitizeSummary | null> {
  const { design, designId, revision: startRevision } = useDoc.getState();
  if (!design) return null;
  const opts: AutoDigitizeOptions = { ...(await loadAutoOptions()), ...partial };
  if (!partial.shapeIds) {
    const { shapeIds, cutoutGrowth, ...persist } = opts;
    void shapeIds;
    void cutoutGrowth;
    await setPref('autoDigitizeOptions', persist);
  }
  const sel = useUi.getState().selection.shapeIds;
  const wanted = new Set(opts.shapeIds ?? (sel.length ? sel : design.zOrder));
  let targetIds = design.zOrder.filter(
    (id) => wanted.has(id) && !design.shapes[id].hidden && !design.shapes[id].locked,
  );
  if (opts.keepEdits)
    targetIds = targetIds.filter(
      (id) => !(design.shapes[id].fill?.userEdited || design.shapes[id].outline?.userEdited),
    );
  if (!targetIds.length) {
    useUi.getState().showToast('Nothing to auto-digitize.');
    return null;
  }
  const targetSet = new Set(targetIds);
  const zIndex = new Map(design.zOrder.map((id, i) => [id, i]));

  // 1. Normalise + paint.
  const paints = new Map(targetIds.map((id) => [id, paintColors(design, design.shapes[id])]));
  /** Tiny details left as artwork-only shapes (selectable from the summary). */
  const dropped = new Set<Id>();
  let droppedLeftovers = 0;
  /** Fills completely hidden under other fills (removed). */
  let hiddenRemoved = 0;

  // 2. Colours.
  const colorWeights = new Map<string, number>();
  for (const id of targetIds) {
    const p = paints.get(id)!;
    const s = design.shapes[id];
    if (p.fill)
      colorWeights.set(p.fill, (colorWeights.get(p.fill) ?? 0) + Math.max(1, polyShapeArea(shapePoly(s))));
    if (p.stroke) colorWeights.set(p.stroke, (colorWeights.get(p.stroke) ?? 0) + 10 * (p.strokeWidth ?? 1));
  }
  const mapping = await colorMapping(
    [...colorWeights].map(([color, weight]) => ({ color, weight })),
    opts,
  );

  // 3. Regions: overlap removal (bottom → top). Strokes are never subtracted: they keep the shape's
  //    original geometry, on the main region when the fill is unchanged, else on an outline-only shape.
  const regions: Region[] = [];
  const polyCache = new Map<Id, { poly: PolyShape; bbox: BBox }>();
  const polyOf = (id: Id) => {
    let v = polyCache.get(id);
    if (!v) {
      const poly = shapePoly(design.shapes[id]);
      v = { poly, bbox: polyShapeBBox(poly) };
      polyCache.set(id, v);
    }
    return v;
  };
  const isFillShape = (id: Id) => {
    const s = design.shapes[id];
    return !s.hidden && (targetSet.has(id) ? !!paints.get(id)!.fill : !!s.fill);
  };
  const minArea = Math.max(AUTO.minLeftoverArea, opts.minDetail * opts.minDetail);
  let lastYield = performance.now();
  for (const id of targetIds) {
    // Long main-thread step: yield regularly so the UI stays responsive.
    if (performance.now() - lastYield > 30) {
      await new Promise((r) => setTimeout(r, 0));
      lastYield = performance.now();
    }
    const zi = zIndex.get(id)!;
    const s = design.shapes[id];
    const p = paints.get(id)!;
    let parts: PathGeom[] = p.fill ? [s.geom] : [];
    let clipped = false;
    if (p.fill && opts.removeOverlaps) {
      const mine = polyOf(id);
      const above: PolyShape[] = [];
      for (let zj = zi + 1; zj < design.zOrder.length; zj++) {
        const other = design.zOrder[zj];
        if (!isFillShape(other)) continue;
        const o = polyOf(other);
        if (bboxIntersects(mine.bbox, o.bbox)) above.push(o.poly);
      }
      if (above.length) {
        const cut = offset(unionAll(above), -AUTO.overlapMargin);
        // Quick check with Clipper: anything removed at all?
        const rest = difference(mine.poly, cut);
        if (Math.abs(polyShapeArea(rest) - polyShapeArea(mine.poly)) > 1e-3) {
          clipped = true;
          let geoms: PathGeom[];
          if (!rest.length) geoms = [];
          else {
            try {
              // Paper keeps the shape's own curves; the cut edge follows the inset polygons.
              geoms = booleanGeoms('subtract', [s.geom, polyShapeToGeom(cut)]);
            } catch {
              geoms = [polyShapeToGeom(rest)];
            }
          }
          // Disconnected leftovers become separate parts; tiny ones are dropped and reported.
          parts = [];
          for (const g of geoms)
            for (const part of g.subpaths.length > 1 ? splitSubpaths(g) : [g]) {
              const a = polyShapeArea(makeValid(flattenGeom(part).rings, part.fillRule));
              if (a < minArea) droppedLeftovers++;
              else parts.push(part);
            }
          if (!parts.length) hiddenRemoved++;
        }
      }
    }
    // The stroke rides on the main fill region only when that region is the untouched shape.
    const strokeOnMain = !!p.stroke && !clipped && parts.length > 0;
    parts.forEach((g, i) => {
      regions.push({
        sourceId: id,
        id: i === 0 ? id : newId('s'),
        name: i === 0 ? s.name : `${s.name} (part ${i + 1})`,
        geom: g,
        fillColor: p.fill,
        strokeColor: i === 0 && strokeOnMain ? p.stroke : undefined,
        strokeWidth: i === 0 && strokeOnMain ? p.strokeWidth : undefined,
        isNew: i > 0,
      });
    });
    if (p.stroke && !strokeOnMain) {
      const reuse = parts.length === 0;
      regions.push({
        sourceId: id,
        id: reuse ? id : newId('s'),
        name: reuse ? s.name : `${s.name} (outline)`,
        geom: s.geom,
        strokeColor: p.stroke,
        strokeWidth: p.strokeWidth,
        isNew: !reuse,
        outlineOnly: true,
      });
    }
  }
  // Wide strokes (> max satin) become filled shapes of their own.
  if (opts.outlines === 'auto' || opts.outlines === 'satin') {
    const strokeFills: Region[] = [];
    for (const r of regions) {
      if (!r.strokeColor || !r.strokeWidth || r.strokeWidth <= AUTO.maxSatinWidth) continue;
      const flat = flattenGeom(r.geom);
      let poly = offsetPolylines(flat.polylines, r.strokeWidth / 2, 'round', 'round');
      if (flat.rings.length) poly = [...poly, ...offsetClosedStroke(flat.rings, r.strokeWidth / 2)];
      poly = makeValid(
        poly.flatMap((pp) => [pp.outer, ...pp.holes]),
        'nonzero',
      );
      if (poly.length) {
        strokeFills.push({
          sourceId: r.sourceId,
          id: newId('s'),
          name: `${design.shapes[r.sourceId].name} (stroke)`,
          geom: simplifyGeom(polyShapeToGeom(poly), 0.05),
          fillColor: r.strokeColor,
          isNew: true,
          strokeFill: true,
        });
      }
      r.strokeColor = undefined;
      r.strokeWidth = undefined;
    }
    regions.push(...strokeFills);
  }

  // 4–6. Classification (worker).
  const decisions = await analyze(
    regions.map((r) => ({
      id: r.id,
      geom: r.geom,
      hasFill: !!r.fillColor && hasClosedSubpath(r.geom),
      hasStroke: !!r.strokeColor,
      strokeWidth: r.strokeWidth,
    })),
    opts,
  );
  const decisionById = new Map(decisions.map((d) => [d.id, d]));

  // Build the next design (not yet committed).
  let fills = 0,
    satins = 0,
    runs = 0;
  const threadsBefore = new Set<Id>();
  for (const id of targetIds)
    for (const el of [design.shapes[id].fill, design.shapes[id].outline])
      if (el) threadsBefore.add(el.threadId);
  const next = produce(design, (d: Draft<Design>) => {
    d.fabric = opts.fabric;
    // Threads from the colour mapping (reuse identical threads).
    const threadFor = (color: string): Id => {
      const t = mapping.get(color) ?? { name: color.toUpperCase(), color };
      const existing = Object.values(d.threads).find(
        (x) =>
          x.color === t.color && (x.code ?? '') === (t.code ?? '') && (x.chart ?? '') === (t.chart ?? ''),
      );
      if (existing) return existing.id;
      const nt: Thread = { id: newId('t'), ...t };
      d.threads[nt.id] = nt;
      return nt.id;
    };
    const oldElementIds = new Set<Id>();
    for (const id of targetIds) {
      const s = d.shapes[id];
      if (s.fill) oldElementIds.add(s.fill.id);
      if (s.outline) oldElementIds.add(s.outline.id);
    }
    const prevShapes = d.shapes;
    const shapes: Record<Id, Shape> = {};
    for (const zid of d.zOrder) if (!targetSet.has(zid)) shapes[zid] = prevShapes[zid] as Shape;
    /** Extra shapes created during apply (an outline kept beside a centreline run), keyed by region. */
    const extras = new Map<Id, Id>();
    for (const r of regions) {
      const dec = decisionById.get(r.id);
      const src = prevShapes[r.sourceId] as Shape;
      const mk = (
        role: 'fill' | 'outline',
        old: StitchElement | null,
        type: StitchElement['type'],
        params: StitchElement['params'],
        color: string,
        reuse: boolean,
      ): StitchElement => {
        const el = createElement(role, type, threadFor(color), { ...params });
        if (old && reuse) {
          el.id = old.id;
          el.tieIn = old.tieIn;
          el.tieOut = old.tieOut;
          el.trimAfter = old.trimAfter;
        }
        if (role === 'fill' && opts.cutoutGrowth && opts.cutoutGrowth > 0)
          el.params.cutoutGrowth = opts.cutoutGrowth;
        // Traced image regions keep their cutout overlap when auto-digitize is re-run.
        else if (
          role === 'fill' &&
          opts.cutoutGrowth === undefined &&
          typeof old?.params.cutoutGrowth === 'number' &&
          old.params.cutoutGrowth > 0
        )
          el.params.cutoutGrowth = old.params.cutoutGrowth;
        return el;
      };
      const reuseIds = !r.isNew;
      let geom = r.geom;
      let art = { ...src.art };
      let fill: StitchElement | null = null;
      let outline: StitchElement | null;
      const strokeOutline = () => {
        if (!dec?.outline || !r.strokeColor) return null;
        if (dec.outline.type === 'satin') satins++;
        else runs++;
        return mk('outline', src.outline, dec.outline.type, dec.outline.params, r.strokeColor, reuseIds);
      };
      if (dec?.centerline && r.fillColor) {
        // A thin fill is sewn as a run along its centreline; the shape's own stroke stays on its geometry.
        geom = dec.centerline;
        art = { stroke: r.fillColor, strokeWidth: dec.maxWidth };
        outline = mk('outline', null, 'running', {}, r.fillColor, false);
        runs++;
        const keep = strokeOutline();
        if (keep) {
          const eid = newId('s');
          shapes[eid] = {
            id: eid,
            name: `${r.name} (outline)`,
            geom: r.geom,
            art: { stroke: r.strokeColor, strokeWidth: r.strokeWidth },
            fill: null,
            outline: keep,
            hidden: src.hidden,
            locked: src.locked,
          };
          extras.set(r.id, eid);
        }
      } else {
        if (dec?.fill && r.fillColor) {
          fill = mk('fill', src.fill, dec.fill.type, dec.fill.params, r.fillColor, reuseIds);
          if (dec.fill.type === 'satinFill') satins++;
          else fills++;
        }
        if (dec?.droppedFill && r.fillColor && !dec.outline) dropped.add(r.id);
        outline = strokeOutline();
      }
      if (r.strokeFill) art = { fill: r.fillColor };
      else if (r.outlineOnly)
        art = { stroke: r.strokeColor ?? src.art.stroke, strokeWidth: r.strokeWidth ?? src.art.strokeWidth };
      else if (r.isNew) art = { ...art, stroke: undefined, strokeWidth: undefined };
      // Shapes left without elements (tiny details) stay as artwork so the user can find them.
      shapes[r.id] = {
        id: r.id,
        name: r.name,
        geom,
        art,
        fill,
        outline,
        hidden: src.hidden,
        locked: src.locked,
      };
    }
    // Regions take their source's z-order slot: parts, then outline-only shapes, then stroke fills.
    const bySource = new Map<Id, Region[]>();
    for (const r of regions) bySource.set(r.sourceId, [...(bySource.get(r.sourceId) ?? []), r]);
    const rank = (r: Region) => (r.strokeFill ? 2 : r.outlineOnly ? 1 : 0);
    const newZ: Id[] = [];
    for (const zid of d.zOrder) {
      if (!targetSet.has(zid)) {
        newZ.push(zid);
        continue;
      }
      for (const r of (bySource.get(zid) ?? []).slice().sort((a, b) => rank(a) - rank(b))) {
        newZ.push(r.id);
        const extra = extras.get(r.id);
        if (extra) newZ.push(extra);
      }
    }
    d.shapes = shapes;
    d.zOrder = newZ.filter((id) => shapes[id]);
    // Sequence: drop old target elements; new ones are appended then optimised.
    const seq = d.sequence.filter((e) => e.kind === 'stop' || !oldElementIds.has(e.elementId));
    const present = new Set(
      seq.filter((e) => e.kind === 'element').map((e) => (e as { elementId: Id }).elementId),
    );
    for (const zid of d.zOrder) {
      const s = shapes[zid];
      for (const el of [s.fill, s.outline])
        if (el && !present.has(el.id)) seq.push({ kind: 'element', elementId: el.id });
    }
    d.sequence = seq;
    // Drop only threads this run orphaned (or created and then didn't use); others stay in the palette.
    const used = new Set<Id>();
    for (const s of Object.values(shapes))
      for (const el of [s.fill, s.outline]) if (el) used.add(el.threadId);
    for (const tid of Object.keys(d.threads)) {
      const created = !design.threads[tid];
      if (!used.has(tid) && (created || threadsBefore.has(tid))) delete d.threads[tid];
    }
  });

  // 7. Sequence: optimise the auto-digitized elements (whole design when everything was targeted).
  const newElementIds: Id[] = [];
  const oldIds = new Set(Object.keys(design.shapes).filter((id) => !targetSet.has(id)));
  for (const id of next.zOrder) {
    if (oldIds.has(id)) continue;
    const s = next.shapes[id];
    for (const el of [s.fill, s.outline]) if (el) newElementIds.push(el.id);
  }
  let sequence = next.sequence;
  const all = targetIds.length === design.zOrder.length;
  try {
    sequence =
      typeof Worker !== 'undefined'
        ? await engine().optimizeSequence(next, all ? {} : { elementIds: newElementIds })
        : optimizeSequence(next, all ? {} : { elementIds: newElementIds });
  } catch (err) {
    console.warn('sequence optimisation failed', err);
    sequence = optimizeSequence(next, all ? {} : { elementIds: newElementIds });
  }

  // 9. Commit as one undo step — unless the user changed or switched the design meanwhile.
  const now = useDoc.getState();
  if (now.designId !== designId || now.revision !== startRevision) {
    useUi
      .getState()
      .showToast('The design changed while auto-digitizing, so nothing was applied. Run it again.', 'error');
    return null;
  }
  exec(
    'Auto-digitize',
    (d) => {
      d.fabric = next.fabric;
      d.threads = next.threads as Draft<Design>['threads'];
      d.shapes = next.shapes as Draft<Design>['shapes'];
      d.zOrder = next.zOrder.slice();
      d.sequence = sequence;
    },
    { selection: { shapeIds: [], elementIds: [], nodes: [] } },
  );

  const colors = new Set<string>();
  for (const s of Object.values(next.shapes))
    for (const el of [s.fill, s.outline]) if (el) colors.add(next.threads[el.threadId]?.color);
  const parts = [
    `${fills} fill${fills === 1 ? '' : 's'}`,
    `${satins} satin${satins === 1 ? '' : 's'}`,
    `${runs} run${runs === 1 ? '' : 's'}`,
    `${colors.size} colour${colors.size === 1 ? '' : 's'}`,
  ];
  const droppedIds = [...dropped].filter((id) => next.shapes[id]);
  const nDropped = droppedIds.length + droppedLeftovers;
  if (nDropped) parts.push(`${nDropped} tiny detail${nDropped === 1 ? '' : 's'} dropped`);
  if (hiddenRemoved) parts.push(`${hiddenRemoved} hidden shape${hiddenRemoved === 1 ? '' : 's'} removed`);
  const summary: AutoDigitizeSummary = {
    fills,
    satins,
    runs,
    colors: colors.size,
    dropped: nDropped,
    droppedIds,
    message: parts.join(', '),
  };
  useUi.getState().showToast(`Auto-digitized: ${summary.message}.`, 'success');
  lastSummary = summary;
  return summary;
}

/** Summary of the last run (for the Issues panel / dialog link to dropped items). */
export let lastSummary: AutoDigitizeSummary | null = null;
