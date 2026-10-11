// SPDX-License-Identifier: GPL-3.0-or-later
/** Document commands. Each is one undo step. */
import type { Draft } from 'immer';
import { getStitchType, hasStitchType } from '@/engine/registry';
import { inheritedParams } from '@/engine/params/resolve';
import { compose, scale, translate } from '@/geom/matrix';
import { newId } from '@/lib/ids';
import { buildElementIndex, createElement, hasClosedSubpath, shapeElements } from '@/model/factories';
import { geomBBox, shapesBBox, transformElement, transformGeomM } from '@/model/geomOps';
import type {
  Design,
  DesignSettings,
  ElementRole,
  FabricId,
  FabricProfile,
  Hoop,
  Id,
  Matrix,
  ParamValue,
  PathGeom,
  SequenceEntry,
  Shape,
  StitchElement,
  StitchType,
  Thread,
  Vec2,
} from '@/model/types';
import { exec, useDoc } from '../documentStore';
import { useUi } from '../uiStore';

type D = Draft<Design>;

function findElement(
  d: D,
  id: Id,
): { shape: Draft<Shape>; el: Draft<StitchElement>; role: ElementRole } | null {
  for (const sid of Object.keys(d.shapes)) {
    const s = d.shapes[sid];
    if (s.fill?.id === id) return { shape: s, el: s.fill, role: 'fill' };
    if (s.outline?.id === id) return { shape: s, el: s.outline, role: 'outline' };
  }
  return null;
}

/** Element ids the element-level UI acts on: explicit element selection, else all elements of selected shapes. */
export function selectedElementIds(design: Design | null = useDoc.getState().design): Id[] {
  if (!design) return [];
  const sel = useUi.getState().selection;
  if (sel.elementIds.length) return sel.elementIds.filter((id) => buildElementIndex(design).has(id));
  const out: Id[] = [];
  for (const sid of sel.shapeIds) {
    const s = design.shapes[sid];
    if (s) for (const el of shapeElements(s)) out.push(el.id);
  }
  return out;
}

// ---------------------------------------------------------------------------- shapes

export interface NewShapes {
  shapes: Shape[];
  threads: Thread[];
}

/** Adds shapes (already with elements) and their threads; appends to zOrder and sequence. */
export function addShapes(label: string, input: NewShapes, opts: { select?: boolean } = {}): void {
  exec(
    label,
    (d) => {
      for (const t of input.threads) if (!d.threads[t.id]) d.threads[t.id] = t;
      for (const s of input.shapes) {
        d.shapes[s.id] = s;
        d.zOrder.push(s.id);
        if (s.fill) d.sequence.push({ kind: 'element', elementId: s.fill.id });
        if (s.outline) d.sequence.push({ kind: 'element', elementId: s.outline.id });
      }
    },
    opts.select !== false
      ? { selection: { shapeIds: input.shapes.map((s) => s.id), elementIds: [], nodes: [] } }
      : undefined,
  );
}

export function deleteShapes(ids: Id[]): void {
  if (!ids.length) return;
  const set = new Set(ids);
  exec(
    ids.length > 1 ? `Delete ${ids.length} shapes` : 'Delete shape',
    (d) => {
      const removedEls = new Set<Id>();
      for (const id of ids) {
        const s = d.shapes[id];
        if (!s) continue;
        if (s.fill) removedEls.add(s.fill.id);
        if (s.outline) removedEls.add(s.outline.id);
        delete d.shapes[id];
      }
      d.zOrder = d.zOrder.filter((id) => !set.has(id));
      d.sequence = d.sequence.filter((e) => e.kind === 'stop' || !removedEls.has(e.elementId));
    },
    { selection: { shapeIds: [], elementIds: [], nodes: [] } },
  );
}

function cloneShapeWithNewIds(s: Shape): Shape {
  const c: Shape = structuredClone(s);
  c.id = newId('s');
  if (c.fill) c.fill.id = newId('e');
  if (c.outline) c.outline.id = newId('e');
  return c;
}

