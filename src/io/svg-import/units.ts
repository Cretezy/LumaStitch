// SPDX-License-Identifier: GPL-3.0-or-later
/** SVG lengths, viewBox / preserveAspectRatio maths and the root user-unit → mm scale (ARCH §5, §8.3). */
import type { Matrix } from '@/model/types';

/** CSS px per unit (CSS absolute units: 96 px = 1 in). */
const PX_PER_UNIT: Record<string, number> = {
  '': 1,
  px: 1,
  in: 96,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
  q: 96 / 25.4 / 4,
  pt: 96 / 72,
  pc: 16,
  em: 16,
  rem: 16,
  ex: 8,
};

export const MM_PER_PX = 25.4 / 96;

export interface Length {
  value: number;
  /** Lowercase unit; '' for unitless, '%' for percentages. */
  unit: string;
}

const LENGTH_RE = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*([a-z%]*)\s*$/i;

export function parseLength(s: string | null | undefined): Length | null {
  if (s == null) return null;
  const m = LENGTH_RE.exec(s);
  if (!m) return null;
  const unit = m[2].toLowerCase();
  if (unit !== '%' && !(unit in PX_PER_UNIT)) return null;
  return { value: parseFloat(m[1]), unit };
}

/**
 * Length → user units (= CSS px inside SVG). Percentages resolve against `percentOf`
 * (the relevant viewport dimension). Returns `fallback` for missing/invalid values.
 */
export function lengthToUser(s: string | null | undefined, percentOf: number, fallback = 0): number {
  const l = parseLength(s);
  if (!l) return fallback;
  if (l.unit === '%') return (l.value / 100) * percentOf;
  return l.value * PX_PER_UNIT[l.unit];
}

/** Absolute length → mm (null for %, invalid or missing). */
export function lengthToMm(s: string | null | undefined): number | null {
  const l = parseLength(s);
  if (!l || l.unit === '%') return null;
  return l.value * PX_PER_UNIT[l.unit] * MM_PER_PX;
}

export interface ViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function parseViewBox(s: string | null | undefined): ViewBox | null {
  if (!s) return null;
  const n = s
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (n.length !== 4 || n.some((v) => !Number.isFinite(v)) || n[2] <= 0 || n[3] <= 0) return null;
  return { x: n[0], y: n[1], width: n[2], height: n[3] };
}

export interface AspectRatio {
  align: 'none' | `x${'Min' | 'Mid' | 'Max'}Y${'Min' | 'Mid' | 'Max'}`;
  slice: boolean;
}

export function parsePreserveAspectRatio(s: string | null | undefined): AspectRatio {
  const parts = (s ?? '')
    .trim()
    .split(/\s+/)
    .filter((p) => p && p !== 'defer');
  const align = (parts[0] ?? 'xMidYMid') as AspectRatio['align'];
  const valid = align === 'none' || /^x(Min|Mid|Max)Y(Min|Mid|Max)$/.test(align);
  return { align: valid ? align : 'xMidYMid', slice: parts[1] === 'slice' };
}

/** Matrix mapping viewBox coordinates into a viewport of `width × height` at the origin. */
export function viewBoxTransform(vb: ViewBox, width: number, height: number, par: AspectRatio): Matrix {
  const sx = width / vb.width;
  const sy = height / vb.height;
  if (par.align === 'none') return [sx, 0, 0, sy, -vb.x * sx, -vb.y * sy];
  const s = par.slice ? Math.max(sx, sy) : Math.min(sx, sy);
  let tx = -vb.x * s;
  let ty = -vb.y * s;
  const xa = par.align.slice(1, 4);
  const ya = par.align.slice(5, 8);
  if (xa === 'Mid') tx += (width - vb.width * s) / 2;
  else if (xa === 'Max') tx += width - vb.width * s;
  if (ya === 'Mid') ty += (height - vb.height * s) / 2;
  else if (ya === 'Max') ty += height - vb.height * s;
  return [s, 0, 0, s, tx, ty];
}

export interface RootViewport {
  /** Root user units → mm. */
  userToMm: Matrix;
  /** Viewport size in mm (null dimension = unknown: no width/height/viewBox). */
  widthMm: number | null;
  heightMm: number | null;
  viewBox: ViewBox | null;
  /** Viewport size in root user units, used to resolve percentages. */
  userWidth: number;
  userHeight: number;
}

/**
 * Root scale from `width`/`height` (mm, cm, in, pt, pc, px, unitless = px at 96 dpi; `%` or
 * missing = the viewBox size in px) and `viewBox` + `preserveAspectRatio` (default xMidYMid meet).
 */
export function rootViewport(svg: Element): RootViewport {
  const vb = parseViewBox(svg.getAttribute('viewBox'));
  let w = lengthToMm(svg.getAttribute('width'));
  let h = lengthToMm(svg.getAttribute('height'));
  if (vb) {
    if (w == null && h == null) {
      w = vb.width * MM_PER_PX;
      h = vb.height * MM_PER_PX;
    } else if (w == null) {
      w = (h! * vb.width) / vb.height;
    } else if (h == null) {
      h = (w * vb.height) / vb.width;
    }
    const par = parsePreserveAspectRatio(svg.getAttribute('preserveAspectRatio'));
    return {
      userToMm: viewBoxTransform(vb, w, h!, par),
      widthMm: w,
      heightMm: h!,
      viewBox: vb,
      userWidth: vb.width,
      userHeight: vb.height,
    };
  }
  // No viewBox: user units are CSS px; width/height only size the viewport.
  return {
    userToMm: [MM_PER_PX, 0, 0, MM_PER_PX, 0, 0],
    widthMm: w,
    heightMm: h,
    viewBox: null,
    userWidth: w != null ? w / MM_PER_PX : 300,
    userHeight: h != null ? h / MM_PER_PX : 150,
  };
}
