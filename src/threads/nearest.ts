// SPDX-License-Identifier: GPL-3.0-or-later
/** Nearest-thread lookup by CIEDE2000, with a Lab cache keyed by hex colour. */
import { deltaE2000, hexToLab, type Lab } from './color';

export interface HasColor {
  /** `#rrggbb` (any case; `#rgb` accepted). */
  color: string;
}

export interface NearestResult {
  /** Index into `candidates`, or -1 when there are none. */
  index: number;
  /** ΔE2000 to that candidate (Infinity when there are none). */
  deltaE: number;
}

const LAB_CACHE_MAX = 50_000;
const labCache = new Map<string, Lab>();

/** `hexToLab` memoised by hex string (charts are reused across many lookups). */
export function labOf(hex: string): Lab {
  let lab = labCache.get(hex);
  if (!lab) {
    if (labCache.size >= LAB_CACHE_MAX) labCache.clear();
    lab = hexToLab(hex);
    labCache.set(hex, lab);
  }
  return lab;
}

/**
 * Nearest candidate to `color` by ΔE2000. Ties go to the lowest index.
 * `color` is a hex string or a Lab triple.
 */
export function nearestThread(color: string | Lab, candidates: readonly HasColor[]): NearestResult {
  const target = typeof color === 'string' ? labOf(color) : color;
  let index = -1;
  let deltaE = Infinity;
  for (let i = 0; i < candidates.length; i++) {
    const d = deltaE2000(target, labOf(candidates[i].color));
    if (d < deltaE) {
      deltaE = d;
      index = i;
    }
  }
  return { index, deltaE };
}

export interface ColorMatch<T extends HasColor> {
  /** The input colour. */
  color: string;
  /** Matched thread, or null when the chart is empty. */
  thread: T | null;
  index: number;
  deltaE: number;
}

/**
 * Map each colour to its nearest thread in a chart (`{ threads }`) or a plain
 * candidate list (e.g. My threads). Result is parallel to `colors`.
 */
export function mapColorsToChart<T extends HasColor>(
  colors: readonly string[],
  chart: { threads: readonly T[] } | readonly T[],
): ColorMatch<T>[] {
  const threads: readonly T[] = isList(chart) ? chart : chart.threads;
  const memo = new Map<string, NearestResult>();
  return colors.map((color) => {
    let r = memo.get(color);
    if (!r) {
      r = nearestThread(color, threads);
      memo.set(color, r);
    }
    return { color, thread: r.index >= 0 ? threads[r.index] : null, index: r.index, deltaE: r.deltaE };
  });
}

function isList<T>(c: { threads: readonly T[] } | readonly T[]): c is readonly T[] {
  return Array.isArray(c);
}
