// SPDX-License-Identifier: GPL-3.0-or-later
/** Keep both stitch elements of a source shape in one field whenever the sewn program fits. */
import { COMMAND_MASK, type StitchPlan } from '@/engine/types';
import type { Design, Vec2 } from '@/model/types';
import { toLocal, type Placement } from './placement';

export interface WholeObject {
  shapeId: string;
  name: string;
  elementIds: string[];
  field: number;
}
export function assignWholeObjects(
  design: Design,
  plan: StitchPlan,
  fields: Placement[],
  width: number,
  height: number,
) {
  const ownerToShape = new Map<string, string>();
  for (const shape of Object.values(design.shapes))
    for (const el of [shape.fill, shape.outline]) if (el) ownerToShape.set(el.id, shape.id);
  const keys = plan.elementIds.map((id) => ownerToShape.get(id));
  const groups = new Map<
    string,
    { candidates: number[]; minX: number; minY: number; maxX: number; maxY: number; indices: Set<number> }
  >();
  type Box = { minX: number; minY: number; maxX: number; maxY: number };
  const cells = new Map<string, Map<string, Box & { segments: Box[] }>>();
  const intersects = (a: Box, b: Box) =>
    a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;
  let entries = 0;
  const addFootprint = (key: string, a: Vec2, b: Vec2) => {
    // A half-millimetre exclusion band around each sewn chord prevents changing relative
    // layer order where thread paths touch. Cell-local bounding boxes are conservative:
    // false positives leave seams unchanged rather than moving potentially overlapping ink.
    const box = {
      minX: Math.min(a[0], b[0]) - 0.25,
      minY: Math.min(a[1], b[1]) - 0.25,
      maxX: Math.max(a[0], b[0]) + 0.25,
      maxY: Math.max(a[1], b[1]) + 0.25,
    };
    const x0 = Math.floor(box.minX / 10),
      x1 = Math.floor(box.maxX / 10),
      y0 = Math.floor(box.minY / 10),
      y1 = Math.floor(box.maxY / 10);
    entries += (x1 - x0 + 1) * (y1 - y0 + 1);
    if (entries > 1000000)
      throw new Error(
        'Whole-object overlap checking exceeds the work limit. Disable keeping whole objects or split the source design.',
      );
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++) {
        const cellKey = `${x},${y}`;
        let cell = cells.get(cellKey);
        if (!cell) {
          cell = new Map();
          cells.set(cellKey, cell);
        }
        const part = {
            minX: Math.max(box.minX, x * 10),
            maxX: Math.min(box.maxX, (x + 1) * 10),
            minY: Math.max(box.minY, y * 10),
            maxY: Math.min(box.maxY, (y + 1) * 10),
          },
          old = cell.get(key);
        if (old) {
          old.minX = Math.min(old.minX, part.minX);
          old.minY = Math.min(old.minY, part.minY);
          old.maxX = Math.max(old.maxX, part.maxX);
          old.maxY = Math.max(old.maxY, part.maxY);
          old.segments.push(part);
        } else cell.set(key, { ...part, segments: [part] });
      }
  };
  let previous: Vec2 | null = null,
    work = 0;
  for (let i = 0; i < plan.flags.length; i++) {
    if (plan.flags[i] & COMMAND_MASK) {
      previous = null;
      continue;
    }
    const p: Vec2 = [Math.round(plan.x[i] * 10) / 10, Math.round(plan.y[i] * 10) / 10],
      key = keys[plan.element[i]];
    if (key) {
      addFootprint(key, previous ?? p, p);
      let group = groups.get(key);
      if (!group) {
        group = {
          candidates: fields.map((_, i) => i),
          minX: Infinity,
          minY: Infinity,
          maxX: -Infinity,
          maxY: -Infinity,
          indices: new Set(),
        };
        groups.set(key, group);
      }
      group.indices.add(plan.element[i]);
      for (const point of previous ? [previous, p] : [p]) {
        group.minX = Math.min(group.minX, point[0]);
        group.maxX = Math.max(group.maxX, point[0]);
        group.minY = Math.min(group.minY, point[1]);
        group.maxY = Math.max(group.maxY, point[1]);
        work += group.candidates.length;
        if (work > 30000000)
          throw new Error(
            'Whole-object assignment exceeds the geometry work limit. Use fewer fields or disable keeping whole objects.',
          );
        group.candidates = group.candidates.filter((index) => {
          const local = toLocal(point, fields[index]);
          return (
            Math.abs(local[0]) <= (width - 1) / 2 + 1e-7 && Math.abs(local[1]) <= (height - 1) / 2 + 1e-7
          );
        });
      }
    }
    // Include the incoming endpoint of a sewn connector, even when it belongs to another
    // object. Convex field containment of both endpoints proves the entire chord fits.
    previous = p;
  }
  const blocked = new Set<string>();
  for (const cell of cells.values()) {
    const items = [...cell];
    for (let i = 0; i < items.length; i++)
      for (let j = i + 1; j < items.length; j++) {
        if (blocked.has(items[i][0]) && blocked.has(items[j][0])) continue;
        if (++work > 30000000)
          throw new Error(
            'Whole-object overlap checking exceeds the work limit. Disable keeping whole objects or split the source design.',
          );
        const a = items[i][1],
          b = items[j][1];
        if (
          intersects(a, b) &&
          a.segments.some((sa) =>
            b.segments.some((sb) => {
              if (++work > 30000000)
                throw new Error(
                  'Whole-object overlap checking exceeds the work limit. Disable keeping whole objects or split the source design.',
                );
              return intersects(sa, sb);
            }),
          )
        ) {
          blocked.add(items[i][0]);
          blocked.add(items[j][0]);
        }
      }
  }
  const owners = new Int16Array(plan.elementIds.length).fill(-1),
    objects: WholeObject[] = [];
  for (const [shapeId, group] of groups) {
    if (!group.candidates.length || blocked.has(shapeId)) continue;
    const center: Vec2 = [(group.minX + group.maxX) / 2, (group.minY + group.maxY) / 2];
    group.candidates.sort(
      (a, b) =>
        Math.hypot(fields[a].center[0] - center[0], fields[a].center[1] - center[1]) -
          Math.hypot(fields[b].center[0] - center[0], fields[b].center[1] - center[1]) || a - b,
    );
    const field = group.candidates[0];
    for (const owner of group.indices) owners[owner] = field;
    objects.push({
      shapeId,
      name: design.shapes[shapeId].name,
      elementIds: [...group.indices].map((i) => plan.elementIds[i]),
      field,
    });
  }
  return { owners, objects };
}
