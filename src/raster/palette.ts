// SPDX-License-Identifier: GPL-3.0-or-later
/** User palette edits (merge, recolour, don't stitch) applied as a cheap label remap (§12.1 step 4). */
import type { PaletteEdit } from '@/model/types';
import { normalizeHex } from '@/threads/color';

export interface ResolvedPalette {
  /** Original palette index → final index (the merge root). */
  remap: Uint8Array;
  /** Final colour per index (only meaningful for roots). */
  colors: string[];
  /** Skip flag per index (only meaningful for roots). */
  skip: boolean[];
}

export function resolvePalette(
  baseColors: string[],
  edits: PaletteEdit[],
  backgroundIndex: number | null,
): ResolvedPalette {
  const K = baseColors.length;
  const byIndex = new Map<number, PaletteEdit>();
  for (const e of edits) {
    if (Number.isInteger(e.index) && e.index >= 0 && e.index < K) {
      byIndex.set(e.index, { ...byIndex.get(e.index), ...e });
    }
  }
  const remap = new Uint8Array(K);
  for (let i = 0; i < K; i++) {
    let cur = i;
    const path = [i];
    for (;;) {
      const m = byIndex.get(cur)?.mergeInto;
      if (m === undefined || !Number.isInteger(m) || m < 0 || m >= K || m === cur) break;
      const at = path.indexOf(m);
      if (at >= 0) {
        // Cycle: every member resolves to the smallest index in the cycle.
        cur = Math.min(...path.slice(at));
        break;
      }
      path.push(m);
      cur = m;
    }
    remap[i] = cur;
  }
  const colors = baseColors.map((c, i) => {
    const e = byIndex.get(i);
    if (e?.color && /^#?[0-9a-f]{3}([0-9a-f]{3})?$/i.test(e.color)) return normalizeHex(e.color);
    return c;
  });
  const skip = baseColors.map((_, i) => byIndex.get(i)?.skip ?? i === backgroundIndex);
  return { remap, colors, skip };
}

/** Apply a label remap. */
export function remapLabels(labels: Uint8Array, remap: Uint8Array): Uint8Array {
  const out = new Uint8Array(labels.length);
  for (let i = 0; i < labels.length; i++) out[i] = remap[labels[i]];
  return out;
}
