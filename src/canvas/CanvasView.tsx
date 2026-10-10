// SPDX-License-Identifier: GPL-3.0-or-later
/** The editing canvas: layered rendering plus pointer/wheel dispatch to the active tool. */
import { useCallback, useEffect, useRef } from 'react';
import type { Id, Vec2 } from '@/model/types';
import { useDoc } from '@/store/documentStore';
import { usePlan } from '@/store/planStore';
import { useUi } from '@/store/uiStore';
import { getTool } from '@/tools';
import { selectionBBox, shapeBBox } from '@/tools/selection';
import type { CanvasPointerEvent, HitTarget, Mods, ToolContext } from '@/tools/types';
import { BackdropLayer } from './BackdropLayer';
import { BackgroundLayer, RulersLayer } from './BackgroundLayer';
import { hitIndexFor } from './hitIndex';
import { OverlayLayer } from './OverlayLayer';
import { CANVAS_SHAPES_THRESHOLD, ShapesLayer } from './ShapesLayer';
import { hitShape } from './shapeHit';
import { StitchLayer } from './StitchLayer';
import { fitBBox, screenToDoc, zoomAt } from './viewport';
import { buildElementIndex } from '@/model/factories';
import { useCursor } from './cursorStore';
import { usePanState } from './panState';

/** Space held → temporary hand tool (backed by a store so the cursor updates). */
export const spaceHeld = {
  get current() {
    return usePanState.getState().space;
  },
  set current(v: boolean) {
    if (usePanState.getState().space !== v) usePanState.setState({ space: v });
  },
};

/** Tools where a drag on empty background pans the view (Shift + drag draws a selection box). */
const BACKGROUND_PAN_TOOLS = new Set(['select', 'direct']);

/** Pans the view by a screen-space offset (CSS px). */
export function panBy(dx: number, dy: number): void {
  const ui = useUi.getState();
  ui.setViewport({ pan: [ui.viewport.pan[0] + dx, ui.viewport.pan[1] + dy] });
}

/** Zooms around the centre of the canvas. */
export function zoomBy(factor: number): void {
  const ui = useUi.getState();
  ui.setViewport(zoomAt(ui.viewport, factor, [ui.canvasSize.width / 2, ui.canvasSize.height / 2]));
}

function domHit(el: Element | null): HitTarget | null {
  let n: Element | null = el;
  while (n && n instanceof Element) {
    const kind = n.getAttribute('data-hit');
    if (kind) {
      const d = (k: string) => n!.getAttribute('data-' + k) ?? '';
      switch (kind) {
        case 'shape':
          return { kind: 'shape', shapeId: d('id') };
        case 'handle':
          return { kind: 'handle', handle: d('handle') };
        case 'node':
          return { kind: 'node', shapeId: d('shape'), sub: +d('sub'), idx: +d('idx') };
        case 'entry':
        case 'exit':
          return { kind, elementId: d('element') };
        case 'ctrl':
          return {
            kind: 'ctrl',
            shapeId: d('shape'),
            sub: +d('sub'),
            idx: +d('idx'),
            which: d('which') as 'in' | 'out',
          };
      }
    }
    n = n.parentElement;
  }
  return null;
}

