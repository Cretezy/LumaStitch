// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * "Import image" command — the main-thread hand-off of the image digitizer (SPEC FR-10.5, FR-10.7,
 * §9.1 step 9; ARCHITECTURE §12.1 step 8).
 *
 * One exec('Import image') that:
 *   - creates threads for the traced colours (exact colours; an existing thread with the same colour
 *     is reused);
 *   - adds one shape per traced shape, in trace order (zOrder + sequence = fill, then outline):
 *       closed cutout → tatami fill with `{ cutoutGrowth: 0.4 }` (ARCH §12.1 "Cutout growth"),
 *       line-art centreline → open path, `art.stroke` + `strokeWidth`, and a running / triple / satin
 *       outline by width (SPEC §9 step 4);
 *     named after the dialog's swatch number: "Colour 2", "Colour 2 (part 2)", "Colour 4 line", …;
 *   - sets `design.artwork` to the image backdrop with its TraceSettings (reproducible re-trace);
 *   - FR-10.7 re-trace: with `replaceShapeIds`, deletes those shapes (and their sequence entries, and
 *     threads only they used) in the same step. The new shapes take the old shapes' place in
 *     `zOrder` and `sequence`.
 *
 * Which shapes a re-trace replaces (`tracedShapeIds`): the artwork type is fixed and has no room
 * for shape ids, so traced shapes are recognised from what an image import (and an image
 * auto-digitize, which passes `cutoutGrowth`) leaves on them:
 *   1. a fill element with `params.cutoutGrowth > 0` — only the image digitizer sets this; or
 *   2. a shape still named like a traced shape ("Colour N", "Colour N (part k)", "Colour N line…"),
 *      which covers line-art outlines and fills that auto-digitize turned into centreline runs.
 * Shapes the user renamed and whose fill lost its cutout growth are kept.
 */
import type { Draft } from 'immer';
import { AUTO } from '@/engine/autodigitize/config';
import { createElement, createShape, hasClosedSubpath } from '@/model/factories';
import type {
  Artwork,
  Design,
  Id,
  Matrix,
  ParamValue,
  SequenceEntry,
  Shape,
  StitchType,
  TraceSettings,
} from '@/model/types';
import type { TracedShape, TracedShapes } from '@/raster/types';
import { exec, useDoc } from '../documentStore';
import { useUi } from '../uiStore';
import { ThreadResolver, baseFileName, isUntitledName } from './importSvg';

/** Overlap margin used by the image digitizer's cutout growth (SPEC §9 step 3, ARCH §12.1). */
export const IMAGE_CUTOUT_GROWTH = AUTO.overlapMargin;
/** Backdrop opacity of a freshly imported image. */
export const IMAGE_BACKDROP_OPACITY = 0.35;

export interface ImageArtworkInput {
  /** The image as a data URL (possibly downscaled; `pxWidth`/`pxHeight` are of this image). */
  dataUrl: string;
  pxWidth: number;
  pxHeight: number;
  /** px → mm. See `imageBackdropMatrix`. */
  matrix: Matrix;
  trace: TraceSettings;
}

export interface ApplyImageImportOptions {
  /** FR-10.7: shapes to delete in the same step (the previous trace). */
  replaceShapeIds?: Id[];
  /** Name for an "Untitled" design (file name). */
  name?: string;
}

/**
 * Backdrop matrix: image px → design mm, image centred on `centre` (default: the origin), with
 * mm per px = widthMm / pxWidth (and heightMm / pxHeight vertically).
 */
export function imageBackdropMatrix(
  pxWidth: number,
  pxHeight: number,
  widthMm: number,
  heightMm: number,
  centre: [number, number] = [0, 0],
): Matrix {
  const sx = widthMm / Math.max(1, pxWidth);
  const sy = heightMm / Math.max(1, pxHeight);
  return [sx, 0, 0, sy, centre[0] - widthMm / 2, centre[1] - heightMm / 2];
}

