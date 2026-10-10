// SPDX-License-Identifier: GPL-3.0-or-later
/** Image digitizer thresholds (SPEC §9.1). All tunables live here. */

export const RASTER_CONFIG = {
  /** Working resolution: 1 px ≈ this many mm at the target size. */
  targetMmPerPx: 0.1,
  /** Cap for the working image (pixels). */
  maxWorkPixels: 4_000_000,
  /** Cap for the dialog preview image (pixels). Preview is about ¼ of the work resolution. */
  previewMaxPixels: 360_000,
  /** Linear factor for preview (0.5 = ¼ of the pixels). */
  previewScale: 0.5,
  /** Longest side in mm when the caller gives no target size. */
  defaultTargetMm: 100,
  /** Alpha below this (0..255) is transparent → background. */
  alphaThreshold: 128,
  /** A transparent label is only created when at least this fraction of pixels is transparent. */
  minTransparentFraction: 0.001,

  bilateral: {
    /** Spatial sigma in px (separable passes). */
    sigmaSpatial: 1.2,
    radius: 2,
    /** Range sigma in RGB units. */
    sigmaRange: 22,
  },

  kmeans: {
    /** Pixel sample used to fit the final centres. */
    sampleSize: 50_000,
    /** Smaller sample used while searching for the automatic colour count. */
    autoSampleSize: 20_000,
    maxIter: 40,
    seed: 0x5eed1234,
    minK: 2,
    maxK: 16,
    /** k-means restarts (different seeds) while searching k / for the final fit; best error wins. */
    autoRestarts: 1,
    fitRestarts: 3,
  },

  autoK: {
    /** Stop when the next k reduces error by less than this fraction of the 1-cluster error… */
    minGain: 0.08,
    /** …and by less than this fraction of the current error (protects small but distinct colours). */
    maxRelGain: 0.6,
    /** Sample points farther than this (ΔE, Euclidean Lab) from their centre count as unexplained. */
    outlierDist: 10,
    /** Stop when fewer than this fraction of sample points are unexplained. */
    outlierFrac: 0.003,
  },

  flat: {
    /** A pixel is "flat" when all 4-neighbours are within this Lab distance (excludes anti-aliasing). */
    tol: 6,
    /** Fit on flat pixels only if at least this fraction of opaque pixels is flat; otherwise image is photo-like. */
    minFraction: 0.2,
  },

  blend: {
    /** Max run length (px at 0.1 mm/px; scaled when upsampling) of an anti-aliasing blend. */
    maxRun: 2,
    /** Max Lab distance from the segment between the two neighbouring cluster centres. */
    segTol: 12,
    tMin: 0.05,
    tMax: 0.95,
  },

  background: {
    /** Border ring width in px. */
    borderPx: 2,
    /** Dominant border label must cover at least this share of the border. */
    minShare: 0.4,
  },

  detail: {
    /** Minimum region area in mm² at detail = 0.5. */
    minAreaMm2: 1,
    /** Area multiplier range: detail 0 → ×range, detail 1 → ÷range. */
    areaRange: 4,
    /** Morphology radius in mm at detail = 0 (scales linearly to 0 at detail = 1). */
    morphMaxRadiusMm: 0.2,
  },

  smoothness: {
    alphamaxMin: 0.6,
    alphamaxMax: 1.3,
    optTolMin: 0.1,
    optTolMax: 0.6,
    /** potrace turdsize in px² at 0.1 mm/px (scaled to the actual resolution). */
    turdMin: 2,
    turdMax: 8,
  },

  lineArt: {
    /** Regions thinner than this everywhere are skeletonised. */
    maxWidthMm: 1.5,
    /** Only colours darker than this L* are line-art candidates. */
    maxLightness: 45,
    /** Douglas–Peucker tolerance. */
    simplifyMm: 0.1,
    /** Polylines shorter than this are dropped. */
    minLengthMm: 1,
  },

  /** potrace's SVG backend writes coordinates ×10 with y up. */
  potraceUnit: 10,
  /** Cache entries kept per stage. */
  cacheSize: 4,
};

export type RasterConfig = typeof RASTER_CONFIG;

/** Detail slider → minimum region area (mm²). */
export function minAreaForDetail(detail: number): number {
  const d = clamp01(detail);
  return RASTER_CONFIG.detail.minAreaMm2 * Math.pow(RASTER_CONFIG.detail.areaRange, (0.5 - d) * 2);
}

/** Detail slider → morphology radius (mm). */
export function morphRadiusForDetail(detail: number): number {
  return (1 - clamp01(detail)) * RASTER_CONFIG.detail.morphMaxRadiusMm;
}

export interface PotraceParams {
  turdsize: number;
  alphamax: number;
  opttolerance: number;
  opticurve: number;
}

/** Smoothness slider → potrace parameters. `mmPerPx` scales the speckle size. */
export function potraceParamsFor(smoothness: number, mmPerPx: number): PotraceParams {
  const s = clamp01(smoothness);
  const c = RASTER_CONFIG.smoothness;
  const pxScale = (RASTER_CONFIG.targetMmPerPx / mmPerPx) ** 2;
  return {
    turdsize: Math.max(0, Math.round((c.turdMin + s * (c.turdMax - c.turdMin)) * pxScale)),
    alphamax: c.alphamaxMin + s * (c.alphamaxMax - c.alphamaxMin),
    opttolerance: c.optTolMin + s * (c.optTolMax - c.optTolMin),
    opticurve: 1,
  };
}

export function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.5;
}
