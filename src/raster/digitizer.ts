// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * RasterDigitizer — the image digitizer pipeline (SPEC FR-10, §9.1; ARCHITECTURE §12.1).
 *
 *   load      resample to ≈0.1 mm/px (area averaging), preview level at ≈¼ the pixels, and a "fit" level
 *             (the original shrunk to ≤ previewMaxPixels, independent of the target size)
 *   level     composite onto white (transparency → background), bilateral (full) / 3×3 median (preview,
 *             fit), Lab
 *   quantize  k-means++ in Lab on a flat-pixel sample of the fit level. Centres and palette order depend
 *             only on the original pixels, so palette indices (PaletteEdit.index) are identical for preview,
 *             full resolution and any target size (re-trace stays reproducible). Then full assignment +
 *             blend absorption per level, background detection
 *   trace     palette edits → label remap, line art, open/close, small-region merge, potrace per colour
 *
 * Every stage is cached by its inputs, so moving the detail slider only re-runs cleaning and tracing.
 * Pure TypeScript on typed arrays: runs in the raster worker and in Node (tests).
 */
import type { Matrix, PathGeom, Subpath, TraceSettings } from '@/model/types';
import { stableStringify } from '@/lib/hash';
import { hexToLab } from '@/threads/color';
import { detectBackground } from './background';
import { cleanLabels, fillUnassigned, UNASSIGNED } from './clean';
import { minAreaForDetail, morphRadiusForDetail, potraceParamsFor, RASTER_CONFIG } from './config';
import { bilateralFilter, compositeOnWhite, median3 } from './filter';
import { imageToLab } from './lab';
import { extractLineArt } from './lineArt';
import { remapLabels, resolvePalette } from './palette';
import { labelBounds, traceLabel } from './potrace';
import {
  buildPalette,
  CenterFitter,
  labelLevel,
  labelShares,
  renderLabels,
  type LabLevel,
  type PaletteModel,
} from './quantize';
import { computePreviewSize, computeWorkSize, resampleRGBA } from './resample';
import type {
  ImageInfo,
  QuantizeOpts,
  QuantizeResult,
  RasterApi,
  RawImage,
  TracedShape,
  TracedShapes,
} from './types';

/** Small insertion-ordered LRU. */
class Lru<V> {
  private readonly map = new Map<string, V>();
  constructor(private readonly max: number) {}
  get(key: string): V | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }
  set(key: string, v: V): void {
    this.map.delete(key);
    this.map.set(key, v);
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value as string);
  }
  clear(): void {
    this.map.clear();
  }
}

type LevelKey = 'fit' | 'preview' | 'full';

interface Loaded {
  info: ImageInfo;
  work: RawImage;
  preview: RawImage;
  fit: RawImage;
}

interface CleanStage {
  labels: Uint8Array;
  K: number;
  colors: string[];
  skip: boolean[];
  merged: number;
  lineShapes: TracedShape[];
}

function isRawImage(b: unknown): b is RawImage {
  return !!b && typeof b === 'object' && 'data' in b && 'width' in b && 'height' in b;
}

/** Pixels of an ImageBitmap via OffscreenCanvas (worker / browser only). */
function bitmapPixels(bitmap: ImageBitmap): RawImage {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('OffscreenCanvas 2D context unavailable');
  ctx.drawImage(bitmap, 0, 0);
  const img = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  bitmap.close?.();
  return { data: img.data, width: img.width, height: img.height };
}

export class RasterDigitizer implements RasterApi {
  private loaded: Loaded | null = null;
  private levels: Partial<Record<LevelKey, LabLevel>> = {};
  private fitter: CenterFitter | null = null;
  private palettes = new Map<number, PaletteModel>();
  private readonly labelCache = new Lru<Uint8Array>(RASTER_CONFIG.cacheSize);
  private readonly cleanCache = new Lru<CleanStage>(RASTER_CONFIG.cacheSize);
  private readonly traceCache = new Lru<TracedShapes>(RASTER_CONFIG.cacheSize);
  private photoLike = false;
  /** Bumped on every load so stale async work can be recognised. */
  private generation = 0;