/** Outline element for a stroke of width `w` mm (SPEC §9 step 4; wider than max satin → clamped satin). */
export function outlineForStrokeWidth(w: number): { type: StitchType; params: Record<string, ParamValue> } {
  if (!(w >= AUTO.runningMaxWidth)) return { type: 'running', params: {} };
  if (w < AUTO.tripleMaxWidth) return { type: 'triple', params: {} };
  const width = Math.min(w, AUTO.maxSatinWidth);
  return { type: 'satin', params: { width: Math.round(width * 100) / 100 } };
}

const TRACED_NAME = /^Colour \d+( line)?( \(part \d+\))?$/;

/** True when a shape looks like the output of an image trace (see the module comment). */
export function isTracedShape(s: Shape): boolean {
  const g = s.fill?.params.cutoutGrowth;
  if (typeof g === 'number' && g > 0) return true;
  return TRACED_NAME.test(s.name);
}

/** Shapes a re-trace replaces, in zOrder. */
export function tracedShapeIds(design: Design): Id[] {
  return design.zOrder.filter((id) => {
    const s = design.shapes[id];
    return !!s && isTracedShape(s);
  });
}

/** Removes shapes, their sequence entries and threads that only they used. Returns insert positions. */
function removeShapes(d: Design | Draft<Design>, ids: Id[]): { zAt: number; seqAt: number } {
  const set = new Set(ids.filter((id) => d.shapes[id]));
  if (!set.size) return { zAt: -1, seqAt: -1 };
  const removedEls = new Set<Id>();
  const candidateThreads = new Set<Id>();
  for (const id of set) {
    const s = d.shapes[id];
    for (const el of [s.fill, s.outline]) {
      if (!el) continue;
      removedEls.add(el.id);
      candidateThreads.add(el.threadId);
    }
    delete d.shapes[id];
  }
  const zAt = d.zOrder.findIndex((id) => set.has(id));
  d.zOrder = d.zOrder.filter((id) => !set.has(id));
  // Everything before the first removed entry survives, so these are also the insert positions.
  const seqAt = d.sequence.findIndex((e) => e.kind === 'element' && removedEls.has(e.elementId));
  d.sequence = d.sequence.filter((e) => e.kind === 'stop' || !removedEls.has(e.elementId));
  // Drop threads that are now unused (only those the removed shapes referenced).
  const used = new Set<Id>();
  for (const s of Object.values(d.shapes)) {
    if (s.fill) used.add(s.fill.threadId);
    if (s.outline) used.add(s.outline.threadId);
  }
  for (const t of candidateThreads) if (!used.has(t)) delete d.threads[t];
  return { zAt, seqAt };
}

/**
 * Shape names: "Colour N" with N = palette index + 1 (the swatch number shown in the import dialog),
 * " line" for line-art centrelines, "(part k)" for further parts of the same colour.
 */
function nameShapes(shapes: TracedShape[]): string[] {
  const byColour = new Map<string, number>();
  const parts = new Map<string, number>();
  return shapes.map((t) => {
    let n = Number.isInteger(t.paletteIndex) && t.paletteIndex >= 0 ? t.paletteIndex + 1 : undefined;
    if (n === undefined) {
      const key = t.color.toLowerCase();
      n = byColour.get(key) ?? 100 + byColour.size + 1;
      byColour.set(key, n);
    }
    const base = `Colour ${n}${t.lineArt ? ' line' : ''}`;
    const k = (parts.get(base) ?? 0) + 1;
    parts.set(base, k);
    return k === 1 ? base : `${base} (part ${k})`;
  });
}

/**
 * Pure draft mutation for an image import / re-trace. Returns the new shape ids (trace order).
 * Empty traced shapes (no subpaths) are skipped.
 */