export function duplicateShapes(ids: Id[], offset: Vec2 = [2, 2]): Id[] {
  const design = useDoc.getState().design;
  if (!design || !ids.length) return [];
  const newIds: Id[] = [];
  exec(
    'Duplicate',
    (d) => {
      const m = translate(offset[0], offset[1]);
      const ordered = d.zOrder.filter((id) => ids.includes(id));
      for (const id of ordered) {
        const src = design.shapes[id];
        const c = cloneShapeWithNewIds(src);
        c.name = src.name + ' copy';
        c.geom = transformGeomM(c.geom, m);
        for (const el of shapeElements(c)) transformElement(el, m, false, {});
        d.shapes[c.id] = c;
        newIds.push(c.id);
        // Above the original in zOrder.
        const zi = d.zOrder.indexOf(id);
        d.zOrder.splice(zi + 1, 0, c.id);
        // After the original's last element in sequence.
        const srcEls = shapeElements(src).map((e) => e.id);
        let si = -1;
        d.sequence.forEach((e, i) => {
          if (e.kind === 'element' && srcEls.includes(e.elementId)) si = i;
        });
        const entries: SequenceEntry[] = shapeElements(c).map((e) => ({ kind: 'element', elementId: e.id }));
        d.sequence.splice(si < 0 ? d.sequence.length : si + 1, 0, ...entries);
      }
    },
    {},
  );
  useUi.getState().setSelection({ shapeIds: newIds, elementIds: [], nodes: [] });
  return newIds;
}

function applyTransform(d: D, ids: Id[], m: Matrix) {
  for (const [key, group] of Object.entries(d.lettering ?? {})) {
    const hits = group.shapeIds.filter((id) => ids.includes(id));
    if (!hits.length) continue;
    if (hits.length === group.shapeIds.length) group.matrix = compose(m, group.matrix as Matrix);
    else if (!(hits.length === 1 && hits[0] === group.baselineShapeId)) delete d.lettering![key];
  }
  const scaleWidths = d.settings.scaleStrokeWidths;
  const s = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
  for (const id of ids) {
    const sh = d.shapes[id];
    if (!sh) continue;
    sh.geom = transformGeomM(sh.geom as PathGeom, m);
    for (const el of [sh.fill, sh.outline]) {
      if (!el) continue;
      const defAngle = hasStitchType(el.type)
        ? (inheritedParams(el.type, d.fabric, d.fabricProfile).angle as number | undefined)
        : undefined;
      transformElement(el as StitchElement, m, scaleWidths, { angle: defAngle });
    }
    if (scaleWidths && sh.art.strokeWidth && Math.abs(s - 1) > 1e-9)
      sh.art.strokeWidth = Math.round(sh.art.strokeWidth * s * 1000) / 1000;
  }
}

export function transformShapes(ids: Id[], m: Matrix, label = 'Transform'): void {
  if (!ids.length) return;
  exec(label, (d) => applyTransform(d, ids, m));
}

/** Applies a different matrix to each shape, as one undo step. */
export function transformShapesEach(moves: [Id, Matrix][], label = 'Transform'): void {
  if (!moves.length) return;
  exec(label, (d) => {
    for (const [id, m] of moves) applyTransform(d, [id], m);
  });
}

/** True if the geometry still has something to draw (a subpath with ≥ 2 nodes). */
function hasDrawable(g: PathGeom): boolean {
  return g.subpaths.some((sp) => sp.nodes.length >= 2);
}

function applyGeom(d: D, shapeId: Id, geom: PathGeom) {
  const s = d.shapes[shapeId];
  if (!s) return;
  if (!hasDrawable(geom)) {
    // Nothing left (e.g. every node deleted): remove the shape and its elements.
    const els = new Set([s.fill?.id, s.outline?.id].filter(Boolean) as Id[]);
    delete d.shapes[shapeId];
    d.zOrder = d.zOrder.filter((id) => id !== shapeId);
    d.sequence = d.sequence.filter((e) => e.kind === 'stop' || !els.has(e.elementId));
    return;
  }
  s.geom = geom;
  if (s.fill && !hasClosedSubpath(geom)) {
    const fid = s.fill.id;
    s.fill = null;
    d.sequence = d.sequence.filter((e) => e.kind === 'stop' || e.elementId !== fid);
  }
}

export function setShapeGeom(shapeId: Id, geom: PathGeom, label = 'Edit path'): void {
  setShapeGeoms([[shapeId, geom]], label);
}

