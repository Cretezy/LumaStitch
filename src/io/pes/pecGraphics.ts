// SPDX-License-Identifier: GPL-3.0-or-later
// PEC thumbnail graphics: 48×38 px, 1 bit per pixel, 6 bytes per row, LSB = leftmost pixel.
// Ported from pyembroidery's PecGraphics.py (pyembroidery, MIT License, Copyright (c) 2018 Tatarize).
import type { Bounds } from './machineCommands';

export const PEC_ICON_WIDTH = 48;
export const PEC_ICON_HEIGHT = 38;
export const PEC_ICON_STRIDE = PEC_ICON_WIDTH / 8;
export const PEC_ICON_BYTES = PEC_ICON_STRIDE * PEC_ICON_HEIGHT; // 228

const EDGE_TOP = [0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
const EDGE_1 = [0xf0, 0xff, 0xff, 0xff, 0xff, 0x0f];
const EDGE_2 = [0x08, 0x00, 0x00, 0x00, 0x00, 0x10];
const EDGE_3 = [0x04, 0x00, 0x00, 0x00, 0x00, 0x20];
const SIDE = [0x02, 0x00, 0x00, 0x00, 0x00, 0x40];

/** pyembroidery `PecGraphics.blank`: an empty icon with a rounded frame. */
const BLANK: readonly number[] = [
  ...EDGE_TOP,
  ...EDGE_1,
  ...EDGE_2,
  ...EDGE_3,
  ...Array.from({ length: 30 }, () => SIDE).flat(),
  ...EDGE_3,
  ...EDGE_2,
  ...EDGE_1,
  ...EDGE_TOP,
];

export function getBlank(): Uint8Array {
  return Uint8Array.from(BLANK);
}

/**
 * pyembroidery `graphic_mark_bit`, including Python list indexing semantics:
 * negative indexes wrap from the end, out-of-range ones are ignored (IndexError).
 */
export function graphicMarkBit(graphic: Uint8Array, x: number, y: number, stride = PEC_ICON_STRIDE): void {
  let idx = y * stride + Math.trunc(x / 8);
  if (idx < 0) idx += graphic.length;
  if (idx < 0 || idx >= graphic.length) return;
  const bit = ((x % 8) + 8) % 8; // Python modulo is non-negative
  graphic[idx] |= 1 << bit;
}

/** pyembroidery `draw_scaled(extends, points, graphic, stride, buffer)`. */
export function drawScaled(
  extents: Bounds,
  points: Iterable<{ x: number; y: number }>,
  graphic: Uint8Array,
  stride: number,
  buffer = 5,
): void {
  const { minX: left, minY: top, maxX: right, maxY: bottom } = extents;
  let diagramWidth = right - left;
  let diagramHeight = bottom - top;
  const graphicWidth = stride * 8;
  const graphicHeight = graphic.length / stride;
  if (diagramWidth === 0) diagramWidth = 1;
  if (diagramHeight === 0) diagramHeight = 1;
  const scaleX = (graphicWidth - buffer) / diagramWidth;
  const scaleY = (graphicHeight - buffer) / diagramHeight;
  const scale = Math.min(scaleX, scaleY);
  const cx = (right + left) / 2;
  const cy = (bottom + top) / 2;
  let translateX = -cx;
  let translateY = -cy;
  translateX *= scale;
  translateY *= scale;
  translateX += graphicWidth / 2;
  translateY += graphicHeight / 2;
  for (const p of points) {
    graphicMarkBit(
      graphic,
      Math.floor(p.x * scale + translateX),
      Math.floor(p.y * scale + translateY),
      stride,
    );
  }
}

/** Renders an icon as text rows ('#' = set), like pyembroidery `get_graphic_as_string`. */
export function graphicToString(graphic: Uint8Array, stride = PEC_ICON_STRIDE): string {
  const rows: string[] = [];
  for (let r = 0; r * stride < graphic.length; r++) {
    let s = '';
    for (let b = 0; b < stride; b++) {
      const byte = graphic[r * stride + b];
      for (let i = 0; i < 8; i++) s += (byte >> i) & 1 ? '#' : ' ';
    }
    rows.push(s);
  }
  return rows.join('\n');
}
