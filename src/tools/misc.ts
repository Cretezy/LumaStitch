// SPDX-License-Identifier: GPL-3.0-or-later
/** Hand, zoom, stitch-angle, entry/exit and satin-direction tools. */
import { zoomAt } from '@/canvas/viewport';
import { usePanState } from '@/canvas/panState';
import { flattenSubpath } from '@/geom/flatten';
import { cumulativeLengths, nearestOnPolyline } from '@/geom/polyline';
import { buildElementIndex, getElement } from '@/model/factories';
import type { Design, Id, Vec2 } from '@/model/types';
import { selectedElementIds, setElementProps, setParams } from '@/store/commands';
import { useUi } from '@/store/uiStore';
import { selectHit } from './select';
import { useToolState } from './toolState';
import { markerCancel, markerDown, markerMove, markerUp } from './markerDrag';
import type { Tool } from './types';

let panStart: { screen: Vec2; pan: Vec2 } | null = null;

export const handTool: Tool = {
  id: 'hand',
  label: 'Hand',
  cursor: 'grab',
  shortcut: 'H',
  onPointerDown(e) {
    panStart = { screen: e.screen, pan: useUi.getState().viewport.pan };
    usePanState.setState({ dragging: true });
  },
  onPointerMove(e) {
    if (!panStart) return;
    useUi.getState().setViewport({
      pan: [
        panStart.pan[0] + e.screen[0] - panStart.screen[0],
        panStart.pan[1] + e.screen[1] - panStart.screen[1],
      ],
    });
  },
  onPointerUp() {
    panStart = null;
    usePanState.setState({ dragging: false });
  },
  onCancel() {
    panStart = null;
    usePanState.setState({ dragging: false });
  },
};

export const zoomTool: Tool = {
  id: 'zoom',
  label: 'Zoom',
  cursor: 'zoom-in',
  shortcut: 'Z',
  onPointerDown(e) {
    const ui = useUi.getState();
    ui.setViewport(zoomAt(ui.viewport, e.mods.alt ? 1 / 1.6 : 1.6, e.screen));
  },
};

/** Fill elements targeted by stitch tools: selected fills, else the fill under the pointer. */
function targetFills(design: Design, at?: { shapeId?: Id }): Id[] {
  const index = buildElementIndex(design);
  let ids = selectedElementIds(design).filter((id) => index.get(id)?.role === 'fill');
  if (!ids.length && at?.shapeId) {
    const f = design.shapes[at.shapeId]?.fill;
    if (f) ids = [f.id];
  }
  return ids;
}

let angleStart: Vec2 | null = null;
let angleTargets: Id[] = [];