/** Sets several shapes' geometry as one undo step. */
export function setShapeGeoms(changes: [Id, PathGeom][], label = 'Edit path'): void {
  if (!changes.length) return;
  exec(label, (d) => {
    for (const [id, g] of changes) applyGeom(d, id, g);
  });
  const ui = useUi.getState();
  const d = useDoc.getState().design;
  if (d && ui.selection.shapeIds.some((id) => !d.shapes[id]))
    ui.setSelection({
      shapeIds: ui.selection.shapeIds.filter((id) => d.shapes[id]),
      nodes: [],
      elementIds: [],
    });
}

export function setShapeProps(
  ids: Id[],
  props: Partial<Pick<Shape, 'name' | 'hidden' | 'locked'>>,
  label = 'Change shape',
): void {
  exec(label, (d) => {
    for (const id of ids) {
      const s = d.shapes[id];
      if (!s) continue;
      if (props.name !== undefined) s.name = props.name;
      if (props.hidden !== undefined) s.hidden = props.hidden || undefined;
      if (props.locked !== undefined) s.locked = props.locked || undefined;
    }
  });
}

export function arrange(ids: Id[], how: 'front' | 'back' | 'forward' | 'backward'): void {
  if (!ids.length) return;
  exec('Arrange', (d) => {
    const set = new Set(ids);
    const z = d.zOrder.slice();
    if (how === 'front') d.zOrder = [...z.filter((id) => !set.has(id)), ...z.filter((id) => set.has(id))];
    else if (how === 'back') d.zOrder = [...z.filter((id) => set.has(id)), ...z.filter((id) => !set.has(id))];
    else if (how === 'forward') {
      for (let i = z.length - 2; i >= 0; i--)
        if (set.has(z[i]) && !set.has(z[i + 1])) [z[i], z[i + 1]] = [z[i + 1], z[i]];
      d.zOrder = z;
    } else {
      for (let i = 1; i < z.length; i++)
        if (set.has(z[i]) && !set.has(z[i - 1])) [z[i], z[i - 1]] = [z[i - 1], z[i]];
      d.zOrder = z;
    }
  });
}

// ---------------------------------------------------------------------------- elements

function threadForRole(d: D, s: Draft<Shape>, role: ElementRole): Id {
  const color = role === 'fill' ? (s.art.fill ?? s.art.stroke) : (s.art.stroke ?? s.art.fill);
  const other = role === 'fill' ? s.outline : s.fill;
  if (color) {
    const t = Object.values(d.threads).find((t) => t.color.toLowerCase() === color.toLowerCase());
    if (t) return t.id;
  }
  if (other) return other.threadId;
  const first = Object.keys(d.threads)[0];
  if (first) return first;
  const t: Thread = { id: newId('t'), name: color ?? '#000000', color: color ?? '#000000' };
  d.threads[t.id] = t;
  return t.id;
}

export function setElementEnabled(shapeIds: Id[], role: ElementRole, enabled: boolean): void {
  exec(enabled ? `Add ${role}` : `Remove ${role}`, (d) => {
    for (const sid of shapeIds) {
      const s = d.shapes[sid];
      if (!s) continue;
      const cur = role === 'fill' ? s.fill : s.outline;
      if (enabled && !cur) {
        if (role === 'fill' && !hasClosedSubpath(s.geom as PathGeom)) continue;
        const el = createElement(role, role === 'fill' ? 'tatami' : 'running', threadForRole(d, s, role));
        if (role === 'fill') s.fill = el;
        else s.outline = el;
        // Insert next to the sibling element: fill before outline.
        const sib = role === 'fill' ? s.outline : s.fill;
        const si = sib ? d.sequence.findIndex((e) => e.kind === 'element' && e.elementId === sib.id) : -1;
        const entry: SequenceEntry = { kind: 'element', elementId: el.id };
        if (si < 0) d.sequence.push(entry);
        else d.sequence.splice(role === 'fill' ? si : si + 1, 0, entry);
      } else if (!enabled && cur) {
        const id = cur.id;
        if (role === 'fill') s.fill = null;
        else s.outline = null;
        d.sequence = d.sequence.filter((e) => e.kind === 'stop' || e.elementId !== id);
      }
    }
  });
}

export function setElementType(elementIds: Id[], type: StitchType): void {
  const def = getStitchType(type);
  exec(`Set type ${def.label}`, (d) => {
    for (const id of elementIds) {
      const f = findElement(d, id);
      if (!f || f.role !== def.role || f.el.type === type) continue;
      // Keep overrides that the new type understands.
      const keep: Record<string, ParamValue> = {};
      for (const k of Object.keys(f.el.params)) if (k in def.defaults) keep[k] = f.el.params[k];
      f.el.type = type;
      f.el.params = keep;
      f.el.userEdited = true;
    }
  });
}

