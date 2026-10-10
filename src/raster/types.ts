// SPDX-License-Identifier: GPL-3.0-or-later
/** Public types of the image (raster) digitizer — ARCHITECTURE §12.1. */
import type { PathGeom, TraceSettings } from '@/model/types';

export interface ImageInfo {
  /** Original image size. */
  pxWidth: number;
  pxHeight: number;
  /** Working image size (≈ 0.1 mm/px at the target size, capped at ~4 MP). */
  workWidth: number;
  workHeight: number;
  mmPerPx: number;
  widthMm: number;
  heightMm: number;
  /** True if any pixel is not fully opaque. */
  hasAlpha: boolean;
}

export interface QuantizeOpts {
  colors: number | 'auto';
  preview: boolean;
  /** 'auto' = border/transparency, 'none' = no background, or '#rrggbb' = nearest palette colour. */
  background: 'auto' | 'none' | string;
}

export interface PaletteEntry {
  /** #rrggbb */
  color: string;
  /** Fraction of the image's pixels (0..1). */
  pixelShare: number;
}

export interface LabelPreview {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
}

export interface QuantizeResult {
  /** Indexed by palette index (what `PaletteEdit.index` refers to). Sorted by share, largest first. */
  palette: PaletteEntry[];
  suggestedK: number;
  backgroundIndex: number | null;
  labelPreview: LabelPreview;
}

export interface TracedShape {
  color: string;
  /** mm, design centred on the origin. Closed, non-overlapping cutouts (evenodd); line art is open. */
  geom: PathGeom;
  /** Centreline from line-art mode: stroke with `strokeWidth`, no fill. */
  lineArt?: boolean;
  /** Mean line width in mm (line art only). */
  strokeWidth?: number;
  /** Palette index after merges (the merge target). */
  paletteIndex: number;
}

export interface TracedShapes {
  shapes: TracedShape[];
  warnings: string[];
  widthMm: number;
  heightMm: number;
}

/** Raw RGBA pixels (ImageData-like). */
export interface RawImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface RasterApi {
  load(bitmap: ImageBitmap | RawImage, targetMm: { width?: number; height?: number }): Promise<ImageInfo>;
  quantize(opts: QuantizeOpts): Promise<QuantizeResult>;
  trace(opts: TraceSettings, preview: boolean): Promise<TracedShapes>;
}