  async load(
    bitmap: ImageBitmap | RawImage,
    targetMm: { width?: number; height?: number },
  ): Promise<ImageInfo> {
    const src = isRawImage(bitmap) ? bitmap : bitmapPixels(bitmap);
    if (src.width < 1 || src.height < 1 || src.data.length < src.width * src.height * 4) {
      throw new Error('Invalid image data');
    }
    const size = computeWorkSize(src.width, src.height, targetMm);
    let hasAlpha = false;
    for (let i = 3; i < src.data.length; i += 4) {
      if (src.data[i] !== 255) {
        hasAlpha = true;
        break;
      }
    }
    const work: RawImage = {
      data: resampleRGBA(src.data, src.width, src.height, size.workWidth, size.workHeight),
      width: size.workWidth,
      height: size.workHeight,
    };
    const pv = computePreviewSize(size.workWidth, size.workHeight);
    const preview: RawImage =
      pv.width === work.width && pv.height === work.height
        ? work
        : {
            data: resampleRGBA(work.data, work.width, work.height, pv.width, pv.height),
            width: pv.width,
            height: pv.height,
          };
    const fs = computePreviewSize(src.width, src.height);
    const fit: RawImage =
      fs.width === src.width && fs.height === src.height
        ? src
        : {
            data: resampleRGBA(src.data, src.width, src.height, fs.width, fs.height),
            width: fs.width,
            height: fs.height,
          };
    const info: ImageInfo = {
      pxWidth: src.width,
      pxHeight: src.height,
      workWidth: size.workWidth,
      workHeight: size.workHeight,
      mmPerPx: size.mmPerPx,
      widthMm: size.widthMm,
      heightMm: size.heightMm,
      hasAlpha,
    };
    this.generation++;
    this.loaded = { info, work, preview, fit };
    this.levels = {};
    this.fitter = null;
    this.palettes.clear();
    this.labelCache.clear();
    this.cleanCache.clear();
    this.traceCache.clear();
    // The fit level is cheap and needed by the first quantize call; build it eagerly.
    this.level('fit');
    return { ...info };
  }

  private requireLoaded(): Loaded {
    if (!this.loaded) throw new Error('RasterDigitizer: load() an image first');
    return this.loaded;
  }

  /** Pre-filtered Lab image for a level (cached). */
  private level(key: LevelKey): LabLevel {
    const cached = this.levels[key];
    if (cached) return cached;
    const loaded = this.requireLoaded();
    const { info } = loaded;
    const img = key === 'fit' ? loaded.fit : key === 'preview' ? loaded.preview : loaded.work;
    const preview = key !== 'full';
    const n = img.width * img.height;
    const comp = compositeOnWhite(img.data, n);
    const filtered = preview
      ? median3(comp.rgb, img.width, img.height)
      : bilateralFilter(comp.rgb, img.width, img.height);
    const mmPerPx = info.widthMm / img.width;
    const level: LabLevel = {
      width: img.width,
      height: img.height,
      lab: imageToLab(filtered, n, 3),
      transparent: comp.transparent,
      mmPerPx,
      upscale: Math.max(1, img.width / info.pxWidth),
    };
    this.levels[key] = level;
    return level;
  }

  private getFitter(): CenterFitter {
    if (!this.fitter) {
      this.fitter = new CenterFitter(this.level('fit'));
      this.photoLike = this.fitter.photoLike;
    }
    return this.fitter;
  }

  private resolveK(colors: number | 'auto'): { k: number; suggestedK: number } {
    const fitter = this.getFitter();
    const suggestedK = fitter.suggestedK();
    const { minK, maxK } = RASTER_CONFIG.kmeans;
    const k = colors === 'auto' ? suggestedK : Math.max(minK, Math.min(maxK, Math.round(colors)));
    return { k, suggestedK };
  }

  private palette(k: number): PaletteModel {
    let p = this.palettes.get(k);
    if (!p) {
      p = buildPalette(this.level('fit'), this.getFitter().fit(k));
      this.palettes.set(k, p);
    }
    return p;
  }

  private labels(k: number, preview: boolean): Uint8Array {
    const key = `${k}|${preview}`;
    let l = this.labelCache.get(key);
    if (!l) {
      l = labelLevel(this.level(preview ? 'preview' : 'full'), this.palette(k));
      this.labelCache.set(key, l);
    }
    return l;
  }

  async quantize(opts: QuantizeOpts): Promise<QuantizeResult> {
    const { k, suggestedK } = this.resolveK(opts.colors);
    const pal = this.palette(k);
    const level = this.level(opts.preview ? 'preview' : 'full');
    const labels = this.labels(k, opts.preview);
    const shares = labelShares(labels, pal.K);
    const backgroundIndex = detectBackground(
      opts.background,
      labels,
      level.width,
      level.height,
      pal.colors,
      pal.transparentIndex,
    );
    return {
      palette: pal.colors.map((color, i) => ({ color, pixelShare: shares[i] })),
      suggestedK,
      backgroundIndex,
      labelPreview: { width: level.width, height: level.height, rgba: renderLabels(labels, pal.colors) },
    };
  }

  /** Image px → design mm, centred on the origin. */
  private pxToMm(level: LabLevel): Matrix {
    const s = level.mmPerPx;
    return [s, 0, 0, s, (-level.width * s) / 2, (-level.height * s) / 2];
  }

