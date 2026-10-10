// SPDX-License-Identifier: GPL-3.0-or-later
/** Pen, rectangle and ellipse tools (P1). New closed shapes get a tatami fill; open paths a running outline. */
import { ellipseGeom, rectGeom } from '@/geom/shapes';
import { newId } from '@/lib/ids';
import { createElement, createShape, hasClosedSubpath } from '@/model/factories';
import type { Design, Node, PathGeom, Thread, Vec2 } from '@/model/types';
import { addShapes } from '@/store/commands';
import { useUi } from '@/store/uiStore';
import { useToolState } from './toolState';
import type { Tool } from './types';

/** Thread for newly drawn shapes: the thread of the selected element, else the first thread, else a new dark one. */
function drawThread(design: Design): { thread: Thread; isNew: boolean } {
  const sel = useUi.getState().selection;
  for (const sid of sel.shapeIds) {
    const s = design.shapes[sid];
    const el = s?.fill ?? s?.outline;
    if (el && design.threads[el.threadId]) return { thread: design.threads[el.threadId], isNew: false };
  }
  const first = Object.values(design.threads)[0];
  if (first) return { thread: first, isNew: false };
  return { thread: { id: newId('t'), name: 'Charcoal', color: '#2f2f35' }, isNew: true };
}

let counter = 1;
export function addDrawnShape(design: Design, name: string, geom: PathGeom): void {
  const { thread, isNew } = drawThread(design);
  const closed = hasClosedSubpath(geom);
  const shape = createShape(
    `${name} ${counter++}`,
    geom,
    closed ? { fill: thread.color } : { stroke: thread.color, strokeWidth: 0.5 },
  );
  if (closed) shape.fill = createElement('fill', 'tatami', thread.id);
  else shape.outline = createElement('outline', 'running', thread.id);
  addShapes(`Draw ${name.toLowerCase()}`, { shapes: [shape], threads: isNew ? [thread] : [] });
}

function boxTool(kind: 'rect' | 'ellipse'): Tool {
  let start: Vec2 | null = null;
  const geomFor = (a: Vec2, b: Vec2, shift: boolean, alt: boolean): PathGeom | null => {
    let dx = b[0] - a[0],
      dy = b[1] - a[1];
    if (shift) {
      const m = Math.max(Math.abs(dx), Math.abs(dy));
      dx = Math.sign(dx || 1) * m;
      dy = Math.sign(dy || 1) * m;
    }
    let x0 = a[0],
      y0 = a[1],
      w = dx,
      h = dy;
    if (alt) {
      x0 = a[0] - dx;
      y0 = a[1] - dy;
      w = dx * 2;
      h = dy * 2;
    }
    const minX = Math.min(x0, x0 + w),
      minY = Math.min(y0, y0 + h);
    w = Math.abs(w);
    h = Math.abs(h);
    if (w < 0.2 || h < 0.2) return null;
    return kind === 'rect'
      ? rectGeom(minX, minY, w, h)
      : ellipseGeom(minX + w / 2, minY + h / 2, w / 2, h / 2);
  };
  return {
    id: kind,
    label: kind === 'rect' ? 'Rectangle' : 'Ellipse',
    cursor: 'crosshair',
    shortcut: kind === 'rect' ? 'M' : 'L',
    onPointerDown(e, ctx) {
      if (e.button !== 0) return;
      start = ctx.snap(e.doc);
      useToolState.setState({ box: { kind, a: start, b: start } });
    },
    onPointerMove(e, ctx) {
      if (!start) return;
      const b = ctx.snap(e.doc);
      const g = geomFor(start, b, e.mods.shift, e.mods.alt);
      // Store the effective corners for the overlay preview.
      if (g) {
        const xs = g.subpaths[0].nodes.map((n) => n.p[0]),
          ys = g.subpaths[0].nodes.map((n) => n.p[1]);
        useToolState.setState({
          box: { kind, a: [Math.min(...xs), Math.min(...ys)], b: [Math.max(...xs), Math.max(...ys)] },
        });
      }
    },
    onPointerUp(e, ctx) {
      if (!start) return;
      const g = geomFor(start, ctx.snap(e.doc), e.mods.shift, e.mods.alt);
      start = null;
      useToolState.setState({ box: null });
      if (g) addDrawnShape(ctx.design, kind === 'rect' ? 'Rectangle' : 'Ellipse', g);
    },
    onCancel() {
      start = null;
      useToolState.setState({ box: null });
    },
  };
}

export const rectTool = boxTool('rect');
export const ellipseTool = boxTool('ellipse');

function finishPen(design: Design, close: boolean) {
  const pen = useToolState.getState().pen;
  useToolState.setState({ pen: null });
  if (!pen) return;
  const nodes: Node[] = [];
  for (const n of pen.nodes) {
    const l = nodes[nodes.length - 1];
    if (l && Math.hypot(l.p[0] - n.p[0], l.p[1] - n.p[1]) < 1e-6) continue;
    nodes.push(n);
  }
  if (nodes.length < 2) return;
  const geom: PathGeom = { fillRule: 'nonzero', subpaths: [{ closed: close && nodes.length >= 3, nodes }] };
  addDrawnShape(design, 'Path', geom);
}

let penDown: Vec2 | null = null;

export const penTool: Tool = {
  id: 'pen',
  label: 'Pen',
  cursor: 'crosshair',
  shortcut: 'P',
  onPointerDown(e, ctx) {
    if (e.button !== 0) return;
    const p = ctx.snap(e.doc);
    const pen = useToolState.getState().pen ?? { nodes: [], hover: null, dragging: false };
    if (pen.nodes.length >= 2) {
      const f = pen.nodes[0].p;
      if (Math.hypot(f[0] - p[0], f[1] - p[1]) < ctx.px(8)) {
        finishPen(ctx.design, true);
        return;
      }
    }
    penDown = p;
    useToolState.setState({ pen: { nodes: [...pen.nodes, { p }], hover: p, dragging: true } });
  },
  onPointerMove(e, ctx) {
    const pen = useToolState.getState().pen;
    if (!pen) return;
    const p = ctx.snap(e.doc);
    if (pen.dragging && penDown) {
      const out: Vec2 = [p[0] - penDown[0], p[1] - penDown[1]];
      if (Math.hypot(out[0], out[1]) > ctx.px(3)) {
        const nodes = pen.nodes.slice();
        const last: Node = { p: penDown, out, in: [-out[0], -out[1]], smooth: true };
        nodes[nodes.length - 1] = last;
        useToolState.setState({ pen: { ...pen, nodes, hover: p } });
        return;
      }
    }
    useToolState.setState({ pen: { ...pen, hover: p } });
  },
  onPointerUp() {
    const pen = useToolState.getState().pen;
    penDown = null;
    if (pen) useToolState.setState({ pen: { ...pen, dragging: false } });
  },
  onDoubleClick(_e, ctx) {
    finishPen(ctx.design, false);
  },
  onKeyDown(e, ctx) {
    if (!useToolState.getState().pen) return false;
    if (e.key === 'Enter') {
      finishPen(ctx.design, false);
      return true;
    }
    if (e.key === 'Escape') {
      finishPen(ctx.design, false);
      return true;
    }
    if (e.key === 'Backspace') {
      const pen = useToolState.getState().pen!;
      useToolState.setState({ pen: pen.nodes.length > 1 ? { ...pen, nodes: pen.nodes.slice(0, -1) } : null });
      return true;
    }
    return false;
  },
  onCancel() {
    useToolState.setState({ pen: null });
  },
};
