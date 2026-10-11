// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Sequence optimiser (ARCHITECTURE §12): precedence-safe exact/local search, then bounded
 * comparison of actual stitch plans. Stops partition the optimization into independent jobs.
 */
import { intersection, makeValid, offsetPolylines } from '@/geom/clipper';
import { flattenGeom, flattenToPaths } from '@/geom/flatten';
import { bboxIntersects, polyShapeArea, polyShapeBBox } from '@/geom/polygon';
import type { BBox, PolyShape } from '@/geom/types';
import { buildElementIndex } from '@/model/factories';
import type { Design, Id, SequenceEntry, Shape } from '@/model/types';
import { AUTO } from '../autodigitize/config';
import { routeOrder } from './routeOrder';
import { buildPlan, createPlanCache } from '../plan';
import { F } from '../types';

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
  // Manual stops are operation boundaries (e.g. placing appliqué fabric). Never move work across
  // one, even when regrouping the same thread would save a colour change.
  const out: SequenceEntry[] = [];
  let segment: SequenceEntry[] = [];
  const flush = () => {
    if (segment.length) out.push(...optimizeSegment({ ...design, sequence: segment }, opts));
    segment = [];
  };
  for (const entry of design.sequence) {
    if (entry.kind === 'stop') {
      flush();
      out.push(entry);
    } else segment.push(entry);
  }
  flush();
  return out;
}