export function setParams(
  elementIds: Id[],
  patch: Record<string, ParamValue>,
  label = 'Change settings',
): void {
  exec(label, (d) => {
    for (const id of elementIds) {
      const f = findElement(d, id);
      if (!f) continue;
      const def = getStitchType(f.el.type);
      for (const [k, v] of Object.entries(patch)) {
        if (!(k in def.defaults)) continue;
        f.el.params[k] = v;
      }
      f.el.userEdited = true;
    }
  });
}

export function resetParam(elementIds: Id[], key: string): void {
  exec('Reset setting', (d) => {
    for (const id of elementIds) {
      const f = findElement(d, id);
      if (f && key in f.el.params) delete f.el.params[key];
    }
  });
}

export function setElementProps(
  elementIds: Id[],
  props: Partial<
    Pick<
      StitchElement,
      'tieIn' | 'tieOut' | 'trimAfter' | 'threadId' | 'entry' | 'exit' | 'guides' | 'railSplit'
    >
  >,
  label = 'Change element',
): void {
  exec(label, (d) => {
    for (const id of elementIds) {
      const f = findElement(d, id);
      if (!f) continue;
      for (const [k, v] of Object.entries(props)) {
        if (v === undefined) delete (f.el as any)[k];
        else (f.el as any)[k] = v;
      }
      f.el.userEdited = true;
    }
  });
}

export function clearEntryExit(elementIds: Id[], which: 'entry' | 'exit' | 'both'): void {
  exec('Reset entry/exit', (d) => {
    for (const id of elementIds) {
      const f = findElement(d, id);
      if (!f) continue;
      if (which !== 'exit') delete f.el.entry;
      if (which !== 'entry') delete f.el.exit;
    }
  });
}

// ---------------------------------------------------------------------------- threads

export function upsertThread(t: Thread, label = 'Edit thread'): void {
  exec(label, (d) => {
    d.threads[t.id] = t;
  });
}

/** Adds a thread (or reuses one with the same colour+code) and assigns it to elements. */
export function assignNewThread(elementIds: Id[], t: Omit<Thread, 'id'>): void {
  exec('Assign thread', (d) => {
    let th = Object.values(d.threads).find(
      (x) => x.color === t.color && (x.code ?? '') === (t.code ?? '') && (x.chart ?? '') === (t.chart ?? ''),
    );
    if (!th) {
      th = { id: newId('t'), ...t };
      d.threads[th.id] = th;
    }
    for (const id of elementIds) {
      const f = findElement(d, id);
      if (f) {
        f.el.threadId = th.id;
        f.el.userEdited = true;
      }
    }
  });
}

export function deleteThread(id: Id, replacement?: Id): void {
  exec('Delete thread', (d) => {
    const used = Object.values(d.shapes).some((s) => s.fill?.threadId === id || s.outline?.threadId === id);
    if (used) {
      if (!replacement || !d.threads[replacement]) return;
      for (const s of Object.values(d.shapes))
        for (const el of [s.fill, s.outline]) if (el && el.threadId === id) el.threadId = replacement;
    }
    delete d.threads[id];
  });
}

/** Removes threads no element uses. */
export function purgeUnusedThreads(): void {
  exec('Remove unused threads', (d) => {
    const used = new Set<Id>();
    for (const s of Object.values(d.shapes))
      for (const el of [s.fill, s.outline]) if (el) used.add(el.threadId);
    for (const id of Object.keys(d.threads)) if (!used.has(id)) delete d.threads[id];
  });
}

// ---------------------------------------------------------------------------- sequence

export function reorderSequence(seq: SequenceEntry[], label = 'Reorder'): void {
  exec(label, (d) => {
    d.sequence = seq;
  });
}

