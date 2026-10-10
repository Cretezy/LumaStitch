// SPDX-License-Identifier: GPL-3.0-or-later
// Brother PEC thread palette and colour matching.
// Palette ported from pyembroidery's EmbThreadPec.py; `colorDistanceRedMean`,
// `findNearestIndex` and `buildUniquePalette` ported from pyembroidery's EmbThread.py
// (pyembroidery, MIT License, Copyright (c) 2018 Tatarize).
import { deltaE2000, hexToLab, parseHex, type Lab, type RGB } from '@/threads/color';
import { pyRound } from './pymath';

export interface PecThread {
  /** PEC palette index (1..64). */
  index: number;
  rgb: RGB;
  /** #rrggbb */
  color: string;
  name: string;
  /** Catalogue number as written by pyembroidery ("1".."64"). */
  code: string;
}

const RAW: [number, number, number, string][] = [
  [14, 31, 124, 'Prussian Blue'],
  [10, 85, 163, 'Blue'],
  [0, 135, 119, 'Teal Green'],
  [75, 107, 175, 'Cornflower Blue'],
  [237, 23, 31, 'Red'],
  [209, 92, 0, 'Reddish Brown'],
  [145, 54, 151, 'Magenta'],
  [228, 154, 203, 'Light Lilac'],
  [145, 95, 172, 'Lilac'],
  [158, 214, 125, 'Mint Green'],
  [232, 169, 0, 'Deep Gold'],
  [254, 186, 53, 'Orange'],
  [255, 255, 0, 'Yellow'],
  [112, 188, 31, 'Lime Green'],
  [186, 152, 0, 'Brass'],
  [168, 168, 168, 'Silver'],
  [125, 111, 0, 'Russet Brown'],
  [255, 255, 179, 'Cream Brown'],
  [79, 85, 86, 'Pewter'],
  [0, 0, 0, 'Black'],
  [11, 61, 145, 'Ultramarine'],
  [119, 1, 118, 'Royal Purple'],
  [41, 49, 51, 'Dark Gray'],
  [42, 19, 1, 'Dark Brown'],
  [246, 74, 138, 'Deep Rose'],
  [178, 118, 36, 'Light Brown'],
  [252, 187, 197, 'Salmon Pink'],
  [254, 55, 15, 'Vermilion'],
  [240, 240, 240, 'White'],
  [106, 28, 138, 'Violet'],
  [168, 221, 196, 'Seacrest'],
  [37, 132, 187, 'Sky Blue'],
  [254, 179, 67, 'Pumpkin'],
  [255, 243, 107, 'Cream Yellow'],
  [208, 166, 96, 'Khaki'],
  [209, 84, 0, 'Clay Brown'],
  [102, 186, 73, 'Leaf Green'],
  [19, 74, 70, 'Peacock Blue'],
  [135, 135, 135, 'Gray'],
  [216, 204, 198, 'Warm Gray'],
  [67, 86, 7, 'Dark Olive'],
  [253, 217, 222, 'Flesh Pink'],
  [249, 147, 188, 'Pink'],
  [0, 56, 34, 'Deep Green'],
  [178, 175, 212, 'Lavender'],
  [104, 106, 176, 'Wisteria Violet'],
  [239, 227, 185, 'Beige'],
  [247, 56, 102, 'Carmine'],
  [181, 75, 100, 'Amber Red'],
  [19, 43, 26, 'Olive Green'],
  [199, 1, 86, 'Dark Fuchsia'],
  [254, 158, 50, 'Tangerine'],
  [168, 222, 235, 'Light Blue'],
  [0, 103, 62, 'Emerald Green'],
  [78, 41, 144, 'Purple'],
  [47, 126, 32, 'Moss Green'],
  [255, 204, 204, 'Flesh Pink'],
  [255, 217, 17, 'Harvest Gold'],
  [9, 91, 166, 'Electric Blue'],
  [240, 249, 112, 'Lemon Yellow'],
  [227, 243, 91, 'Fresh Green'],
  [255, 153, 0, 'Orange'],
  [255, 240, 141, 'Cream Yellow'],
  [255, 200, 200, 'Applique'],
];

const hex2 = (v: number) => v.toString(16).padStart(2, '0');

/**
 * The PEC palette with pyembroidery's index semantics: index 0 is `null`
 * ("Unknown", never matched), indexes 1..64 are the Brother colours.
 */
export const PEC_PALETTE: readonly (PecThread | null)[] = [
  null,
  ...RAW.map(([r, g, b, name], i): PecThread => ({
    index: i + 1,
    rgb: [r, g, b],
    color: `#${hex2(r)}${hex2(g)}${hex2(b)}`,
    name,
    code: String(i + 1),
  })),
];

