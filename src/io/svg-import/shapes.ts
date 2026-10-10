// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Basic SVG shapes → path data in user units (ARCH §8.5 "Geometry"). Lengths may carry units
 * or percentages (resolved against the current viewport). Ellipses use 4 cubic Béziers.
 */
import { lengthToUser } from './units';

export const GEOMETRY_TAGS = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);

/** Circle-approximation constant for a quarter arc. */
const KAPPA = 0.5522847498307936;

const f = (n: number) => (Math.abs(n) < 1e-12 ? 0 : +n.toPrecision(15));

export interface Viewport {
  width: number;
  height: number;
}

function ellipsePath(cx: number, cy: number, rx: number, ry: number): string {
  const kx = rx * KAPPA;
  const ky = ry * KAPPA;
  // Start at (cx + rx, cy) and go clockwise on screen (y down), like the SVG spec's equivalent path.
  return [
    `M${f(cx + rx)} ${f(cy)}`,
    `C${f(cx + rx)} ${f(cy + ky)} ${f(cx + kx)} ${f(cy + ry)} ${f(cx)} ${f(cy + ry)}`,
    `C${f(cx - kx)} ${f(cy + ry)} ${f(cx - rx)} ${f(cy + ky)} ${f(cx - rx)} ${f(cy)}`,
    `C${f(cx - rx)} ${f(cy - ky)} ${f(cx - kx)} ${f(cy - ry)} ${f(cx)} ${f(cy - ry)}`,
    `C${f(cx + kx)} ${f(cy - ry)} ${f(cx + rx)} ${f(cy - ky)} ${f(cx + rx)} ${f(cy)}`,
    'Z',
  ].join(' ');
}

function rectPath(x: number, y: number, w: number, h: number, rx: number, ry: number): string {
  if (rx <= 0 || ry <= 0) return `M${f(x)} ${f(y)} H${f(x + w)} V${f(y + h)} H${f(x)} Z`;
  const kx = rx * (1 - KAPPA);
  const ky = ry * (1 - KAPPA);
  const r = x + w;
  const b = y + h;
  const parts = [`M${f(x + rx)} ${f(y)}`];
  if (w > 2 * rx) parts.push(`H${f(r - rx)}`);
  parts.push(`C${f(r - kx)} ${f(y)} ${f(r)} ${f(y + ky)} ${f(r)} ${f(y + ry)}`);
  if (h > 2 * ry) parts.push(`V${f(b - ry)}`);
  parts.push(`C${f(r)} ${f(b - ky)} ${f(r - kx)} ${f(b)} ${f(r - rx)} ${f(b)}`);
  if (w > 2 * rx) parts.push(`H${f(x + rx)}`);
  parts.push(`C${f(x + kx)} ${f(b)} ${f(x)} ${f(b - ky)} ${f(x)} ${f(b - ry)}`);
  if (h > 2 * ry) parts.push(`V${f(y + ry)}`);
  parts.push(`C${f(x)} ${f(y + ky)} ${f(x + kx)} ${f(y)} ${f(x + rx)} ${f(y)}`, 'Z');
  return parts.join(' ');
}

export function parsePoints(s: string | null): number[] {
  if (!s) return [];
  const nums = s.match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g)?.map(Number) ?? [];
  if (nums.length % 2) nums.pop();
  return nums;
}

/**
 * Path data for a geometry element in its own user space, or null if it renders nothing
 * (zero size, missing data, unknown tag).
 */
export function shapeToPathData(el: Element, vp: Viewport): string | null {
  const a = (name: string) => el.getAttribute(name);
  const W = vp.width;
  const H = vp.height;
  const D = Math.sqrt((W * W + H * H) / 2);
  switch (el.localName) {
    case 'path': {
      const d = a('d')?.trim();
      return d && /^[Mm]/.test(d) ? d : null;
    }
    case 'rect': {
      const x = lengthToUser(a('x'), W);
      const y = lengthToUser(a('y'), H);
      const w = lengthToUser(a('width'), W);
      const h = lengthToUser(a('height'), H);
      if (!(w > 0 && h > 0)) return null;
      const rxA = a('rx');
      const ryA = a('ry');
      const auto = (v: string | null) => v == null || v === 'auto';
      let rx = auto(rxA) ? NaN : lengthToUser(rxA, W, NaN);
      let ry = auto(ryA) ? NaN : lengthToUser(ryA, H, NaN);
      if (Number.isNaN(rx)) rx = Number.isNaN(ry) ? 0 : ry;
      if (Number.isNaN(ry)) ry = rx;
      rx = Math.min(Math.max(rx, 0), w / 2);
      ry = Math.min(Math.max(ry, 0), h / 2);
      return rectPath(x, y, w, h, rx, ry);
    }
    case 'circle': {
      const r = lengthToUser(a('r'), D);
      if (!(r > 0)) return null;
      return ellipsePath(lengthToUser(a('cx'), W), lengthToUser(a('cy'), H), r, r);
    }
    case 'ellipse': {
      const rxA = a('rx');
      const ryA = a('ry');
      let rx = rxA == null || rxA === 'auto' ? NaN : lengthToUser(rxA, W, NaN);
      let ry = ryA == null || ryA === 'auto' ? NaN : lengthToUser(ryA, H, NaN);
      if (Number.isNaN(rx)) rx = ry;
      if (Number.isNaN(ry)) ry = rx;
      if (!(rx > 0 && ry > 0)) return null;
      return ellipsePath(lengthToUser(a('cx'), W), lengthToUser(a('cy'), H), rx, ry);
    }
    case 'line': {
      const x1 = lengthToUser(a('x1'), W);
      const y1 = lengthToUser(a('y1'), H);
      const x2 = lengthToUser(a('x2'), W);
      const y2 = lengthToUser(a('y2'), H);
      return `M${f(x1)} ${f(y1)} L${f(x2)} ${f(y2)}`;
    }
    case 'polyline':
    case 'polygon': {
      const p = parsePoints(a('points'));
      if (p.length < 4) return null;
      let d = `M${f(p[0])} ${f(p[1])}`;
      for (let i = 2; i < p.length; i += 2) d += ` L${f(p[i])} ${f(p[i + 1])}`;
      return el.localName === 'polygon' ? d + ' Z' : d;
    }
    default:
      return null;
  }
}
