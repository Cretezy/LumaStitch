// SPDX-License-Identifier: GPL-3.0-or-later
import type { BBox } from '@/geom/types';
import type { Vec2 } from '@/model/types';
import type { Viewport } from '@/store/uiStore';

export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 200;

export function docToScreen(v: Viewport, p: Vec2): Vec2 {
  return [p[0] * v.zoom + v.pan[0], p[1] * v.zoom + v.pan[1]];
}

export function screenToDoc(v: Viewport, p: Vec2): Vec2 {
  return [(p[0] - v.pan[0]) / v.zoom, (p[1] - v.pan[1]) / v.zoom];
}

/** Zoom by `factor` keeping the screen point `at` fixed. */
export function zoomAt(v: Viewport, factor: number, at: Vec2): Viewport {
  const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v.zoom * factor));
  const f = zoom / v.zoom;
  return { zoom, pan: [at[0] - (at[0] - v.pan[0]) * f, at[1] - (at[1] - v.pan[1]) * f] };
}

/** Viewport that fits `b` into a canvas of size w×h with padding (px). */
export function fitBBox(b: BBox, w: number, h: number, padding = 48): Viewport {
  const bw = Math.max(1, b.maxX - b.minX),
    bh = Math.max(1, b.maxY - b.minY);
  const zoom = Math.max(
    MIN_ZOOM,
    Math.min(MAX_ZOOM, Math.min((w - padding * 2) / bw, (h - padding * 2) / bh)),
  );
  const cx = (b.minX + b.maxX) / 2,
    cy = (b.minY + b.maxY) / 2;
  return { zoom, pan: [w / 2 - cx * zoom, h / 2 - cy * zoom] };
}

/** 100% = physical size: 96 CSS px per inch. */
export const PX_PER_MM_100 = 96 / 25.4;
