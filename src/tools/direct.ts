// SPDX-License-Identifier: GPL-3.0-or-later
/** Direct-select tool: node and Bézier handle editing. */
import { insertNodeAt, nearestLocation, removeNodes, toggleSmooth } from '@/geom/paperAdapter';
import type { Id, PathGeom, Vec2 } from '@/model/types';
import { setShapeGeom, setShapeGeoms } from '@/store/commands';
import { useDoc } from '@/store/documentStore';
import { useUi, type NodeRef } from '@/store/uiStore';
import { selectHit } from './select';
import type { Tool } from './types';

type Drag =
  | { kind: 'nodes'; shapeId: Id; start: Vec2; nodes: NodeRef[]; moved: boolean }
  | { kind: 'ctrl'; shapeId: Id; sub: number; idx: number; which: 'in' | 'out'; breakSym: boolean }
  | { kind: 'marquee'; start: Vec2 }
  | null;

let drag: Drag = null;
let previewGeom: PathGeom | null = null;

function setPreview(shapeId: Id | null, g: PathGeom | null) {
  previewGeom = g;
  useUi.getState().set({ dragPreview: shapeId && g ? { kind: 'nodes', shapeId, geom: g } : null });
}

function moveNodes(g: PathGeom, nodes: NodeRef[], dx: number, dy: number): PathGeom {
  const out: PathGeom = structuredClone(g);
  for (const n of nodes) {
    const node = out.subpaths[n.sub]?.nodes[n.idx];
    if (node) node.p = [node.p[0] + dx, node.p[1] + dy];
  }
  return out;
}

function moveCtrl(
  g: PathGeom,
  sub: number,
  idx: number,
  which: 'in' | 'out',
  pt: Vec2,
  breakSym: boolean,
): PathGeom {
  const out: PathGeom = structuredClone(g);
  const node = out.subpaths[sub]?.nodes[idx];
  if (!node) return out;
  const v: Vec2 = [pt[0] - node.p[0], pt[1] - node.p[1]];
  node[which] = v;
  const other = which === 'in' ? 'out' : 'in';
  if (breakSym) node.smooth = false;
  else if (node.smooth && node[other]) {
    const ol = Math.hypot(node[other]![0], node[other]![1]);
    const l = Math.hypot(v[0], v[1]) || 1;
    node[other] = [(-v[0] / l) * ol, (-v[1] / l) * ol];
  }
  return out;
}

const refsFor = (shapeId: Id, nodes: NodeRef[]) =>
  nodes.filter((n) => n.shapeId === shapeId).map((n) => ({ subpathIndex: n.sub, nodeIndex: n.idx }));

