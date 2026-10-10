// SPDX-License-Identifier: GPL-3.0-or-later
/** Computed-style helpers for the SVG import: paints, colours, opacity, stroke width (ARCH §8.5). */
import { toHex, type RGB } from '@/threads/color';
import { XLINK_NS } from './sanitize';

export interface ParsedColor {
  /** #rrggbb */
  hex: string;
  alpha: number;
}

const RGB_RE =
  /^rgba?\(\s*([\d.+-e]+%?)[\s,]+([\d.+-e]+%?)[\s,]+([\d.+-e]+%?)(?:\s*[,/]\s*([\d.+-e]+%?))?\s*\)$/i;
const HEX_RE = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

let probeCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;

function channel(s: string): number {
  return s.endsWith('%') ? (parseFloat(s) / 100) * 255 : parseFloat(s);
}
function alphaOf(s: string | undefined): number {
  if (s == null) return 1;
  return s.endsWith('%') ? parseFloat(s) / 100 : parseFloat(s);
}

/**
 * Parse any CSS colour (computed styles mostly give `rgb()/rgba()`, but modern colour spaces
 * such as `oklch()` / `color()` are kept as written) into sRGB hex + alpha. Unknown → null.
 */
export function parseCssColor(value: string): ParsedColor | null {
  const v = value.trim();
  if (!v || v === 'none') return null;
  if (v === 'transparent') return { hex: '#000000', alpha: 0 };
  let m = RGB_RE.exec(v);
  if (m) {
    const rgb: RGB = [channel(m[1]), channel(m[2]), channel(m[3])];
    return { hex: toHex(rgb), alpha: Math.max(0, Math.min(1, alphaOf(m[4]))) };
  }
  m = HEX_RE.exec(v);
  if (m) {
    let h = m[1];
    if (h.length <= 4) h = [...h].map((c) => c + c).join('');
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return { hex: `#${h.slice(0, 6).toLowerCase()}`, alpha: a };
  }
  // Fallback: let the browser rasterise one pixel.
  if (!probeCtx) {
    const c =
      typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas');
    c.width = c.height = 1;
    probeCtx = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | null;
    if (!probeCtx) return null;
  }
  const ctx = probeCtx;
  ctx.clearRect(0, 0, 1, 1);
  // An invalid colour leaves fillStyle unchanged: detect that with a sentinel.
  ctx.fillStyle = '#010203';
  ctx.fillStyle = v;
  if (String(ctx.fillStyle) === '#010203' && v.toLowerCase() !== '#010203') return null;
  ctx.fillRect(0, 0, 1, 1);
  const d = ctx.getImageData(0, 0, 1, 1).data;
  if (d[3] === 0) return { hex: '#000000', alpha: 0 };
  // Un-premultiply is not needed: getImageData returns straight (non-premultiplied) values.
  return { hex: toHex([d[0], d[1], d[2]]), alpha: d[3] / 255 };
}

export type PaintWarning = 'gradient' | 'pattern';

export interface ResolvedPaint {
  /** #rrggbb, or null when nothing is painted. */
  color: string | null;
  warn?: PaintWarning;
}

const URL_RE = /^url\(\s*(['"]?)([^'")]*)\1\s*\)\s*(.*)$/i;

/** Parse a computed paint value (`fill` / `stroke`). */
export function parsePaint(value: string): { ref: string | null; color: string } {
  const v = value.trim();
  const m = URL_RE.exec(v);
  if (!m) return { ref: null, color: v };
  const hash = m[2].lastIndexOf('#');
  return { ref: hash >= 0 ? m[2].slice(hash + 1) : null, color: m[3].trim() };
}

function hrefOf(el: Element): string | null {
  return el.getAttribute('href') ?? el.getAttributeNS(XLINK_NS, 'href') ?? el.getAttribute('xlink:href');
}

/** Average of a gradient's stop colours (following `href` templates). Null if all transparent. */
export function gradientAverage(grad: Element, lookup: (id: string) => Element | null): string | null {
  let el: Element | null = grad;
  const seen = new Set<Element>();
  let stops: Element[] = [];
  while (el && !seen.has(el)) {
    seen.add(el);
    stops = Array.from(el.children).filter((c) => c.localName === 'stop');
    if (stops.length) break;
    const href = hrefOf(el);
    el = href?.startsWith('#') ? lookup(href.slice(1)) : null;
  }
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (const s of stops) {
    const cs = getComputedStyle(s);
    const c = parseCssColor(cs.getPropertyValue('stop-color') || 'black');
    const op = parseFloat(cs.getPropertyValue('stop-opacity') || '1');
    if (!c || c.alpha * (Number.isFinite(op) ? op : 1) <= 0) continue;
    const [cr, cg, cb] = [1, 3, 5].map((i) => parseInt(c.hex.slice(i, i + 2), 16));
    r += cr;
    g += cg;
    b += cb;
    n++;
  }
  return n ? toHex([r / n, g / n, b / n]) : null;
}

/** Neutral colour used for pattern fills without a fallback colour. */
export const PATTERN_FALLBACK = '#808080';

/**
 * Resolve a computed `fill`/`stroke` value. `paintOpacity` is `fill-opacity`/`stroke-opacity`
 * (× element/group opacity): fully transparent paint is ignored, otherwise opacity is ignored.
 */
export function resolvePaint(
  value: string,
  paintOpacity: number,
  lookup: (id: string) => Element | null,
): ResolvedPaint {
  if (!(paintOpacity > 0)) return { color: null };
  const { ref, color } = parsePaint(value);
  const fallback = (): string | null => {
    if (!color || color === 'none') return null;
    const c = parseCssColor(color);
    return c && c.alpha > 0 ? c.hex : null;
  };
  if (ref == null) {
    if (/^(context-fill|context-stroke)$/.test(color)) return { color: null };
    return { color: fallback() };
  }
  const target = lookup(ref);
  if (!target) return { color: fallback() };
  const tag = target.localName;
  if (tag === 'linearGradient' || tag === 'radialGradient') {
    const avg = gradientAverage(target, lookup);
    return avg ? { color: avg, warn: 'gradient' } : { color: null };
  }
  if (tag === 'pattern') return { color: fallback() ?? PATTERN_FALLBACK, warn: 'pattern' };
  return { color: fallback() };
}

/** Parse a numeric computed value such as opacity ('0.5', '50%'). */
export function parseOpacity(v: string | null | undefined): number {
  if (!v) return 1;
  const n = v.trim().endsWith('%') ? parseFloat(v) / 100 : parseFloat(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 1;
}
