// SPDX-License-Identifier: GPL-3.0-or-later
/** Geometric shape hit testing (used when shapes are drawn on a canvas instead of as SVG elements). */
import { flattenGeom } from '@/geom/flatten';
import { pointInRing, segDist2 } from '@/geom/polygon';
import type { Design, Id, PathGeom, Vec2 } from '@/model/types';
import { shapeBBox } from '@/tools/selection';

const flatCache = new WeakMap<PathGeom, ReturnType<typeof flattenGeom>>();

function flat(g: PathGeom) {
  let f = flatCache.get(g);
  if (!f) {
    f = flattenGeom(g, 0.1);
    flatCache.set(g, f);
  }
  return f;
}

/** Topmost visible, unlocked shape under `p` (inside a closed area, or within `tol` mm of a path). */
export function hitShape(design: Design, p: Vec2, tol: number): Id | null {
  for (let i = design.zOrder.length - 1; i >= 0; i--) {
    const id = design.zOrder[i];
    const s = design.shapes[id];
    if (!s || s.hidden || s.locked) continue;
    const b = shapeBBox(design, id);
    if (!b || p[0] < b.minX - tol || p[0] > b.maxX + tol || p[1] < b.minY - tol || p[1] > b.maxY + tol)
      continue;
    const f = flat(s.geom);
    if (s.fill || s.art.fill) {
      let inside = false;
      if (s.geom.fillRule === 'evenodd') {
        for (const r of f.rings) if (pointInRing(r, p[0], p[1])) inside = !inside;
      } else {
        // Nonzero approximated as "inside an odd number of rings" is wrong for overlaps; use winding.
        let wn = 0;
        for (const r of f.rings) {
          const n = r.length;
          for (let k = 0, j = n - 2; k < n; j = k, k += 2) {
            const ax = r[j],
              ay = r[j + 1],
              bx = r[k],
              by = r[k + 1];
            const cross = (bx - ax) * (p[1] - ay) - (p[0] - ax) * (by - ay);
            if (ay <= p[1]) {
              if (by > p[1] && cross > 0) wn++;
            } else if (by <= p[1] && cross < 0) wn--;
          }
        }
        inside = wn !== 0;
      }
      if (inside) return id;
    }
    const t2 = tol * tol;
    const near = (pl: Float64Array, closed: boolean) => {
      const n = pl.length;
      for (let k = 2; k < n + (closed ? 2 : 0); k += 2) {
        const a = k - 2,
          bb = k % n;
        if (segDist2(p[0], p[1], pl[a], pl[a + 1], pl[bb], pl[bb + 1])[0] <= t2) return true;
      }
      return false;
    };
    for (const r of f.rings) if (near(r, true)) return id;
    for (const l of f.polylines) if (near(l, false)) return id;
  }
  return null;
}