export function applyImageImport(
  d: Design | Draft<Design>,
  traced: Pick<TracedShapes, 'shapes'>,
  artwork: ImageArtworkInput,
  opts: ApplyImageImportOptions = {},
): Id[] {
  const { zAt, seqAt } = opts.replaceShapeIds?.length
    ? removeShapes(d, opts.replaceShapeIds)
    : { zAt: -1, seqAt: -1 };
  const resolver = new ThreadResolver(d);
  const valid = traced.shapes.filter((t) => t.geom.subpaths.some((sp) => sp.nodes.length >= 2));
  const names = nameShapes(valid);
  const newShapes: Shape[] = [];
  valid.forEach((t, i) => {
    const color = t.color.toLowerCase();
    const threadId = resolver.resolve(color);
    const geom = structuredClone(t.geom);
    if (t.lineArt) {
      const w = t.strokeWidth ?? AUTO.runningMaxWidth / 2;
      const shape = createShape(names[i], geom, { stroke: color, strokeWidth: Math.round(w * 1000) / 1000 });
      const o = outlineForStrokeWidth(w);
      shape.outline = createElement('outline', o.type, threadId, o.params);
      newShapes.push(shape);
    } else {
      const shape = createShape(names[i], geom, { fill: color });
      if (hasClosedSubpath(geom)) {
        shape.fill = createElement('fill', 'tatami', threadId, { cutoutGrowth: IMAGE_CUTOUT_GROWTH });
      } else {
        // Degenerate (open) trace output: keep it visible as a running outline.
        shape.art = { stroke: color, strokeWidth: AUTO.runningMaxWidth / 2 };
        shape.outline = createElement('outline', 'running', threadId);
      }
      newShapes.push(shape);
    }
  });

  const zIds = newShapes.map((s) => s.id);
  const entries: SequenceEntry[] = [];
  for (const s of newShapes) {
    d.shapes[s.id] = s;
    if (s.fill) entries.push({ kind: 'element', elementId: s.fill.id });
    if (s.outline) entries.push({ kind: 'element', elementId: s.outline.id });
  }
  if (zAt >= 0) d.zOrder.splice(Math.min(zAt, d.zOrder.length), 0, ...zIds);
  else d.zOrder.push(...zIds);
  if (seqAt >= 0) d.sequence.splice(Math.min(seqAt, d.sequence.length), 0, ...entries);
  else d.sequence.push(...entries);

  const art: Artwork = {
    kind: 'image',
    dataUrl: artwork.dataUrl,
    pxWidth: artwork.pxWidth,
    pxHeight: artwork.pxHeight,
    matrix: [...artwork.matrix] as Matrix,
    visible: true,
    opacity: IMAGE_BACKDROP_OPACITY,
    trace: structuredClone(artwork.trace),
  };
  d.artwork = art;
  if (opts.name && isUntitledName(d.name)) d.name = baseFileName(opts.name) || d.name;
  return zIds;
}

/**
 * Commits a traced image to the open design as one undo step ("Import image", or "Re-trace image"
 * when replacing) and selects the new shapes. Returns the new shape ids.
 */
export function importTracedImage(
  traced: TracedShapes,
  artwork: ImageArtworkInput,
  opts: ApplyImageImportOptions = {},
): Id[] {
  let ids: Id[] = [];
  exec(opts.replaceShapeIds?.length ? 'Re-trace image' : 'Import image', (d) => {
    ids = applyImageImport(d, traced, artwork, opts);
  });
  useUi.getState().setSelection({ shapeIds: ids, elementIds: [], nodes: [] });
  return ids;
}

/** True when the open design has an image backdrop that can be re-traced (FR-10.7). */
export function canRetrace(design: Design | null = useDoc.getState().design): boolean {
  return design?.artwork?.kind === 'image';
}

/**
 * Opens the image import dialog prefilled from the design's image backdrop, in replace mode
 * (FR-10.7). Returns false (and shows a toast) when there is no image backdrop.
 */
export function openRetrace(): boolean {
  const ui = useUi.getState();
  if (!canRetrace()) {
    ui.showToast('There is no imported image to re-trace.', 'info');
    return false;
  }
  ui.set({ pendingFile: null });
  ui.openDialog('imageImport', { retrace: true });
  return true;
}
