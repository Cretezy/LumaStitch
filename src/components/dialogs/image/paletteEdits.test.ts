// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import type { PaletteEntry } from '@/raster/types';
import { mergeInto, patchEdit, recolourPreview, setStitched, swatchViews, unmerge } from './paletteEdits';

const palette: PaletteEntry[] = [
  { color: '#ffffff', pixelShare: 0.5 },
  { color: '#ff0000', pixelShare: 0.3 },
  { color: '#0000ff', pixelShare: 0.15 },
  { color: '#000000', pixelShare: 0.05 },
];

describe('palette edits', () => {
  it('patchEdit sets and clears fields, dropping empty edits', () => {
    let e = patchEdit([], 2, { color: '#00ff00' });
    expect(e).toEqual([{ index: 2, color: '#00ff00' }]);
    e = patchEdit(e, 2, { skip: true });
    expect(e).toEqual([{ index: 2, color: '#00ff00', skip: true }]);
    e = patchEdit(patchEdit(e, 2, { color: null }), 2, { skip: null });
    expect(e).toEqual([]);
  });

  it('background is skipped by default; toggling stores only the difference', () => {
    const bg = 0;
    expect(swatchViews(palette, [], bg).views[0]).toMatchObject({ isBackground: true, stitched: false });
    const on = setStitched([], 0, true, bg);
    expect(on).toEqual([{ index: 0, skip: false }]);
    expect(swatchViews(palette, on, bg).views[0].stitched).toBe(true);
    expect(setStitched(on, 0, false, bg)).toEqual([]);
    expect(setStitched([], 1, false, bg)).toEqual([{ index: 1, skip: true }]);
  });

  it('merges into the target root, re-points children and sums shares', () => {
    let { resolved } = swatchViews(palette, [], null);
    let e = mergeInto([], 3, 2, resolved); // black → blue
    resolved = swatchViews(palette, e, null).resolved;
    e = mergeInto(e, 2, 1, resolved); // blue (+black) → red
    const { views } = swatchViews(palette, e, null);
    expect(views[3]).toMatchObject({ merged: true, root: 1, color: '#ff0000' });
    expect(views[2]).toMatchObject({ merged: true, root: 1 });
    expect(views[1].share).toBeCloseTo(0.5);
    expect(e.find((x) => x.index === 3)?.mergeInto).toBe(1);
    expect(swatchViews(palette, unmerge(e, 2), null).views[2].merged).toBe(false);
  });

  it('recolourPreview applies merges, recolours and skips', () => {
    const rgba = new Uint8ClampedArray([255, 255, 255, 255, 255, 0, 0, 255, 0, 0, 0, 255]);
    const e = patchEdit(mergeInto([], 3, 1, swatchViews(palette, [], 0).resolved), 1, { color: '#00ff00' });
    const out = recolourPreview(rgba, palette, swatchViews(palette, e, 0).resolved);
    expect([...out]).toEqual([0, 0, 0, 0, 0, 255, 0, 255, 0, 255, 0, 255]);
  });
});
