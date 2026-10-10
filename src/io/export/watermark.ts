// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Optional LumaStitch watermark on exported PNGs and videos: the app icon and "Made with
 * LumaStitch", small and semi-transparent, bottom right.
 */

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** The watermark text. */
export const WATERMARK_TEXT = 'Made with LumaStitch';

/** Text size (px) of the watermark on an image whose longest side is `longest` px. */
export function watermarkSize(longest: number): number {
  return Math.max(11, Math.round(longest * 0.016));
}

/** Height (px) of the strip added below a PNG for the watermark, so it doesn't cover the design. */
export function watermarkStrip(longest: number): number {
  return Math.round(watermarkSize(longest) * 2.4);
}

/** The app icon (public/favicon.svg) at (x, y), `s` px square. */
function drawIcon(ctx: Ctx2D, x: number, y: number, s: number): void {
  const k = s / 32;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k, k);
  ctx.fillStyle = '#4f46e5';
  ctx.beginPath();
  ctx.roundRect(0, 0, 32, 32, 7);
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash([3, 2]);
  ctx.beginPath();
  ctx.moveTo(7, 22);
  ctx.lineTo(13, 10);
  ctx.lineTo(19, 22);
  ctx.lineTo(25, 10);
  ctx.stroke();
  ctx.restore();
}

/**
 * Draws the icon and `text` with their bottom-right corner at (right, bottom) in canvas pixels,
 * the text `size` px tall (no-op for empty text). Shrinks to fit within `maxWidth`.
 */
export function drawWatermark(
  ctx: Ctx2D,
  right: number,
  bottom: number,
  size: number,
  text: string | undefined,
  maxWidth = Infinity,
): void {
  const t = text?.trim();
  if (!t) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  const font = (s: number) => `600 ${s}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.font = font(size);
  const width = (s: number) => ctx.measureText(t).width + s * 1.7;
  let w = width(size);
  if (w > maxWidth) {
    size = Math.max(7, Math.floor((size * maxWidth) / w));
    ctx.font = font(size);
    w = width(size);
  }
  const icon = Math.round(size * 1.35);
  ctx.globalAlpha = 0.85;
  drawIcon(ctx, right - w, bottom - icon + Math.round(size * 0.12), icon);
  ctx.globalAlpha = 1;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'alphabetic';
  // Dark text with a light halo: readable on light fabrics (most of them) and still on dark ones.
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(2, size * 0.22);
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.strokeText(t, right, bottom - size * 0.12);
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillText(t, right, bottom - size * 0.12);
  ctx.restore();
}