export function moveElements(ids: Id[], how: 'up' | 'down' | 'start' | 'end'): void {
  if (!ids.length) return;
  const set = new Set(ids);
  const key = (e: SequenceEntry) => (e.kind === 'element' ? e.elementId : e.id);
  exec('Move in sequence', (d) => {
    const seq = d.sequence.slice();
    if (how === 'start')
      d.sequence = [...seq.filter((e) => set.has(key(e))), ...seq.filter((e) => !set.has(key(e)))];
    else if (how === 'end')
      d.sequence = [...seq.filter((e) => !set.has(key(e))), ...seq.filter((e) => set.has(key(e)))];
    else if (how === 'up') {
      for (let i = 1; i < seq.length; i++)
        if (set.has(key(seq[i])) && !set.has(key(seq[i - 1]))) [seq[i], seq[i - 1]] = [seq[i - 1], seq[i]];
      d.sequence = seq;
    } else {
      for (let i = seq.length - 2; i >= 0; i--)
        if (set.has(key(seq[i])) && !set.has(key(seq[i + 1]))) [seq[i], seq[i + 1]] = [seq[i + 1], seq[i]];
      d.sequence = seq;
    }
  });
}

export function insertStop(index: number, note?: string): Id {
  const id = newId('stop');
  exec('Insert stop', (d) => {
    d.sequence.splice(Math.max(0, Math.min(index, d.sequence.length)), 0, { kind: 'stop', id, note });
  });
  return id;
}

export function removeStop(id: Id): void {
  exec('Remove stop', (d) => {
    d.sequence = d.sequence.filter((e) => !(e.kind === 'stop' && e.id === id));
  });
}

// ---------------------------------------------------------------------------- design

export function setDesignSettings(patch: Partial<DesignSettings>, label = 'Design settings'): void {
  exec(label, (d) => {
    Object.assign(d.settings, patch);
  });
}

export function setDesignProps(
  props: {
    name?: string;
    fabric?: FabricId;
    fabricColor?: string;
    threadChart?: string;
    hoop?: Hoop | null;
    fabricProfile?: FabricProfile | null;
  },
  label = 'Design settings',
): void {
  exec(label, (d) => {
    if (props.hoop !== undefined) {
      if (props.hoop === null) delete d.hoop;
      else d.hoop = props.hoop;
    }
    if (props.name !== undefined) d.name = props.name;
    if (props.fabric !== undefined) {
      d.fabric = props.fabric;
      delete d.fabricProfile;
    }
    if (props.fabricProfile !== undefined) {
      if (props.fabricProfile === null) delete d.fabricProfile;
      else {
        d.fabricProfile = props.fabricProfile;
        d.fabric = props.fabricProfile.baseFabric;
      }
    }
    if (props.fabricColor !== undefined) d.fabricColor = props.fabricColor;
    if (props.threadChart !== undefined) d.threadChart = props.threadChart;
  });
}

/** Design size = bounds of all visible shapes. */
export function designBBox(design: Design) {
  return shapesBBox(Object.values(design.shapes).filter((s) => !s.hidden));
}

/** Resizes the whole design about its centre; stitches are regenerated so density stays correct. */
export function resizeDesign(width?: number, height?: number, lockAspect = true): void {
  const design = useDoc.getState().design;
  if (!design) return;
  const b = designBBox(design);
  const w = b.maxX - b.minX,
    h = b.maxY - b.minY;
  if (!(w > 0) && !(h > 0)) return;
  let sx = 1,
    sy = 1;
  if (width !== undefined && w > 0) sx = width / w;
  if (height !== undefined && h > 0) sy = height / h;
  if (lockAspect) {
    if (width !== undefined) sy = sx;
    else sx = sy;
  }
  if (!(sx > 0 && sy > 0) || (Math.abs(sx - 1) < 1e-9 && Math.abs(sy - 1) < 1e-9)) return;
  const cx = (b.minX + b.maxX) / 2,
    cy = (b.minY + b.maxY) / 2;
  const m = scale(sx, sy, cx, cy);
  exec('Resize design', (d) => {
    applyTransform(d, Object.keys(d.shapes), m);
    if (d.artwork) d.artwork.matrix = compose(m, d.artwork.matrix as Matrix);
  });
}

export function setArtwork(props: { visible?: boolean; opacity?: number }): void {
  exec('Backdrop', (d) => {
    if (!d.artwork) return;
    if (props.visible !== undefined) d.artwork.visible = props.visible;
    if (props.opacity !== undefined) d.artwork.opacity = props.opacity;
  });
}

export function removeArtwork(): void {
  exec('Remove backdrop', (d) => {
    delete d.artwork;
  });
}

export { geomBBox };