/** Number of entries including the unused index 0 (pyembroidery `len(get_thread_set())` = 65). */
export const PEC_PALETTE_SIZE = PEC_PALETTE.length;

let paletteLab: (Lab | null)[] | null = null;
function getPaletteLab(): (Lab | null)[] {
  if (!paletteLab) paletteLab = PEC_PALETTE.map((t) => (t ? hexToLab(t.color) : null));
  return paletteLab;
}

/** Colour difference metric. */
export type ColorMetric = 'ciede2000' | 'redmean';

/**
 * How design threads are mapped onto the 64 PEC colours:
 * - 'ciede2000' (default): nearest by CIEDE2000; distinct colours claim PEC entries in
 *   first-appearance order. This is what the export dialog previews.
 * - 'pyembroidery': pyembroidery's exact behaviour (red-mean metric, entries claimed in
 *   CPython `set()` iteration order), for byte-identical output.
 */
export type ColorMatch = 'ciede2000' | 'pyembroidery';

export function metricOf(match: ColorMatch): ColorMetric {
  return match === 'pyembroidery' ? 'redmean' : 'ciede2000';
}

/** pyembroidery `color_distance_red_mean` (https://www.compuphase.com/cmetric.htm), integer maths. */
export function colorDistanceRedMean(a: RGB, b: RGB): number {
  const redMean = pyRound((a[0] + b[0]) / 2);
  const r = a[0] - b[0];
  const g = a[1] - b[1];
  const bl = a[2] - b[2];
  return (((512 + redMean) * r * r) >> 8) + 4 * g * g + (((767 - redMean) * bl * bl) >> 8);
}

/**
 * pyembroidery `find_nearest_color_index` generalised over the metric: skips `null`
 * entries and resolves ties to the LATER index (`<=`). Returns -1 when nothing is left.
 */
export function findNearestIndex(
  color: string,
  values: readonly (string | null)[],
  metric: ColorMetric,
): number {
  let best = -1;
  let bestD = Infinity;
  if (metric === 'redmean') {
    const rgb = parseHex(color);
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (v === null) continue;
      const d = colorDistanceRedMean(rgb, parseHex(v));
      if (d <= bestD) {
        bestD = d;
        best = i;
      }
    }
  } else {
    const lab = hexToLab(color);
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (v === null) continue;
      const d = deltaE2000(lab, hexToLab(v));
      if (d <= bestD) {
        bestD = d;
        best = i;
      }
    }
  }
  return best;
}

const nearestCache = new Map<string, number>();

/** Nearest PEC palette index (1..64) for a `#rrggbb` colour, by CIEDE2000. Cached Lab values. */
export function nearestPecIndex(color: string): number {
  const key = color.toLowerCase();
  const cached = nearestCache.get(key);
  if (cached !== undefined) return cached;
  const lab = hexToLab(key);
  const labs = getPaletteLab();
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < labs.length; i++) {
    const p = labs[i];
    if (!p) continue;
    const d = deltaE2000(lab, p);
    if (d <= bestD) {
      bestD = d;
      best = i;
    }
  }
  if (nearestCache.size > 4096) nearestCache.clear();
  nearestCache.set(key, best);
  return best;
}

/** Nearest PEC palette index using pyembroidery's red-mean metric (byte-compatible mode). */
export function nearestPecIndexRedMean(color: string): number {
  return findNearestIndex(
    color,
    PEC_PALETTE.map((t) => (t ? t.color : null)),
    'redmean',
  );
}

export function nearestPecIndexBy(color: string, match: ColorMatch): number {
  return match === 'pyembroidery' ? nearestPecIndexRedMean(color) : nearestPecIndex(color);
}

/**
 * Iteration order of CPython's `set(items)` for objects whose `__hash__` is `hash(item)`
 * (a non-negative int) and whose `__eq__` is `eq`. Emulates Objects/setobject.c
 * (CPython ≥ 3.7: 8-slot initial table, LINEAR_PROBES = 9, PERTURB_SHIFT = 5, resize to
 * the next power of two above used×4 when fill×5 ≥ mask×3). Only valid for sets that are
 * built by insertion without deletions, which is how `set(list)` behaves.
 */
