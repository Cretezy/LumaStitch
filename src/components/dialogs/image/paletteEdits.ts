// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Pure helpers for the image dialog's palette edits (TraceSettings.palette, SPEC FR-10.2/10.3).
 * Semantics follow `resolvePalette` in src/raster/palette.ts: merges chain to a root, colour and
 * skip apply to roots, skip defaults to "is the detected background".
 */
import type { PaletteEdit } from '@/model/types';
import { resolvePalette, type ResolvedPalette } from '@/raster/palette';
import type { PaletteEntry } from '@/raster/types';

type Patch = { mergeInto?: number | null; color?: string | null; skip?: boolean | null };

/** Sets (or with `null`, clears) fields of the edit for `index`; empty edits are dropped. */
export function patchEdit(edits: PaletteEdit[], index: number, patch: Patch): PaletteEdit[] {
  const cur: PaletteEdit = { ...(edits.find((e) => e.index === index) ?? { index }) };
  for (const k of ['mergeInto', 'color', 'skip'] as const) {
    if (!(k in patch)) continue;
    const v = patch[k];
    if (v === null || v === undefined) delete cur[k];
    else (cur as unknown as Record<string, unknown>)[k] = v;
  }
  const rest = edits.filter((e) => e.index !== index);
  const empty = cur.mergeInto === undefined && cur.color === undefined && cur.skip === undefined;
  return empty ? rest : [...rest, cur].sort((a, b) => a.index - b.index);
}

/** Stitch / don't stitch a root colour (stores nothing when equal to the background default). */
export function setStitched(
  edits: PaletteEdit[],
  index: number,
  stitched: boolean,
  backgroundIndex: number | null,
): PaletteEdit[] {
  const defaultSkip = index === backgroundIndex;
  return patchEdit(edits, index, { skip: !stitched === defaultSkip ? null : !stitched });
}

/** Merge `index` into `target`'s group. Colours merged into `index` follow it. */
export function mergeInto(
  edits: PaletteEdit[],
  index: number,
  target: number,
  resolved: ResolvedPalette,
): PaletteEdit[] {
  const root = resolved.remap[target];
  if (root === index || target === index) return edits;
  let out = patchEdit(edits, index, { mergeInto: root });
  // Re-point direct children so the chain stays one level deep.
  for (const e of edits) if (e.mergeInto === index) out = patchEdit(out, e.index, { mergeInto: root });
  return out;
}

export function unmerge(edits: PaletteEdit[], index: number): PaletteEdit[] {
  return patchEdit(edits, index, { mergeInto: null });
}

export interface SwatchView {
  index: number;
  /** Original quantised colour. */
  original: string;
  /** Effective colour (root's, after recolour). */
  color: string;
  root: number;
  merged: boolean;
  stitched: boolean;
  recoloured: boolean;
  isBackground: boolean;
  /** Pixel share including colours merged into it (roots), or own share (merged). */
  share: number;
}

export function swatchViews(
  palette: PaletteEntry[],
  edits: PaletteEdit[],
  backgroundIndex: number | null,
): { views: SwatchView[]; resolved: ResolvedPalette } {
  const resolved = resolvePalette(
    palette.map((p) => p.color),
    edits,
    backgroundIndex,
  );
  const groupShare = new Array<number>(palette.length).fill(0);
  palette.forEach((p, i) => (groupShare[resolved.remap[i]] += p.pixelShare));
  const views = palette.map((p, i): SwatchView => {
    const root = resolved.remap[i];
    const merged = root !== i;
    return {
      index: i,
      original: p.color,
      color: resolved.colors[root],
      root,
      merged,
      stitched: !resolved.skip[root],
      recoloured: !merged && resolved.colors[i].toLowerCase() !== p.color.toLowerCase(),
      isBackground: i === backgroundIndex,
      share: merged ? p.pixelShare : groupShare[i],
    };
  });
  return { views, resolved };
}

/**
 * Applies palette edits to the worker's label preview (rendered with the original palette colours):
 * merged colours take their root's colour, skipped colours become transparent.
 */
export function recolourPreview(
  rgba: Uint8ClampedArray,
  palette: PaletteEntry[],
  resolved: ResolvedPalette,
): Uint8ClampedArray<ArrayBuffer> {
  const lut = new Map<number, [number, number, number, number]>();
  palette.forEach((p, i) => {
    const key = parseInt(p.color.slice(1), 16);
    if (lut.has(key)) return;
    const root = resolved.remap[i];
    const c = parseInt(resolved.colors[root].slice(1), 16);
    lut.set(key, resolved.skip[root] ? [0, 0, 0, 0] : [(c >> 16) & 255, (c >> 8) & 255, c & 255, 255]);
  });
  const out = new Uint8ClampedArray(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    const key = (rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2];
    const v = lut.get(key);
    if (v) {
      out[i] = v[0];
      out[i + 1] = v[1];
      out[i + 2] = v[2];
      out[i + 3] = v[3];
    } else {
      out[i] = rgba[i];
      out[i + 1] = rgba[i + 1];
      out[i + 2] = rgba[i + 2];
      out[i + 3] = rgba[i + 3];
    }
  }
  return out;
}
