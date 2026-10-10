// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Adapter around potrace (esm-potrace-wasm, GPL-2.0-or-later; Potrace © Peter Selinger).
 * Traces a binary mask into PathGeoms in mm. Works in browsers, workers and Node.
 */
import type { Matrix, PathGeom } from '@/model/types';
import { multiply } from '@/geom/matrix';
import { parsePathData, transformGeom } from '@/geom/pathData';
import { RASTER_CONFIG, type PotraceParams } from './config';

type PotraceFn = (
  image: { data: Uint8ClampedArray; width: number; height: number },
  options: Record<string, number | boolean>,
) => Promise<string[] | string>;

let loading: Promise<PotraceFn> | null = null;

/**
 * Lazily load the wasm module. Its Emscripten glue references `require`/`__dirname` when it detects
 * Node; under native ESM those are undefined, so provide inert stand-ins just for module evaluation.
 * (The wasm binary is embedded, so nothing is read from disk.)
 */
export function loadPotrace(): Promise<PotraceFn> {
  if (!loading) {
    loading = (async () => {
      const g = globalThis as Record<string, unknown>;
      const proc = g.process as { versions?: { node?: string } } | undefined;
      const shim = !!proc?.versions?.node && typeof g.require === 'undefined';
      if (shim) {
        g.require = () => ({});
        g.__dirname = '/';
      }
      try {
        const mod = await import('esm-potrace-wasm');
        await mod.init();
        return mod.potrace as unknown as PotraceFn;
      } finally {
        if (shim) {
          delete g.require;
          delete g.__dirname;
        }
      }
    })();
    loading.catch(() => {
      loading = null;
    });
  }
  return loading;
}

export interface MaskBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Bounding boxes of every label value < K (null if absent). */
export function labelBounds(labels: Uint8Array, w: number, h: number, K: number): (MaskBox | null)[] {
  const boxes: (MaskBox | null)[] = Array.from({ length: K }, () => null);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const l = labels[row + x];
      if (l >= K) continue;
      const b = boxes[l];
      if (!b) boxes[l] = { x0: x, y0: y, x1: x + 1, y1: y + 1 };
      else {
        if (x < b.x0) b.x0 = x;
        if (x >= b.x1) b.x1 = x + 1;
        b.y1 = y + 1;
      }
    }
  }
  return boxes;
}

/**
 * Trace the pixels where labels === label (inside `box`) with potrace.
 * `pxToMm` maps image px (top-left origin, y down) to design mm. Returns one PathGeom per potrace
 * top-level path (an outer boundary with its holes), fill rule evenodd.
 */
export async function traceLabel(
  labels: Uint8Array,
  w: number,
  label: number,
  box: MaskBox,
  params: PotraceParams,
  pxToMm: Matrix,
): Promise<PathGeom[]> {
  const potrace = await loadPotrace();
  const bw = box.x1 - box.x0;
  const bh = box.y1 - box.y0;
  const rgba = new Uint8ClampedArray(bw * bh * 4).fill(255);
  for (let y = 0; y < bh; y++) {
    const row = (y + box.y0) * w + box.x0;
    for (let x = 0; x < bw; x++) {
      if (labels[row + x] === label) {
        const o = (y * bw + x) * 4;
        rgba[o] = 0;
        rgba[o + 1] = 0;
        rgba[o + 2] = 0;
      }
    }
  }
  const res = await potrace(
    { data: rgba, width: bw, height: bh },
    {
      pathonly: true,
      extractcolors: false,
      turdsize: params.turdsize,
      alphamax: params.alphamax,
      opticurve: params.opticurve,
      opttolerance: params.opttolerance,
      turnpolicy: 4, // POTRACE_TURNPOLICY_MINORITY
    },
  );
  const paths = Array.isArray(res) ? res : [res];
  // potrace px (×unit, y up, crop-relative) → image px → mm
  const u = RASTER_CONFIG.potraceUnit;
  const toImage: Matrix = [1 / u, 0, 0, -1 / u, box.x0, box.y0 + bh];
  const m = multiply(pxToMm, toImage);
  const out: PathGeom[] = [];
  for (const d of paths) {
    if (!d.trim()) continue;
    const g = parsePathData(d, 'evenodd');
    if (g.subpaths.length) out.push(transformGeom(g, m));
  }
  return out;
}