export function cpythonSetOrder<T>(
  items: readonly T[],
  hash: (t: T) => number,
  eq: (a: T, b: T) => boolean,
): T[] {
  const LINEAR_PROBES = 9;
  const PERTURB_SHIFT = 5;
  let mask = 7;
  let keys: (T | undefined)[] = new Array<T | undefined>(8).fill(undefined);
  let used = new Uint8Array(8);
  let hashes = new Float64Array(8);
  let fill = 0;

  const insertClean = (
    k: (T | undefined)[],
    u: Uint8Array,
    hs: Float64Array,
    m: number,
    key: T,
    h: number,
  ) => {
    let perturb = h;
    let i = h & m;
    while (true) {
      if (!u[i]) {
        k[i] = key;
        u[i] = 1;
        hs[i] = h;
        return;
      }
      if (i + LINEAR_PROBES <= m) {
        for (let j = 1; j <= LINEAR_PROBES; j++) {
          if (!u[i + j]) {
            k[i + j] = key;
            u[i + j] = 1;
            hs[i + j] = h;
            return;
          }
        }
      }
      perturb = Math.floor(perturb / 32); // perturb >>= PERTURB_SHIFT (size_t)
      i = (i * 5 + 1 + perturb) & m;
    }
  };

  for (const key of items) {
    const h = hash(key);
    let i = h & mask;
    let perturb = h;
    let slot = -1;
    let found = false;
    search: while (true) {
      let probes = i + LINEAR_PROBES <= mask ? LINEAR_PROBES : 0;
      let e = i;
      do {
        if (!used[e]) {
          slot = e;
          break search;
        }
        if (hashes[e] === h && eq(keys[e] as T, key)) {
          found = true;
          break search;
        }
        e++;
      } while (probes--);
      perturb = Math.floor(perturb / 2 ** PERTURB_SHIFT);
      i = (i * 5 + 1 + perturb) & mask;
    }
    if (found) continue;
    keys[slot] = key;
    used[slot] = 1;
    hashes[slot] = h;
    fill++;
    if (fill * 5 < mask * 3) continue;
    const minUsed = fill > 50000 ? fill * 2 : fill * 4;
    let newSize = 8;
    while (newSize <= minUsed) newSize *= 2;
    const nk = new Array<T | undefined>(newSize).fill(undefined);
    const nu = new Uint8Array(newSize);
    const nh = new Float64Array(newSize);
    for (let k = 0; k <= mask; k++)
      if (used[k]) insertClean(nk, nu, nh, newSize - 1, keys[k] as T, hashes[k]);
    keys = nk;
    used = nu;
    hashes = nh;
    mask = newSize - 1;
  }
  const out: T[] = [];
  for (let k = 0; k <= mask; k++) if (used[k]) out.push(keys[k] as T);
  return out;
}

/** A thread as seen by `buildUniquePalette`: its colour plus an identity key (all metadata). */
export interface PaletteThread {
  /** #rrggbb */
  color: string;
  /** Equality key (pyembroidery compares colour, description, code, brand, chart). Defaults to the colour. */
  key?: string;
}

/**
 * Port of pyembroidery `build_unique_palette(get_thread_set(), threadlist)`:
 * each distinct thread claims its nearest still-unclaimed PEC entry, so different design
 * colours never share a PEC index while the palette lasts (64 colours); afterwards each
 * thread takes the nearest claimed entry.
 *
 * With 'pyembroidery' matching, threads claim entries in CPython `set()` order (hash =
 * 0xRRGGBB, equality = full thread record), exactly like pyembroidery. With 'ciede2000',
 * distinct colours claim entries in first-appearance order, so earlier colours get the
 * closer match.
 */
export function buildUniquePalette(
  threads: readonly (PaletteThread | string)[],
  match: ColorMatch,
): number[] {
  const metric = metricOf(match);
  const list: Required<PaletteThread>[] = threads.map((t) => {
    const color = (typeof t === 'string' ? t : t.color).toLowerCase();
    return { color, key: typeof t === 'string' ? color : (t.key ?? color) };
  });
  let order: Required<PaletteThread>[];
  if (match === 'pyembroidery') {
    order = cpythonSetOrder(
      list,
      (t) => parseInt(t.color.slice(1, 7), 16) & 0xffffff,
      (a, b) => a.color === b.color && a.key === b.key,
    );
  } else {
    const seen = new Set<string>();
    order = list.filter((t) => (seen.has(t.color) ? false : (seen.add(t.color), true)));
  }
  const palette: (string | null)[] = PEC_PALETTE.map((t) => (t ? t.color : null));
  const chart: (string | null)[] = new Array<string | null>(palette.length).fill(null);
  for (const t of order) {
    const index = findNearestIndex(t.color, palette, metric);
    if (index < 0) break; // no more threads remain in palette
    palette[index] = null; // entries may not be reused
    chart[index] = t.color;
  }
  return list.map((t) => findNearestIndex(t.color, chart, metric));
}
