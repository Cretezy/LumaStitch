// SPDX-License-Identifier: GPL-3.0-or-later
/** PathGeom constructors for primitive shapes (tools, tests). */
import type { PathGeom, Vec2 } from '@/model/types';

const KAPPA = 0.5522847498307936;

export function rectGeom(x: number, y: number, w: number, h: number, r = 0): PathGeom {
  if (r <= 0) {
    return {
      fillRule: 'nonzero',
      subpaths: [
        { closed: true, nodes: [{ p: [x, y] }, { p: [x + w, y] }, { p: [x + w, y + h] }, { p: [x, y + h] }] },
      ],
    };
  }
  r = Math.min(r, w / 2, h / 2);
  const k = r * KAPPA;
  return {
    fillRule: 'nonzero',
    subpaths: [
      {
        closed: true,
        nodes: [
          { p: [x + r, y], in: [-k, 0] },
          { p: [x + w - r, y], out: [k, 0] },
          { p: [x + w, y + r], in: [0, -k] },
          { p: [x + w, y + h - r], out: [0, k] },
          { p: [x + w - r, y + h], in: [k, 0] },
          { p: [x + r, y + h], out: [-k, 0] },
          { p: [x, y + h - r], in: [0, k] },
          { p: [x, y + r], out: [0, -k] },
        ],
      },
    ],
  };
}

export function ellipseGeom(cx: number, cy: number, rx: number, ry = rx): PathGeom {
  const kx = rx * KAPPA,
    ky = ry * KAPPA;
  return {
    fillRule: 'nonzero',
    subpaths: [
      {
        closed: true,
        nodes: [
          { p: [cx + rx, cy], in: [0, -ky], out: [0, ky], smooth: true },
          { p: [cx, cy + ry], in: [kx, 0], out: [-kx, 0], smooth: true },
          { p: [cx - rx, cy], in: [0, ky], out: [0, -ky], smooth: true },
          { p: [cx, cy - ry], in: [-kx, 0], out: [kx, 0], smooth: true },
        ],
      },
    ],
  };
}

export function polylineGeom(pts: Vec2[], closed = false): PathGeom {
  return {
    fillRule: 'nonzero',
    subpaths: [{ closed, nodes: pts.map((p) => ({ p: [p[0], p[1]] as Vec2 })) }],
  };
}

/** Combines several geoms into one compound path (e.g. outer + hole with evenodd). */
export function compound(geoms: PathGeom[], fillRule: 'nonzero' | 'evenodd' = 'evenodd'): PathGeom {
  return { fillRule, subpaths: geoms.flatMap((g) => g.subpaths) };
}
