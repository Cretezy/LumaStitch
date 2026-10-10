// SPDX-License-Identifier: GPL-3.0-or-later
/** Selection geometry helpers shared by tools and the overlay. */
import { apply } from '@/geom/matrix';
import { emptyBBox, extendBBox, isEmptyBBox } from '@/geom/polygon';
import type { BBox } from '@/geom/types';
import { geomBBox } from '@/model/geomOps';
import type { Design, Id, Matrix } from '@/model/types';

const bboxCache = new WeakMap<object, BBox>();

export function shapeBBox(design: Design, id: Id): BBox | null {
  const s = design.shapes[id];
  if (!s) return null;
  let b = bboxCache.get(s.geom);
  if (!b) {
    b = geomBBox(s.geom);
    bboxCache.set(s.geom, b);
  }
  return isEmptyBBox(b) ? null : b;
}

export function selectionBBox(design: Design, ids: Id[], m?: Matrix | null): BBox | null {
  const b = emptyBBox();
  for (const id of ids) {
    const sb = shapeBBox(design, id);
    if (!sb) continue;
    if (m) {
      for (const p of [
        [sb.minX, sb.minY],
        [sb.maxX, sb.minY],
        [sb.maxX, sb.maxY],
        [sb.minX, sb.maxY],
      ] as [number, number][])
        extendBBox(b, apply(m, p));
    } else extendBBox(b, [sb.minX, sb.minY, sb.maxX, sb.maxY]);
  }
  return isEmptyBBox(b) ? null : b;
}

export function selectableShapes(design: Design): Id[] {
  return design.zOrder.filter((id) => !design.shapes[id]?.hidden && !design.shapes[id]?.locked);
}

/** Shapes whose bbox intersects (or is contained in) the rectangle. */
export function shapesInRect(design: Design, r: BBox, contained = false): Id[] {
  const out: Id[] = [];
  for (const id of selectableShapes(design)) {
    const b = shapeBBox(design, id);
    if (!b) continue;
    const inter = !(b.maxX < r.minX || b.minX > r.maxX || b.maxY < r.minY || b.minY > r.maxY);
    const inside = b.minX >= r.minX && b.maxX <= r.maxX && b.minY >= r.minY && b.maxY <= r.maxY;
    if (contained ? inside : inter) out.push(id);
  }
  return out;
}
