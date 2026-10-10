// SPDX-License-Identifier: GPL-3.0-or-later
/** PNG preview export (SPEC FR-6.5): the stitch plan rendered with the canvas stitch renderer. */
import { renderPlanImage } from '@/canvas/stitchRenderer';
import type { StitchPlan } from '@/engine/types';

/** Default longest side of exported PNGs, px. */
export const PNG_MAX_SIDE = 2048;

export interface PngExportOptions {
  mode: 'flat' | 'realistic';
  /** Longest side in pixels. Default 2048. */
  maxSide?: number;
  /** Background colour (e.g. the fabric colour); null/undefined = transparent. */
  background?: string | null;
  /** Padding around the design in pixels. Default 2 % of maxSide. */
  padding?: number;
}

/** Pixel size of the PNG for a plan: the design's aspect ratio, longest side = maxSide. */
export function pngSize(
  plan: StitchPlan,
  maxSide = PNG_MAX_SIDE,
  padding = Math.round(maxSide * 0.02),
): { width: number; height: number; padding: number } {
  const side = Math.max(16, Math.round(maxSide));
  const pad = Math.min(Math.max(0, padding), Math.floor(side / 4));
  const b = plan.bounds;
  // Same minimum extent as renderPlanImage, so the drawing fills the image.
  const bw = Math.max(1, b.maxX - b.minX);
  const bh = Math.max(1, b.maxY - b.minY);
  const inner = side - pad * 2;
  if (bw >= bh)
    return { width: side, height: Math.max(1, Math.round((inner * bh) / bw) + pad * 2), padding: pad };
  return { width: Math.max(1, Math.round((inner * bw) / bh) + pad * 2), height: side, padding: pad };
}

/** Renders a plan to a PNG blob. */
export async function exportPng(plan: StitchPlan, opts: PngExportOptions): Promise<Blob> {
  const { width, height, padding } = pngSize(plan, opts.maxSide ?? PNG_MAX_SIDE, opts.padding);
  const canvas = renderPlanImage(plan, {
    width,
    height,
    mode: opts.mode,
    padding,
    ...(opts.background ? { background: opts.background } : {}),
  });
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type: 'image/png' });
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png'),
  );
}