export const directTool: Tool = {
  id: 'direct',
  label: 'Direct select',
  cursor: 'default',
  shortcut: 'A',
  onPointerDown(e, ctx) {
    if (e.button !== 0) return;
    const ui = useUi.getState();
    const hit = e.hit;
    if (hit?.kind === 'node') {
      if (ctx.design.shapes[hit.shapeId]?.locked) return;
      const ref: NodeRef = { shapeId: hit.shapeId, sub: hit.sub, idx: hit.idx };
      const sel = ui.selection.nodes.filter((n) => n.shapeId === hit.shapeId);
      const has = sel.some((n) => n.sub === ref.sub && n.idx === ref.idx);
      let nodes: NodeRef[];
      if (e.mods.shift)
        nodes = has ? sel.filter((n) => !(n.sub === ref.sub && n.idx === ref.idx)) : [...sel, ref];
      else nodes = has ? sel : [ref];
      ui.setSelection({
        nodes,
        shapeIds: ui.selection.shapeIds.includes(hit.shapeId) ? ui.selection.shapeIds : [hit.shapeId],
      });
      drag = { kind: 'nodes', shapeId: hit.shapeId, start: ctx.snap(e.doc), nodes, moved: false };
      return;
    }
    if (hit?.kind === 'ctrl') {
      drag = {
        kind: 'ctrl',
        shapeId: hit.shapeId,
        sub: hit.sub,
        idx: hit.idx,
        which: hit.which,
        breakSym: e.mods.alt,
      };
      return;
    }
    if (hit && (hit.kind === 'shape' || hit.kind === 'element')) {
      selectHit(e);
      ui.setSelection({ nodes: [] });
      return;
    }
    if (!e.mods.shift) ui.setSelection({ nodes: [] });
    drag = { kind: 'marquee', start: e.doc };
  },
  onPointerMove(e, ctx) {
    if (!drag) return;
    const design = useDoc.getState().design!;
    if (drag.kind === 'marquee') {
      useUi.getState().set({ marquee: { a: drag.start, b: e.doc } });
      return;
    }
    const shape = design.shapes[drag.shapeId];
    if (!shape) return;
    if (drag.kind === 'nodes') {
      const p = ctx.snap(e.doc);
      const dx = p[0] - drag.start[0],
        dy = p[1] - drag.start[1];
      if (!drag.moved && Math.hypot(dx, dy) < ctx.px(2)) return;
      drag.moved = true;
      setPreview(drag.shapeId, moveNodes(shape.geom, drag.nodes, dx, dy));
    } else {
      setPreview(
        drag.shapeId,
        moveCtrl(shape.geom, drag.sub, drag.idx, drag.which, ctx.snap(e.doc), drag.breakSym || e.mods.alt),
      );
    }
  },
  onPointerUp(e, ctx) {
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
      const nodes: NodeRef[] = e.mods.shift ? [...ui.selection.nodes] : [];
      for (const sid of ui.selection.shapeIds) {
        const s = ctx.design.shapes[sid];
        if (!s || s.locked) continue;
        s.geom.subpaths.forEach((sp, si) =>
          sp.nodes.forEach((n, ni) => {
            if (n.p[0] >= r.minX && n.p[0] <= r.maxX && n.p[1] >= r.minY && n.p[1] <= r.maxY)
              nodes.push({ shapeId: sid, sub: si, idx: ni });
          }),
        );
      }
      ui.setSelection({ nodes });
      return;
    }
    const g = previewGeom;
    setPreview(null, null);
    if (g && (d.kind === 'ctrl' || d.moved))
      setShapeGeom(d.shapeId, g, d.kind === 'ctrl' ? 'Edit handle' : 'Move nodes');
  },
  onDoubleClick(e, ctx) {
    // Add a node on the nearest segment of a selected (or hit) shape.
    const ui = useUi.getState();
    const candidates = new Set(ui.selection.shapeIds);
    if (e.hit && (e.hit.kind === 'shape' || e.hit.kind === 'element' || e.hit.kind === 'segment'))
      candidates.add(e.hit.shapeId);
    let best: { sid: Id; loc: NonNullable<ReturnType<typeof nearestLocation>> } | null = null;
    for (const sid of candidates) {
      const s = ctx.design.shapes[sid];
      if (!s || s.locked) continue;
      const loc = nearestLocation(s.geom, e.doc);
      if (loc && (!best || loc.distance < best.loc.distance)) best = { sid, loc };
    }
    if (!best || best.loc.distance > ctx.px(8)) return;
    const res = insertNodeAt(ctx.design.shapes[best.sid].geom, best.loc);
    setShapeGeom(best.sid, res.geom, 'Add node');
    ui.setSelection({
      shapeIds: [best.sid],
      nodes: [{ shapeId: best.sid, sub: best.loc.subpathIndex, idx: res.nodeIndex }],
    });
  },
  onKeyDown(e, ctx) {
    const ui = useUi.getState();
    const nodes = ui.selection.nodes;
    if ((e.key === 'Delete' || e.key === 'Backspace') && nodes.length) {
      const byShape = new Map<Id, NodeRef[]>();
      for (const n of nodes) byShape.set(n.shapeId, [...(byShape.get(n.shapeId) ?? []), n]);
      const changes: [Id, PathGeom][] = [];
      for (const [sid, ns] of byShape) {
        const s = ctx.design.shapes[sid];
        if (s && !s.locked) changes.push([sid, removeNodes(s.geom, refsFor(sid, ns))]);
      }
      setShapeGeoms(changes, 'Delete nodes');
      ui.setSelection({ nodes: [] });
      return true;
    }
    if ((e.key === 'c' || e.key === 'C') && e.shiftKey && nodes.length) {
      const sid = nodes[0].shapeId;
      const s = ctx.design.shapes[sid];
      if (s) setShapeGeom(sid, toggleSmooth(s.geom, refsFor(sid, nodes)), 'Toggle smooth');
      return true;
    }
    const step = e.shiftKey ? 1 : 0.1;
    const moves: Record<string, Vec2> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    if (moves[e.key] && nodes.length) {
      const sid = nodes[0].shapeId;
      const s = ctx.design.shapes[sid];
      if (s)
        setShapeGeom(
          sid,
          moveNodes(
            s.geom,
            nodes.filter((n) => n.shapeId === sid),
            ...moves[e.key],
          ),
          'Nudge nodes',
        );
      return true;
    }
    if (e.key === 'Escape') {
      if (drag) {
        drag = null;
        setPreview(null, null);
      } else ui.setSelection({ nodes: [] });
      return true;
    }
    return false;
  },
  onCancel() {
    drag = null;
    setPreview(null, null);
    useUi.getState().set({ marquee: null });
  },
};
