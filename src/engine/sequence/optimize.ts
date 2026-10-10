// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Sequence optimiser (ARCHITECTURE §12): precedence graph from stacking + overlap, then a greedy
 * topological order that minimises colour changes first, then travel.
 */
import { intersection, makeValid, offsetPolylines } from '@/geom/clipper';
import { flattenGeom, flattenToPaths } from '@/geom/flatten';
import { bboxIntersects, polyShapeArea, polyShapeBBox } from '@/geom/polygon';
import type { BBox, PolyShape } from '@/geom/types';
import { buildElementIndex } from '@/model/factories';
import type { Design, Id, SequenceEntry, Shape } from '@/model/types';
import { AUTO } from '../autodigitize/config';

interface Node {
  elementId: Id;
  shapeId: Id;
  role: 'fill' | 'outline';
  thread: Id;
  z: number;
  poly: PolyShape;
  bbox: BBox;
  center: [number, number];
  weight: number;
  preds: Set<number>;
  succs: Set<number>;
}

function regionOf(shape: Shape, role: 'fill' | 'outline'): PolyShape {
  if (role === 'fill') return makeValid(flattenGeom(shape.geom).rings, shape.geom.fillRule);
  const w = Math.max(
    0.6,
    typeof shape.outline?.params.width === 'number'
      ? (shape.outline.params.width as number)
      : (shape.art.strokeWidth ?? 1),
  );
  const paths = flattenToPaths(shape.geom).map((p) => p.pts);
  return offsetPolylines(paths, w / 2, 'round', 'round');
}

export interface OptimizeOpts {
  /**
   * Only place these element ids freely. All other elements keep their relative order (they are
   * chained), and every element still respects the stacking precedence.
   */
  elementIds?: Id[];
}

export function optimizeSequence(design: Design, opts: OptimizeOpts = {}): SequenceEntry[] {
  const index = buildElementIndex(design);
  const zIndex = new Map(design.zOrder.map((id, i) => [id, i]));
  const restrict = opts.elementIds ? new Set(opts.elementIds) : null;
  const nodes: Node[] = [];
  const fixedIdx: number[] = [];
  const stopsAfter = new Map<Id | null, SequenceEntry[]>();
  let lastEl: Id | null = null;
  for (const e of design.sequence) {
    if (e.kind === 'stop') {
      const l = stopsAfter.get(lastEl) ?? [];
      l.push(e);
      stopsAfter.set(lastEl, l);
      continue;
    }
    lastEl = e.elementId;
    const ref = index.get(e.elementId);
    if (!ref) continue;
    if (restrict && !restrict.has(e.elementId)) fixedIdx.push(nodes.length);
    const shape = design.shapes[ref.shapeId];
    const el = ref.role === 'fill' ? shape.fill! : shape.outline!;
    const poly = regionOf(shape, ref.role);
    const bbox = polyShapeBBox(poly);
    const area = polyShapeArea(poly);
    nodes.push({
      elementId: e.elementId,
      shapeId: ref.shapeId,
      role: ref.role,
      thread: el.threadId,
      z: zIndex.get(ref.shapeId) ?? 0,
      poly,
      bbox,
      center: [(bbox.minX + bbox.maxX) / 2, (bbox.minY + bbox.maxY) / 2],
      weight: Math.max(1, area),
      preds: new Set(),
      succs: new Set(),
    });
  }
  const edge = (a: number, b: number) => {
    nodes[a].succs.add(b);
    nodes[b].preds.add(a);
  };
  for (let i = 0; i < nodes.length; i++) {
    for (let j = 0; j < nodes.length; j++) {
      if (i === j) continue;
      const a = nodes[i],
        b = nodes[j];
      if (a.shapeId === b.shapeId) {
        if (a.role === 'fill' && b.role === 'outline') edge(i, j);
        continue;
      }
      if (!bboxIntersects(a.bbox, b.bbox)) continue;
      const lower = a.z < b.z;
      // Edges only from i to j; each pair considered in both orders.
      let need = false;
      if (a.role === 'fill' && b.role === 'outline')
        need = true; // outlines after fills they overlap
      else if (a.role === b.role && lower) need = true; // lower before upper
      if (!need) continue;
      if (polyShapeArea(intersection(a.poly, b.poly)) <= AUTO.precedenceMinOverlap) continue;
      edge(i, j);
    }
  }

  // Elements that are not being re-placed keep their relative order.
  for (let k = 1; k < fixedIdx.length; k++) edge(fixedIdx[k - 1], fixedIdx[k]);

  // Greedy topological order.
  const done = new Uint8Array(nodes.length);
  const indeg = nodes.map((n) => n.preds.size);
  const order: number[] = [];
  let thread: Id | null = null;
  let pos: [number, number] | null = null;
  const available = () => nodes.map((_, i) => i).filter((i) => !done[i] && indeg[i] === 0);
  const closureWeight = (t: Id): number => {
    // Weight of all elements of thread t that can be sewn now without changing thread.
    const deg = indeg.slice();
    const local = new Uint8Array(nodes.length);
    let w = 0;
    let progress = true;
    while (progress) {
      progress = false;
      for (let i = 0; i < nodes.length; i++) {
        if (done[i] || local[i] || deg[i] !== 0 || nodes[i].thread !== t) continue;
        local[i] = 1;
        w += nodes[i].weight;
        for (const s of nodes[i].succs) deg[s]--;
        progress = true;
      }
    }
    return w;
  };
  while (order.length < nodes.length) {
    const av = available();
    if (!av.length) {
      // Cycle safety: release the lowest-z remaining node.
      let best = -1;
      for (let i = 0; i < nodes.length; i++)
        if (!done[i] && (best < 0 || nodes[i].z < nodes[best].z)) best = i;
      indeg[best] = 0;
      continue;
    }
    let cand = av.filter((i) => nodes[i].thread === thread);
    if (!cand.length) {
      const threads = [...new Set(av.map((i) => nodes[i].thread))];
      let bt = threads[0],
        bw = -1;
      for (const t of threads) {
        const w = closureWeight(t);
        if (w > bw) {
          bw = w;
          bt = t;
        }
      }
      thread = bt;
      cand = av.filter((i) => nodes[i].thread === thread);
    }
    let pick = cand[0];
    if (pos) {
      let bd = Infinity;
      for (const i of cand) {
        const d = Math.hypot(nodes[i].center[0] - pos[0], nodes[i].center[1] - pos[1]);
        // Prefer a shape's own outline right after its fill.
        const bonus = order.length && nodes[order[order.length - 1]].shapeId === nodes[i].shapeId ? -1e6 : 0;
        if (d + bonus < bd) {
          bd = d + bonus;
          pick = i;
        }
      }
    }
    done[pick] = 1;
    order.push(pick);
    pos = nodes[pick].center;
    for (const s of nodes[pick].succs) indeg[s]--;
  }

  twoOpt(order, nodes);

  const out: SequenceEntry[] = [...(stopsAfter.get(null) ?? [])];
  for (const i of order) {
    out.push({ kind: 'element', elementId: nodes[i].elementId });
    out.push(...(stopsAfter.get(nodes[i].elementId) ?? []));
  }
  return dedupeStops(out);
}

