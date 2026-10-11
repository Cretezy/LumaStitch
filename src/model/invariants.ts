// SPDX-License-Identifier: GPL-3.0-or-later
import { buildElementIndex, hasClosedSubpath } from './factories';
import type { Design } from './types';

/** Returns a list of invariant violations (empty when the design is consistent). */
export function checkInvariants(d: Design): string[] {
  const errors: string[] = [];
  const index = buildElementIndex(d);
  const seen = new Set<string>();
  for (const e of d.sequence) {
    if (e.kind !== 'element') continue;
    if (!index.has(e.elementId)) errors.push(`sequence references missing element ${e.elementId}`);
    if (seen.has(e.elementId)) errors.push(`element ${e.elementId} appears twice in sequence`);
    seen.add(e.elementId);
  }
  for (const id of index.keys()) if (!seen.has(id)) errors.push(`element ${id} missing from sequence`);
  const shapeIds = Object.keys(d.shapes);
  const z = new Set(d.zOrder);
  if (z.size !== d.zOrder.length) errors.push('zOrder has duplicates');
  if (z.size !== shapeIds.length || shapeIds.some((id) => !z.has(id)))
    errors.push('zOrder is not a permutation of shape ids');
  for (const id of shapeIds) {
    const s = d.shapes[id];
    if (s.id !== id) errors.push(`shape key ${id} != id ${s.id}`);
    for (const el of [s.fill, s.outline]) {
      if (el && !d.threads[el.threadId])
        errors.push(`element ${el.id} references missing thread ${el.threadId}`);
    }
    if (s.fill && !hasClosedSubpath(s.geom)) errors.push(`shape ${id} has a fill but no closed subpath`);
    if (s.fill && s.fill.role !== 'fill') errors.push(`shape ${id} fill has role ${s.fill.role}`);
    if (s.outline && s.outline.role !== 'outline')
      errors.push(`shape ${id} outline has role ${s.outline.role}`);
  }
  return errors;
}

/**
 * Repairs what can be repaired automatically (used after loading untrusted files):
 * drops dangling sequence entries, appends missing elements, fixes zOrder, removes fills of open shapes.
 */
export function repairDesign(d: Design): Design {
  const shapeIds = Object.keys(d.shapes);
  for (const id of shapeIds) {
    const s = d.shapes[id];
    if (s.fill && !hasClosedSubpath(s.geom)) s.fill = null;
  }
  const index = buildElementIndex(d);
  const seen = new Set<string>();
  d.sequence = d.sequence.filter((e) => {
    if (e.kind === 'stop') return true;
    if (!index.has(e.elementId) || seen.has(e.elementId)) return false;
    seen.add(e.elementId);
    return true;
  });
  for (const id of index.keys()) if (!seen.has(id)) d.sequence.push({ kind: 'element', elementId: id });
  const z = d.zOrder.filter((id, i) => d.shapes[id] && d.zOrder.indexOf(id) === i);
  for (const id of shapeIds) if (!z.includes(id)) z.push(id);
  d.zOrder = z;
  // Missing threads: create a black one.
  for (const id of shapeIds) {
    const s = d.shapes[id];
    for (const el of [s.fill, s.outline]) {
      if (el && !d.threads[el.threadId])
        d.threads[el.threadId] = { id: el.threadId, name: 'Missing thread', color: '#000000' };
    }
  }
  for (const [id, group] of Object.entries(d.lettering ?? {}))
    if (!group.shapeIds.length || group.shapeIds.some((sid) => !d.shapes[sid])) delete d.lettering![id];
  return d;
}
