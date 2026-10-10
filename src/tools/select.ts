// SPDX-License-Identifier: GPL-3.0-or-later
/** Select tool: click/shift-click/marquee select, move, scale (handles), rotate (corner zones). */
import { rotateScreen, scale, translate } from '@/geom/matrix';
import type { BBox } from '@/geom/types';
import type { Id, Matrix, Vec2 } from '@/model/types';
import { deleteShapes, duplicateShapes, transformShapes } from '@/store/commands';
import { useUi } from '@/store/uiStore';
import { selectionBBox, shapesInRect } from './selection';
import { markerCancel, markerDown, markerMove, markerUp } from './markerDrag';
import type { CanvasPointerEvent, Tool } from './types';

type Drag =
  | { kind: 'move'; start: Vec2; screen: Vec2; ids: Id[]; moved: boolean }
  | { kind: 'scale'; handle: string; start: Vec2; bbox: BBox; ids: Id[] }
  | { kind: 'rotate'; start: Vec2; center: Vec2; ids: Id[] }
  | { kind: 'marquee'; start: Vec2; additive: boolean; base: Id[] }
  | null;

let drag: Drag = null;
let lastMatrix: Matrix | null = null;

const setPreview = (ids: Id[], m: Matrix | null) => {
  lastMatrix = m;
  useUi.getState().set({ dragPreview: m ? { kind: 'transform', shapeIds: ids, matrix: m } : null });
};

/** Apply the click selection logic for a hit; returns the shapes now selected. */
export function selectHit(e: CanvasPointerEvent): Id[] {
  const ui = useUi.getState();
  const sel = ui.selection;
  const hit = e.hit;
  if (!hit || (hit.kind !== 'shape' && hit.kind !== 'element')) return sel.shapeIds;
  const sid = hit.shapeId;
  const elementIds = hit.kind === 'element' ? [hit.elementId] : [];
  if (e.mods.shift) {
    const has = sel.shapeIds.includes(sid);
    const shapeIds = has ? sel.shapeIds.filter((x) => x !== sid) : [...sel.shapeIds, sid];
    const els =
      hit.kind === 'element'
        ? has
          ? sel.elementIds.filter((x) => x !== hit.elementId)
          : [...sel.elementIds, hit.elementId]
        : sel.elementIds;
    ui.setSelection({ shapeIds, elementIds: els, nodes: [] });
    return shapeIds;
  }
  if (!sel.shapeIds.includes(sid) || hit.kind === 'element') {
    ui.setSelection({ shapeIds: [sid], elementIds, nodes: [] });
    return [sid];
  }
  return sel.shapeIds;
}

