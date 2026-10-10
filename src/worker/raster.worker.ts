// SPDX-License-Identifier: GPL-3.0-or-later
/// <reference lib="webworker" />
/**
 * Raster (image digitizer) worker — ARCHITECTURE §12.1. Its own worker, so tracing never competes with
 * stitch generation. Uses esm-potrace-wasm (Potrace, GPL-2.0-or-later) via src/raster/potrace.ts.
 */
import * as Comlink from 'comlink';
import { RasterDigitizer } from '@/raster/digitizer';
import type { RasterApi } from '@/raster/types';

const digitizer = new RasterDigitizer();

/** Same surface as RasterDigitizer, but transfers the label-preview buffer instead of copying it. */
const api: RasterApi = {
  load: (bitmap, targetMm) => digitizer.load(bitmap, targetMm),
  async quantize(opts) {
    const res = await digitizer.quantize(opts);
    return Comlink.transfer(res, [res.labelPreview.rgba.buffer]);
  },
  trace: (opts, preview) => digitizer.trace(opts, preview),
};

Comlink.expose(api);