function angleOf(a: Vec2, b: Vec2): number {
  let deg = (-Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
  deg = ((deg % 180) + 180) % 180;
  return deg;
}

export const angleTool: Tool = {
  id: 'angle',
  label: 'Stitch angle',
  cursor: 'crosshair',
  onPointerDown(e, ctx) {
    if (
      e.hit &&
      (e.hit.kind === 'shape' || e.hit.kind === 'element') &&
      !useUi.getState().selection.shapeIds.includes(e.hit.shapeId)
    )
      selectHit(e);
    angleTargets = targetFills(
      ctx.design,
      e.hit && 'shapeId' in e.hit ? { shapeId: e.hit.shapeId } : undefined,
    );
    if (!angleTargets.length) {
      useUi.getState().showToast('Select a fill to set its stitch angle.');
      return;
    }
    angleStart = e.doc;
    useToolState.setState({ line: { a: e.doc, b: e.doc } });
  },
  onPointerMove(e) {
    if (!angleStart) return;
    let deg = angleOf(angleStart, e.doc);
    if (e.mods.shift) deg = Math.round(deg / 15) * 15;
    useToolState.setState({ line: { a: angleStart, b: e.doc, label: `${Math.round(deg)}°` } });
  },
  onPointerUp(e, ctx) {
    const a = angleStart;
    angleStart = null;
    useToolState.setState({ line: null });
    if (!a || Math.hypot(e.doc[0] - a[0], e.doc[1] - a[1]) < ctx.px(6)) return;
    let deg = angleOf(a, e.doc);
    if (e.mods.shift) deg = Math.round(deg / 15) * 15;
    deg = (Math.round(deg * 10) / 10) % 180;
    setParams(angleTargets, { angle: deg }, 'Set stitch angle');
  },
  onCancel() {
    angleStart = null;
    useToolState.setState({ line: null });
  },
};

export const entryExitTool: Tool = {
  id: 'entryExit',
  label: 'Start/end point',
  cursor: 'crosshair',
  onPointerMove(e, ctx) {
    markerMove(e, ctx);
  },
  onPointerUp() {
    markerUp();
  },
  onCancel() {
    markerCancel();
  },
  onPointerDown(e, ctx) {
    if (markerDown(e)) return;
    const ui = useUi.getState();
    const ids = selectedElementIds(ctx.design);
    if (!ids.length && e.hit && (e.hit.kind === 'shape' || e.hit.kind === 'element')) {
      selectHit(e);
      return;
    }
    if (!ids.length) {
      ui.showToast('Select an element first, then click to place its start (or Alt-click for its end).');
      return;
    }
    const which = e.mods.alt ? (ui.entryExitMode === 'entry' ? 'exit' : 'entry') : ui.entryExitMode;
    setElementProps([ids[0]], { [which]: e.doc }, which === 'entry' ? 'Set start point' : 'Set end point');
  },
};

let guideStart: Vec2 | null = null;

function selectedSatinFill(design: Design): Id | null {
  const index = buildElementIndex(design);
  for (const id of selectedElementIds(design)) {
    const el = getElement(design, index.get(id));
    if (el?.type === 'satinFill') return id;
  }
  return null;
}

export const satinDirectionTool: Tool = {
  id: 'satinDirection',
  label: 'Satin direction',
  cursor: 'crosshair',
  onPointerDown(e, ctx) {
    const id = selectedSatinFill(ctx.design);
    if (!id) {
      if (e.hit && (e.hit.kind === 'shape' || e.hit.kind === 'element')) selectHit(e);
      if (!selectedSatinFill(ctx.design))
        useUi.getState().showToast('Select a satin fill, then drag across it to add a direction line.');
      return;
    }
    if (e.mods.alt) {
      // Alt-click on the outline sets a rail split point (alternating first/second).
      const index = buildElementIndex(ctx.design);
      const ref = index.get(id)!;
      const shape = ctx.design.shapes[ref.shapeId];
      const sp = shape.geom.subpaths.find((s) => s.closed);
      if (!sp) return;
      const ring = flattenSubpath(sp);
      const closed = new Float64Array(ring.length + 2);
      closed.set(ring);
      closed[ring.length] = ring[0];
      closed[ring.length + 1] = ring[1];
      const cum = cumulativeLengths(closed);
      const L = cum[cum.length - 1];
      const n = nearestOnPolyline(closed, e.doc[0], e.doc[1]);
      const t = n.s / L;
      const el = shape.fill!;
      const cur = el.railSplit ?? [t, (t + 0.5) % 1];
      const which = (useUi.getState().dialogData?.railIdx ?? 0) as number;
      const next: [number, number] = which === 0 ? [t, cur[1]] : [cur[0], t];
      useUi.getState().set({ dialogData: { ...(useUi.getState().dialogData ?? {}), railIdx: 1 - which } });
      setElementProps([id], { railSplit: next }, 'Set rail split');
      return;
    }
    guideStart = e.doc;
    useToolState.setState({ line: { a: e.doc, b: e.doc } });
  },
  onPointerMove(e) {
    if (!guideStart) return;
    useToolState.setState({ line: { a: guideStart, b: e.doc } });
  },
  onPointerUp(e, ctx) {
    const a = guideStart;
    guideStart = null;
    useToolState.setState({ line: null });
    const id = selectedSatinFill(ctx.design);
    if (!a || !id || Math.hypot(e.doc[0] - a[0], e.doc[1] - a[1]) < ctx.px(6)) return;
    const index = buildElementIndex(ctx.design);
    const el = getElement(ctx.design, index.get(id))!;
    setElementProps([id], { guides: [...(el.guides ?? []), [a, e.doc]] }, 'Add direction line');
  },
  onKeyDown(e, ctx) {
    const id = selectedSatinFill(ctx.design);
    if (!id) return false;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      const index = buildElementIndex(ctx.design);
      const el = getElement(ctx.design, index.get(id))!;
      if (el.guides?.length)
        setElementProps([id], { guides: el.guides.slice(0, -1) }, 'Remove direction line');
      return true;
    }
    return false;
  },
  onCancel() {
    guideStart = null;
    useToolState.setState({ line: null });
  },
};