function anchorFor(handle: string, b: BBox, center: boolean): Vec2 {
  if (center) return [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
  const x = handle.includes('w') ? b.maxX : handle.includes('e') ? b.minX : (b.minX + b.maxX) / 2;
  const y = handle.includes('n') ? b.maxY : handle.includes('s') ? b.minY : (b.minY + b.maxY) / 2;
  return [x, y];
}

export const selectTool: Tool = {
  id: 'select',
  label: 'Select',
  cursor: 'default',
  shortcut: 'V',
  onPointerDown(e, ctx) {
    if (e.button !== 0) return;
    if (markerDown(e)) return;
    const ui = useUi.getState();
    const hit = e.hit;
    if (hit?.kind === 'handle') {
      const ids = ui.selection.shapeIds.filter((id) => !ctx.design.shapes[id]?.locked);
      const b = selectionBBox(ctx.design, ids);
      if (!b) return;
      if (hit.handle.startsWith('rotate'))
        drag = { kind: 'rotate', start: e.doc, center: [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2], ids };
      else drag = { kind: 'scale', handle: hit.handle, start: e.doc, bbox: b, ids };
      return;
    }
    if (hit && (hit.kind === 'shape' || hit.kind === 'element')) {
      const ids = selectHit(e).filter((id) => !ctx.design.shapes[id]?.locked);
      if (!e.mods.shift)
        drag = { kind: 'move', start: ctx.snap(e.doc, new Set(ids)), screen: e.screen, ids, moved: false };
      return;
    }
    const base = e.mods.shift ? ui.selection.shapeIds : [];
    if (!e.mods.shift) ui.clearSelection();
    drag = { kind: 'marquee', start: e.doc, additive: e.mods.shift, base };
  },
  onPointerMove(e, ctx) {
    if (markerMove(e, ctx)) return;
    if (!drag) return;
    const ui = useUi.getState();
    if (drag.kind === 'marquee') {
      ui.set({ marquee: { a: drag.start, b: e.doc } });
      return;
    }
    if (drag.kind === 'move') {
      if (!drag.moved && Math.hypot(e.screen[0] - drag.screen[0], e.screen[1] - drag.screen[1]) < 3) return;
      drag.moved = true;
      const p = ctx.snap(e.doc, new Set(drag.ids));
      let dx = p[0] - drag.start[0],
        dy = p[1] - drag.start[1];
      if (e.mods.shift) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      setPreview(drag.ids, translate(dx, dy));
      return;
    }
    if (drag.kind === 'scale') {
      const b = drag.bbox;
      const h = drag.handle;
      const [ax, ay] = anchorFor(h, b, e.mods.alt);
      const p = ctx.snap(e.doc);
      const sx0 = drag.start[0] - ax,
        sy0 = drag.start[1] - ay;
      let sx = h.includes('e') || h.includes('w') ? (Math.abs(sx0) > 1e-9 ? (p[0] - ax) / sx0 : 1) : 1;
      let sy = h.includes('n') || h.includes('s') ? (Math.abs(sy0) > 1e-9 ? (p[1] - ay) / sy0 : 1) : 1;
      const corner = h.length === 2;
      if (e.mods.shift || (!corner && e.mods.shift)) {
        const u = corner
          ? Math.max(Math.abs(sx), Math.abs(sy))
          : h.includes('e') || h.includes('w')
            ? Math.abs(sx)
            : Math.abs(sy);
        sx = Math.sign(sx || 1) * u;
        sy = Math.sign(sy || 1) * u;
      }
      if (Math.abs(sx) < 1e-3) sx = 1e-3 * Math.sign(sx || 1);
      if (Math.abs(sy) < 1e-3) sy = 1e-3 * Math.sign(sy || 1);
      setPreview(drag.ids, scale(sx, sy, ax, ay));
      return;
    }
    if (drag.kind === 'rotate') {
      const c = drag.center;
      const a0 = Math.atan2(drag.start[1] - c[1], drag.start[0] - c[0]);
      const a1 = Math.atan2(e.doc[1] - c[1], e.doc[0] - c[0]);
      let deg = (-(a1 - a0) * 180) / Math.PI;
      if (e.mods.shift) deg = Math.round(deg / 15) * 15;
      setPreview(drag.ids, rotateScreen(deg, c[0], c[1]));
    }
  },
  onPointerUp(e, ctx) {
    if (markerUp()) return;
    const d = drag;
    drag = null;
    const ui = useUi.getState();
    if (!d) return;
    if (d.kind === 'marquee') {
      ui.set({ marquee: null });
      const r = {
        minX: Math.min(d.start[0], e.doc[0]),
        minY: Math.min(d.start[1], e.doc[1]),
        maxX: Math.max(d.start[0], e.doc[0]),
        maxY: Math.max(d.start[1], e.doc[1]),
      };
      if (r.maxX - r.minX < ctx.px(2) && r.maxY - r.minY < ctx.px(2)) return;
      const ids = shapesInRect(ctx.design, r);
      ui.setSelection({
        shapeIds: d.additive ? [...new Set([...d.base, ...ids])] : ids,
        elementIds: [],
        nodes: [],
      });
      return;
    }
    const m = lastMatrix;
    setPreview([], null);
    if (!m || !d.ids.length) return;
    if (d.kind === 'move' && e.mods.alt) {
      duplicateShapes(d.ids, [m[4], m[5]]);
      return;
    }
    transformShapes(d.ids, m, d.kind === 'move' ? 'Move' : d.kind === 'scale' ? 'Scale' : 'Rotate');
  },
  onKeyDown(e, ctx) {
    const ui = useUi.getState();
    const ids = ui.selection.shapeIds.filter((id) => !ctx.design.shapes[id]?.locked);
    const step = e.shiftKey ? 1 : 0.1;
    const moves: Record<string, Vec2> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    if (moves[e.key] && ids.length) {
      transformShapes(ids, translate(...moves[e.key]), 'Nudge');
      return true;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && ids.length) {
      deleteShapes(ids);
      return true;
    }
    if (e.key === 'Escape') {
      if (drag) {
        drag = null;
        setPreview([], null);
        ui.set({ marquee: null });
      } else ui.clearSelection();
      return true;
    }
    return false;
  },
  onCancel() {
    markerCancel();
    drag = null;
    setPreview([], null);
    useUi.getState().set({ marquee: null });
  },
};