  private clean(opts: TraceSettings, preview: boolean, k: number): CleanStage {
    const key = stableStringify({
      k,
      preview,
      palette: opts.palette,
      background: opts.background,
      detail: opts.detail,
      lineArt: opts.lineArt,
    });
    const cached = this.cleanCache.get(key);
    if (cached) return cached;
    const level = this.level(preview ? 'preview' : 'full');
    const pal = this.palette(k);
    const { width: w, height: h, mmPerPx } = level;
    const base = this.labels(k, preview);
    const bg = detectBackground(opts.background, base, w, h, pal.colors, pal.transparentIndex);
    const resolved = resolvePalette(pal.colors, opts.palette ?? [], bg);
    let labels = remapLabels(base, resolved.remap);

    const lineShapes: TracedShape[] = [];
    if (opts.lineArt) {
      const candidate = resolved.colors.map(
        (c, i) =>
          resolved.remap[i] === i && !resolved.skip[i] && hexToLab(c)[0] < RASTER_CONFIG.lineArt.maxLightness,
      );
      const la = extractLineArt(labels, w, h, candidate, mmPerPx);
      if (la.strokes.length) {
        // Centreline pixels go to the neighbouring regions so fills run under the outline.
        for (let i = 0; i < labels.length; i++) if (la.lineMask[i]) labels[i] = UNASSIGNED;
        fillUnassigned(labels, w, h);
        const m = this.pxToMm(level);
        for (const s of la.strokes) {
          const subpaths: Subpath[] = s.polylines.map((pl) => {
            const nodes = [];
            for (let i = 0; i < pl.xy.length; i += 2) {
              const x = pl.xy[i];
              const y = pl.xy[i + 1];
              nodes.push({ p: [m[0] * x + m[4], m[3] * y + m[5]] as [number, number] });
            }
            return { closed: pl.closed, nodes };
          });
          lineShapes.push({
            color: resolved.colors[s.label],
            geom: { subpaths: subpaths.filter((sp) => sp.nodes.length >= 2), fillRule: 'nonzero' },
            lineArt: true,
            strokeWidth: s.widthPx * mmPerPx,
            paletteIndex: s.label,
          });
        }
      }
    }

    const radiusPx = Math.round(morphRadiusForDetail(opts.detail) / mmPerPx);
    const minAreaPx = minAreaForDetail(opts.detail) / (mmPerPx * mmPerPx);
    const cleaned = cleanLabels(labels, w, h, pal.K, radiusPx, minAreaPx);
    labels = cleaned.labels;
    const stage: CleanStage = {
      labels,
      K: pal.K,
      colors: resolved.colors,
      skip: resolved.colors.map((_, i) => resolved.skip[i] || resolved.remap[i] !== i),
      merged: cleaned.merged,
      lineShapes,
    };
    this.cleanCache.set(key, stage);
    return stage;
  }

  async trace(opts: TraceSettings, preview: boolean): Promise<TracedShapes> {
    const { info } = this.requireLoaded();
    const gen = this.generation;
    const { k } = this.resolveK(opts.colors);
    const key = stableStringify({ k, preview, opts });
    const cached = this.traceCache.get(key);
    if (cached) return cloneTraced(cached);

    const level = this.level(preview ? 'preview' : 'full');
    const stage = this.clean(opts, preview, k);
    const { width: w, height: h, mmPerPx } = level;
    const params = potraceParamsFor(opts.smoothness, mmPerPx);
    const m = this.pxToMm(level);
    const boxes = labelBounds(stage.labels, w, h, stage.K);
    const shapes: TracedShape[] = [];
    for (let l = 0; l < stage.K; l++) {
      const box = boxes[l];
      if (!box || stage.skip[l]) continue;
      const geoms = await traceLabel(stage.labels, w, l, box, params, m);
      for (const geom of geoms) shapes.push({ color: stage.colors[l], geom, paletteIndex: l });
    }
    shapes.push(...stage.lineShapes);
    const warnings: string[] = [];
    if (this.photoLike) {
      warnings.push('This looks like a photo: the result is posterised. Flat-colour artwork works best.');
    }
    if (stage.merged > 0) warnings.push(`${stage.merged} small regions were merged into their neighbours.`);
    if (info.mmPerPx > RASTER_CONFIG.targetMmPerPx * 1.05) {
      warnings.push(
        `The design is large: tracing at ${info.mmPerPx.toFixed(2)} mm per pixel (fine detail may be lost).`,
      );
    }
    if (shapes.length === 0)
      warnings.push('Nothing to stitch: every colour is marked as background or skipped.');
    const result: TracedShapes = { shapes, warnings, widthMm: info.widthMm, heightMm: info.heightMm };
    if (gen === this.generation) this.traceCache.set(key, result);
    return cloneTraced(result);
  }
}

function cloneGeom(g: PathGeom): PathGeom {
  return {
    fillRule: g.fillRule,
    subpaths: g.subpaths.map((sp) => ({
      closed: sp.closed,
      nodes: sp.nodes.map((n) => {
        const o: (typeof sp.nodes)[number] = { p: [n.p[0], n.p[1]] };
        if (n.in) o.in = [n.in[0], n.in[1]];
        if (n.out) o.out = [n.out[0], n.out[1]];
        return o;
      }),
    })),
  };
}

/** Callers may mutate results (and Comlink structured-clones anyway); keep the cache pristine. */
function cloneTraced(t: TracedShapes): TracedShapes {
  return {
    ...t,
    warnings: [...t.warnings],
    shapes: t.shapes.map((s) => ({ ...s, geom: cloneGeom(s.geom) })),
  };
}