export function CanvasView() {
  const ref = useRef<HTMLDivElement>(null);
  const tool = useUi((s) => s.tool);
  const simActive = useUi((s) => s.sim.active);
  const design = useDoc((s) => s.design);
  /** `click`: a background press that becomes a tool click (deselect) if released without moving. */
  const panning = useRef<{ start: Vec2; pan: Vec2; click?: CanvasPointerEvent; moved?: boolean } | null>(
    null,
  );
  const activeTool = useRef<ReturnType<typeof getTool> | null>(null);

  // Track canvas size.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      useUi.getState().set({ canvasSize: { width: r.width, height: r.height } });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const makeCtx = useCallback((): ToolContext | null => {
    const d = useDoc.getState().design;
    if (!d) return null;
    const ui = useUi.getState();
    const v = ui.viewport;
    return {
      design: d,
      ui,
      viewport: v,
      px: (n) => n / v.zoom,
      hitAt: (screen) => {
        const r = ref.current!.getBoundingClientRect();
        return domHit(document.elementFromPoint(screen[0] + r.left, screen[1] + r.top));
      },
      snap: (pt, exclude?: Set<Id>) => {
        if (!useUi.getState().view.snap) return pt;
        const tol = 6 / v.zoom;
        // Nodes first.
        let best: Vec2 | null = null,
          bd = tol;
        for (const id of d.zOrder) {
          if (exclude?.has(id)) continue;
          const s = d.shapes[id];
          if (!s || s.hidden) continue;
          for (const sp of s.geom.subpaths)
            for (const n of sp.nodes) {
              const dd = Math.hypot(n.p[0] - pt[0], n.p[1] - pt[1]);
              if (dd < bd) {
                bd = dd;
                best = n.p;
              }
            }
        }
        if (best) return [best[0], best[1]];
        // Bounding boxes: snap each axis to other shapes' edges and centres.
        let sx: number | null = null,
          sy: number | null = null,
          dx = tol,
          dy = tol;
        for (const id of d.zOrder) {
          if (exclude?.has(id) || d.shapes[id]?.hidden) continue;
          const b = shapeBBox(d, id);
          if (!b) continue;
          for (const x of [b.minX, (b.minX + b.maxX) / 2, b.maxX])
            if (Math.abs(x - pt[0]) < dx) {
              dx = Math.abs(x - pt[0]);
              sx = x;
            }
          for (const y of [b.minY, (b.minY + b.maxY) / 2, b.maxY])
            if (Math.abs(y - pt[1]) < dy) {
              dy = Math.abs(y - pt[1]);
              sy = y;
            }
        }
        const step = v.zoom >= 20 ? 0.5 : v.zoom >= 4 ? 1 : 5;
        return [sx ?? Math.round(pt[0] / step) * step, sy ?? Math.round(pt[1] / step) * step];
      },
    };
  }, []);

  const toEvent = useCallback(
    (
      e: React.PointerEvent | React.MouseEvent | PointerEvent | MouseEvent,
      withHit: boolean,
    ): CanvasPointerEvent => {
      const r = ref.current!.getBoundingClientRect();
      const screen: Vec2 = [e.clientX - r.left, e.clientY - r.top];
      const ui = useUi.getState();
      const doc = screenToDoc(ui.viewport, screen);
      const mods: Mods = { shift: e.shiftKey, alt: e.altKey, mod: e.metaKey || e.ctrlKey };
      let hit: HitTarget | null = null;
      if (withHit) {
        hit = domHit(e.target as Element);
        // In stitch views, stitches under the pointer select their element.
        if ((!hit || hit.kind === 'shape') && ui.viewMode !== 'artwork') {
          const plan = usePlan.getState().plan;
          const d = useDoc.getState().design;
          if (plan && d) {
            const h = hitIndexFor(plan).query(doc[0], doc[1], 4 / ui.viewport.zoom);
            if (h) {
              const ref2 = buildElementIndex(d).get(h.elementId);
              const shape = ref2 ? d.shapes[ref2.shapeId] : null;
              if (ref2 && shape && !shape.locked && !shape.hidden)
                hit = { kind: 'element', shapeId: ref2.shapeId, elementId: h.elementId };
            }
          }
        }
        if (hit?.kind === 'shape') {
          const s = useDoc.getState().design?.shapes[hit.shapeId];
          if (!s || s.locked) hit = null;
        }
        // Large designs draw shapes on a canvas: hit-test them geometrically.
        if (!hit) {
          const d = useDoc.getState().design;
          if (d && d.zOrder.length > CANVAS_SHAPES_THRESHOLD) {
            const sid = hitShape(d, doc, 4 / ui.viewport.zoom);
            if (sid) hit = { kind: 'shape', shapeId: sid };
          }
        }
      }
      return { doc, screen, mods, hit, button: e.button, nativeEvent: e as PointerEvent };
    },
    [],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    ref.current?.focus();
    const ui = useUi.getState();
    const ev = toEvent(e, true);
    // Pan with the middle or right button, Space + drag, the hand tool, or any drag while simulating.
    if (e.button === 1 || e.button === 2 || spaceHeld.current || (simActive && e.button === 0)) {
      e.preventDefault();
      panning.current = { start: ev.screen, pan: ui.viewport.pan };
      usePanState.setState({ dragging: true });
      ref.current!.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0) return;
    // Selection tools: dragging empty background pans; Shift + drag draws a selection box.
    if (!ev.hit && !ev.mods.shift && BACKGROUND_PAN_TOOLS.has(ui.tool)) {
      panning.current = { start: ev.screen, pan: ui.viewport.pan, click: ev };
      ref.current!.setPointerCapture(e.pointerId);
      return;
    }
    const ctx = makeCtx();
    if (!ctx) return;
    ref.current!.setPointerCapture(e.pointerId);
    activeTool.current = getTool(ui.tool);
    activeTool.current.onPointerDown?.(ev, ctx);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    {
      const r = ref.current!.getBoundingClientRect();
      useCursor.setState({
        pos: screenToDoc(useUi.getState().viewport, [e.clientX - r.left, e.clientY - r.top]),
      });
    }
    if (panning.current) {
      const r = ref.current!.getBoundingClientRect();
      const p: Vec2 = [e.clientX - r.left, e.clientY - r.top];
      const st = panning.current;
      if (st.click && !st.moved) {
        if (Math.hypot(p[0] - st.start[0], p[1] - st.start[1]) < 3) return;
        st.moved = true;
        usePanState.setState({ dragging: true });
      }
      useUi.getState().setViewport({ pan: [st.pan[0] + p[0] - st.start[0], st.pan[1] + p[1] - st.start[1]] });
      return;
    }
    const ctx = makeCtx();
    if (!ctx) return;
    const ev = toEvent(e, !activeTool.current);
    if (activeTool.current) activeTool.current.onPointerMove?.(ev, ctx);
    else {
      // Hover feedback (no button pressed).
      getTool(useUi.getState().tool).onPointerMove?.(ev, ctx);
      const h = ev.hit;
      const cur = useUi.getState().hover;
      const next =
        h?.kind === 'element'
          ? { elementId: h.elementId, shapeId: h.shapeId }
          : h?.kind === 'shape'
            ? { shapeId: h.shapeId }
            : null;
      if (cur?.elementId !== next?.elementId || cur?.shapeId !== next?.shapeId)
        useUi.getState().set({ hover: next });
      const background = !h && BACKGROUND_PAN_TOOLS.has(useUi.getState().tool);
      if (usePanState.getState().background !== background) usePanState.setState({ background });
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (panning.current) {
      const st = panning.current;
      panning.current = null;
      usePanState.setState({ dragging: false });
      // A background click without a drag: let the tool handle it (clears the selection).
      if (st.click && !st.moved) {
        const ctx = makeCtx();
        const t = getTool(useUi.getState().tool);
        if (ctx) {
          t.onPointerDown?.(st.click, ctx);
          t.onPointerUp?.(st.click, ctx);
        }
      }
      return;
    }
    const t = activeTool.current;
    activeTool.current = null;
    const ctx = makeCtx();
    if (!ctx || !t) return;
    t.onPointerUp?.(toEvent(e, false), ctx);
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const ctx = makeCtx();
    if (!ctx || simActive) return;
    getTool(useUi.getState().tool).onDoubleClick?.(toEvent(e, true), ctx);
  };

  // Wheel / trackpad (non-passive so we can preventDefault):
  // - mouse wheel zooms at the cursor (Shift + wheel pans sideways);
  // - two-finger trackpad scroll pans, pinch (reported as Ctrl + wheel) zooms at the cursor;
  // - Ctrl/⌘ + wheel always zooms.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const at: Vec2 = [e.clientX - r.left, e.clientY - r.top];
      const ui = useUi.getState();
      const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? r.height : 1;
      const dx = e.deltaX * scale,
        dy = e.deltaY * scale;
      // A notched mouse wheel reports line deltas or large whole-pixel steps with no horizontal part;
      // trackpads report small, often fractional deltas in both axes.
      const mouseWheel =
        e.deltaMode !== 0 || (e.deltaX === 0 && Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 40);
      if (e.ctrlKey || e.metaKey) {
        const rate = mouseWheel ? 0.0015 : 0.01;
        ui.setViewport(zoomAt(ui.viewport, Math.exp(-Math.max(-300, Math.min(300, dy)) * rate), at));
      } else if (mouseWheel && !e.shiftKey) {
        ui.setViewport(zoomAt(ui.viewport, Math.exp(-dy * 0.0015), at));
      } else if (e.shiftKey && dx === 0) {
        panBy(-dy, 0);
      } else {
        panBy(-dx, -dy);
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Fit the design when a new design is opened.
  const designId = useDoc((s) => s.designId);
  const size = useUi((s) => s.canvasSize);
  const fittedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!design || !designId || fittedFor.current === designId || size.width < 50) return;
    fittedFor.current = designId;
    fitDesign();
  }, [design, designId, size]);

  const pan = usePanState();
  const cursor = pan.dragging
    ? 'grabbing'
    : simActive || pan.space || (pan.background && BACKGROUND_PAN_TOOLS.has(tool))
      ? 'grab'
      : getTool(tool).cursor;

  return (
    <div
      ref={ref}
      tabIndex={-1}
      data-testid="canvas"
      className="relative flex-1 overflow-hidden outline-none select-none"
      style={{ cursor, touchAction: 'none' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => {
        if (useUi.getState().hover) useUi.getState().set({ hover: null });
        if (usePanState.getState().background) usePanState.setState({ background: false });
      }}
      onDoubleClick={onDoubleClick}
      onContextMenu={(e) => e.preventDefault()}
    >
      <BackgroundLayer />
      <BackdropLayer />
      <ShapesLayer />
      <StitchLayer />
      <OverlayLayer />
      <RulersLayer />
    </div>
  );
}

/** Zoom to fit the whole design (⌘0). */
export function fitDesign(): void {
  const ui = useUi.getState();
  const d = useDoc.getState().design;
  if (!d) return;
  const plan = usePlan.getState().plan;
  let b = selectionBBox(
    d,
    d.zOrder.filter((id) => !d.shapes[id].hidden),
  );
  if (!b && plan && plan.stats.stitches) b = plan.bounds;
  if (!b) b = { minX: -50, minY: -50, maxX: 50, maxY: 50 };
  ui.setViewport(fitBBox(b, ui.canvasSize.width, ui.canvasSize.height));
}

/** Zoom to fit the selection. */
export function fitSelection(): void {
  const ui = useUi.getState();
  const d = useDoc.getState().design;
  if (!d) return;
  const b = selectionBBox(d, ui.selection.shapeIds);
  if (b) ui.setViewport(fitBBox(b, ui.canvasSize.width, ui.canvasSize.height));
}

/** 100%: physical size on screen. */
export function zoomActual(): void {
  const ui = useUi.getState();
  const c: Vec2 = [ui.canvasSize.width / 2, ui.canvasSize.height / 2];
  ui.setViewport(zoomAt(ui.viewport, 96 / 25.4 / ui.viewport.zoom, c));
}
