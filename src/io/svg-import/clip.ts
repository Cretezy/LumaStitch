// SPDX-License-Identifier: GPL-3.0-or-later
/** `clip-path` support (SPEC §3.1 P1): the clip region is built in mm and intersected via Paper. */
import { multiply } from '@/geom/matrix';
import { booleanGeoms, parsePathDataPaper } from '@/geom/paperAdapter';
import type { Matrix, PathGeom } from '@/model/types';
import { GEOMETRY_TAGS, shapeToPathData, type Viewport } from './shapes';
import { elementTransform } from './tree';

export type ClipResult = { ok: true; geom: PathGeom } | { ok: false; reason: string };

/**
 * Geometry (mm) of a `<clipPath>` referenced by `target`, whose user space maps to mm by
 * `targetMatrix` (including the target's own transform). Returns `{ ok: false }` for content we
 * cannot turn into geometry (e.g. text), in which case the clip is ignored with a warning.
 */
export function clipRegion(clipEl: Element, target: Element, targetMatrix: Matrix, vp: Viewport): ClipResult {
  let base = multiply(targetMatrix, elementTransform(clipEl));
  if (clipEl.getAttribute('clipPathUnits') === 'objectBoundingBox') {
    let b: DOMRect;
    try {
      b = (target as SVGGraphicsElement).getBBox();
    } catch {
      return { ok: false, reason: 'bbox' };
    }
    if (!(b.width > 0 && b.height > 0)) return { ok: true, geom: { fillRule: 'nonzero', subpaths: [] } };
    base = multiply(base, [b.width, 0, 0, b.height, b.x, b.y]);
  }
  const geoms: PathGeom[] = [];
  let failure: string | null = null;
  const visit = (el: Element, m: Matrix) => {
    for (const child of Array.from(el.children)) {
      const cs = getComputedStyle(child);
      if (cs.display === 'none') continue;
      const tag = child.localName;
      const cm = multiply(m, elementTransform(child, cs));
      if (tag === 'g' || tag === 'svg') {
        visit(child, cm);
      } else if (GEOMETRY_TAGS.has(tag)) {
        if (cs.visibility === 'hidden' || cs.visibility === 'collapse') continue;
        const d = shapeToPathData(child, vp);
        if (!d) continue;
        const rule = cs.getPropertyValue('clip-rule') === 'evenodd' ? 'evenodd' : 'nonzero';
        const g = parsePathDataPaper(d, cm, rule);
        // Clip regions are areas: open subpaths are implicitly closed.
        for (const sp of g.subpaths) sp.closed = true;
        geoms.push(g);
      } else if (tag === 'text' || tag === 'image') {
        failure = tag;
      }
    }
  };
  visit(clipEl, base);
  if (failure) return { ok: false, reason: failure };
  if (geoms.length === 0) return { ok: true, geom: { fillRule: 'nonzero', subpaths: [] } };
  if (geoms.length === 1) return { ok: true, geom: geoms[0] };
  const [u] = booleanGeoms('unite', geoms);
  return { ok: true, geom: u ?? { fillRule: 'nonzero', subpaths: [] } };
}