function dedupeStops(seq: SequenceEntry[]): SequenceEntry[] {
  const out: SequenceEntry[] = [];
  const seen = new Set<Id>();
  for (const e of seq) {
    if (e.kind === 'stop') {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
    }
    out.push(e);
  }
  return out;
}

/**
 * Improvement pass: 2-opt within each same-thread run of the order, shortening travel between
 * element centres. A segment is only reversed when no precedence edge links two of its elements.
 */
function twoOpt(order: number[], nodes: Node[]): void {
  const d = (a: number, b: number) =>
    Math.hypot(nodes[a].center[0] - nodes[b].center[0], nodes[a].center[1] - nodes[b].center[1]);
  let start = 0;
  while (start < order.length) {
    let end = start;
    while (end + 1 < order.length && nodes[order[end + 1]].thread === nodes[order[start]].thread) end++;
    const len = end - start + 1;
    if (len >= 3 && len <= 300) {
      for (let pass = 0; pass < 8; pass++) {
        let improved = false;
        for (let i = start; i < end; i++) {
          for (let j = i + 1; j <= end; j++) {
            const prev = i > 0 ? order[i - 1] : -1;
            const next = j + 1 < order.length ? order[j + 1] : -1;
            const before = (prev >= 0 ? d(prev, order[i]) : 0) + (next >= 0 ? d(order[j], next) : 0);
            const after = (prev >= 0 ? d(prev, order[j]) : 0) + (next >= 0 ? d(order[i], next) : 0);
            if (after + 1e-6 >= before) continue;
            // Reversal must not invert any precedence edge inside the segment.
            const seg = new Set(order.slice(i, j + 1));
            let ok = true;
            for (const a of seg) {
              for (const b of nodes[a].succs)
                if (seg.has(b)) {
                  ok = false;
                  break;
                }
              if (!ok) break;
            }
            if (!ok) continue;
            const rev = order.slice(i, j + 1).reverse();
            for (let k = 0; k < rev.length; k++) order[i + k] = rev[k];
            improved = true;
          }
        }
        if (!improved) break;
      }
    }
    start = end + 1;
  }
}