function optimizeSegment(design: Design, opts: OptimizeOpts): SequenceEntry[] {
  const index = buildElementIndex(design);
  const zIndex = new Map(design.zOrder.map((id, i) => [id, i]));
  const restrict = opts.elementIds ? new Set(opts.elementIds) : null;
  const nodes: Node[] = [];
  const fixedIdx: number[] = [];
  for (const e of design.sequence) {
    if (e.kind !== 'element') continue;
    const ref = index.get(e.elementId);
    if (!ref) continue;
    if (restrict && !restrict.has(e.elementId)) fixedIdx.push(nodes.length);
    const shape = design.shapes[ref.shapeId];
    const el = ref.role === 'fill' ? shape.fill! : shape.outline!;
    const poly = regionOf(shape, ref.role);
    const bbox = polyShapeBBox(poly);
    if (!Number.isFinite(bbox.minX)) {
      const points = flattenToPaths(shape.geom).flatMap((p) => Array.from(p.pts));
      bbox.minX = bbox.maxX = points[0] ?? 0;
      bbox.minY = bbox.maxY = points[1] ?? 0;
      for (let k = 0; k < points.length; k += 2) {
        bbox.minX = Math.min(bbox.minX, points[k]);
        bbox.maxX = Math.max(bbox.maxX, points[k]);
        bbox.minY = Math.min(bbox.minY, points[k + 1]);
        bbox.maxY = Math.max(bbox.maxY, points[k + 1]);
      }
    }
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
      // Edges only from i to j; each pair considered in both orders. Overlapping elements follow
      // the stacking order whatever their roles, so a lower shape (fill and outline) can be
      // finished before the shape above it; the upper one covers whatever it overlaps.
      if (!(a.z < b.z)) continue;
      if (polyShapeArea(intersection(a.poly, b.poly)) <= AUTO.precedenceMinOverlap) continue;
      edge(i, j);
    }
  }

  // Elements that are not being re-placed keep their relative order.
  for (let k = 1; k < fixedIdx.length; k++) edge(fixedIdx[k - 1], fixedIdx[k]);

  // Digitized letters contain authored underpaths followed by covering satin. Preserve that
  // dependency until a column-aware router can replace the underpaths as well as the order.
  for (const group of Object.values(design.lettering ?? {})) {
    const members = new Set(group.shapeIds);
    const ordered = nodes.map((n, i) => (members.has(n.shapeId) ? i : -1)).filter((i) => i >= 0);
    for (let i = 1; i < ordered.length; i++) edge(ordered[i - 1], ordered[i]);
  }
  // Imported programs have authored command order, including trims and stops. Keep those
  // blocks in their original order even when their bounding boxes do not overlap.
  const imported = nodes
    .map((n, i) => (design.shapes[n.shapeId].outline?.params.preserveCommands === true ? i : -1))
    .filter((i) => i >= 0);
  for (let i = 1; i < imported.length; i++) edge(imported[i - 1], imported[i]);

  // Distance from a point to an element's bounding box (0 inside).
  const distTo = (p: [number, number], i: number) => {
    const b = nodes[i].bbox;
    return Math.hypot(Math.max(0, b.minX - p[0], p[0] - b.maxX), Math.max(0, b.minY - p[1], p[1] - b.maxY));
  };
  // Start at the design's top-left corner (a predictable, reading-order start).
  const start: [number, number] = [Infinity, Infinity];
  for (const n of nodes) {
    start[0] = Math.min(start[0], n.bbox.minX);
    start[1] = Math.min(start[1], n.bbox.minY);
  }

  // Greedy topological order.
  const done = new Uint8Array(nodes.length);
  const indeg = nodes.map((n) => n.preds.size);
  const order: number[] = [];
  let thread: Id | null = null;
  let pos: [number, number] | null = nodes.length ? start : null;
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
      // A fixed user order may contradict stacking. Leave this segment unchanged rather than
      // silently breaking a precedence edge or moving an unselected element.
      return design.sequence.slice();
    }
    let cand = av.filter((i) => nodes[i].thread === thread);
    if (!cand.length) {
      // Next thread: prefer one whose remaining elements can all be sewn now (no extra change of
      // that colour later), then the nearest; otherwise the largest block that can be sewn now.
      const threads = [...new Set(av.map((i) => nodes[i].thread))];
      const remaining = (t: Id) => {
        let w = 0;
        for (let i = 0; i < nodes.length; i++) if (!done[i] && nodes[i].thread === t) w += nodes[i].weight;
        return w;
      };
      const near = (t: Id) =>
        Math.min(...av.filter((i) => nodes[i].thread === t).map((i) => distTo(pos!, i)));
      let bt = threads[0],
        bScore: [number, number] = [Infinity, Infinity];
      for (const t of threads) {
        const w = closureWeight(t);
        const complete = w >= remaining(t) - 1e-9;
        const score: [number, number] = complete ? [0, near(t)] : [1, -w];
        if (score[0] < bScore[0] || (score[0] === bScore[0] && score[1] < bScore[1])) {
          bScore = score;
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
        const d = distTo(pos, i);
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
    // The element is entered at the side nearest the current position and left on the far side.
    {
      const nb = nodes[pick].bbox;
      const c = nodes[pick].center;
      const ex = pos ? Math.min(nb.maxX, Math.max(nb.minX, pos[0])) : c[0];
      const ey = pos ? Math.min(nb.maxY, Math.max(nb.minY, pos[1])) : c[1];
      pos = [2 * c[0] - ex, 2 * c[1] - ey];
    }
    for (const s of nodes[pick].succs) indeg[s]--;
  }

  let improved =
    routeOrder(
      {
        size: nodes.length,
        start: (i) => Math.hypot(nodes[i].center[0] - start[0], nodes[i].center[1] - start[1]),
        distance: (i, j) =>
          Math.hypot(nodes[i].center[0] - nodes[j].center[0], nodes[i].center[1] - nodes[j].center[1]),
        thread: (i) => nodes[i].thread,
        predecessors: nodes.map((n) => n.preds),
      },
      order,
    ) ?? order;

  // Centre distances cannot predict where a wide fill actually finishes. Compare a small set
  // of valid orders using real machine commands, sharing prepared geometry between candidates.
  // This also considers the equally short reverse of a symmetric route when precedence permits.
  if (nodes.length > 1 && nodes.length <= 128) {
    const cache = createPlanCache();
    const valid = (candidate: number[]) => {
      const position = new Int32Array(nodes.length);
      candidate.forEach((v, k) => {
        position[v] = k;
      });
      return nodes.every((node, i) => [...node.preds].every((p) => position[p] < position[i]));
    };
    const candidates = [improved, improved.slice().reverse(), order, nodes.map((_, i) => i)].filter(valid);
    const seen = new Set<string>();
    let bestChanges = Infinity,
      bestCost = Infinity;
    let commands = 0;
    const evaluate = (candidate: number[]) => {
      const key = candidate.join(',');
      if (seen.has(key) || !valid(candidate)) return;
      seen.add(key);
      const plan = buildPlan(
        {
          ...design,
          sequence: candidate.map((i) => ({ kind: 'element' as const, elementId: nodes[i].elementId })),
        },
        { cache },
      );
      commands = Math.max(commands, plan.flags.length);
      let cost = 10 * plan.stats.trims;
      for (let k = 1; k < plan.flags.length; k++) {
        const flag = plan.flags[k];
        if (flag & (F.TRIM | F.STOP | F.COLOR_CHANGE | F.END)) continue;
        const distance = Math.hypot(plan.x[k] - plan.x[k - 1], plan.y[k] - plan.y[k - 1]);
        if (flag & F.JUMP) cost += 3 * distance;
        else if (flag & F.TRAVEL) cost += distance;
      }
      if (
        plan.stats.colorChanges < bestChanges ||
        (plan.stats.colorChanges === bestChanges && cost < bestCost - 1e-6)
      ) {
        bestChanges = plan.stats.colorChanges;
        bestCost = cost;
        improved = candidate;
      }
    };
    for (const candidate of candidates) {
      evaluate(candidate);
      if (commands > 100_000) break;
    }
    // Small full designs benefit from moving whole colour blocks: centre-distance ordering
    // cannot see their actual underlay/section exits. Keep every proposal precedence-safe,
    // and cap this refinement at two rounds of eight actual-plan evaluations.
    if (nodes.length <= 16 && commands <= 20_000) {
      for (let round = 0; round < 2; round++) {
        const incumbent = improved;
        const blocks: number[][] = [];
        for (const i of incumbent) {
          const last = blocks[blocks.length - 1];
          if (last && nodes[last[0]].thread === nodes[i].thread) last.push(i);
          else blocks.push([i]);
        }
        const proposals: number[][] = [];
        for (let i = 0; i + 1 < blocks.length; i++) {
          const swapped = blocks.slice();
          [swapped[i], swapped[i + 1]] = [swapped[i + 1], swapped[i]];
          proposals.push(swapped.flat());
        }
        for (let i = 0; i + 1 < incumbent.length; i++) {
          if (nodes[incumbent[i]].thread !== nodes[incumbent[i + 1]].thread) continue;
          const swapped = incumbent.slice();
          [swapped[i], swapped[i + 1]] = [swapped[i + 1], swapped[i]];
          proposals.push(swapped);
        }
        let evaluated = 0;
        for (const proposal of proposals) {
          if (seen.has(proposal.join(',')) || !valid(proposal)) continue;
          evaluate(proposal);
          if (++evaluated >= 8 || commands > 20_000) break;
        }
        if (improved === incumbent || commands > 20_000) break;
      }
    }
  }

  return improved.map((i) => ({ kind: 'element', elementId: nodes[i].elementId }));
}
