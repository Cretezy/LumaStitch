// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Paper.js adapter (ARCHITECTURE §1.6, §9, §10.2). The only module that touches Paper.
 *
 * Converts the model's `PathGeom` (plain JSON, mm) to and from `paper.CompoundPath`, and offers
 * the vector-editing operations built on Paper: booleans, nearest point, node insertion
 * (`divideAt`), smoothing, simplification (curve refit), exact bounds, area, break apart /
 * combine, join, open / close.
 *
 * Every function is pure: inputs are never mutated and the returned geometry is freshly
 * allocated. Paper items are created in a private `PaperScope` with `insertItems = false`, so
 * nothing accumulates in a project and other Paper users (if any) are not disturbed — except
 * that the private scope is *activated* on each call.
 *
 * ── Worker spike (2026-10-10) ────────────────────────────────────────────────────────────────
 * Q: Can paper-core run inside a (module) Web Worker?
 * A: YES. In a worker `self.window` is undefined, so paper-core skips every DOM/canvas path:
 *    `View.create` falls back to the canvas-less `View`, and `navigator.userAgent` (used for
 *    agent sniffing) exists in workers. `new PaperScope()` + `setup(new Size(1, 1))` works,
 *    and so do path-data parsing (incl. arcs), booleans, nearest location, `divideAt`,
 *    `simplify`, `reorient` and exact bounds. Verified by `paperAdapter.browser.test.ts`
 *    ("runs inside a module Web Worker"), which imports this very module in a
 *    `new Worker(new URL(...), { type: 'module' })` (Chromium, Vite dev transform).
 *    Note: paper-core does NOT load in plain Node (it requires jsdom when `self` is missing),
 *    so tests for this module must use the browser project.
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 */
import paper from 'paper/dist/paper-core';
import type { Matrix, Node, PathGeom, Subpath, Vec2 } from '@/model/types';
import type { BBox } from './types';

export type FillRule = PathGeom['fillRule'];
export type BooleanOp = 'unite' | 'subtract' | 'intersect' | 'exclude' | 'divide';

/** A point on a geometry: curve `segmentIndex` of subpath `subpathIndex` at curve-time `t`. */
export interface PathLocation {
  subpathIndex: number;
  /** Index of the curve = index of its start node. For closed subpaths the last curve wraps to node 0. */
  segmentIndex: number;
  /** Curve time 0..1. */
  t: number;
  point: Vec2;
  distance: number;
}

export interface NodeRef {
  subpathIndex: number;
  nodeIndex: number;
}

export interface EndpointRef {
  subpathIndex: number;
  end: 'start' | 'end';
}

/* ───────────────────────────── Paper scope ───────────────────────────── */

let scope: paper.PaperScope | null = null;

/** The adapter's private, activated Paper scope (canvas-less in workers). */
export function getPaper(): paper.PaperScope {
  if (!scope) {
    const s = new paper.PaperScope();
    s.settings.insertItems = false;
    s.setup(new s.Size(1, 1));
    // Items are never drawn: don't schedule animation-frame redraws on every change.
    if (s.view) s.view.autoUpdate = false;
    scope = s;
  }
  scope.activate();
  return scope;
}

const EPS = 1e-9;
/** Endpoints closer than this (mm) are considered coincident when closing / joining. */
export const JOIN_TOLERANCE = 1e-3;

const pt = (v: Vec2) => new paper.Point(v[0], v[1]);
const vec = (p: paper.Point): Vec2 => [p.x, p.y];
const isZero = (v: Vec2 | undefined) => !v || (Math.abs(v[0]) < EPS && Math.abs(v[1]) < EPS);

function cloneNode(n: Node): Node {
  const c: Node = { p: [n.p[0], n.p[1]] };
  if (n.in) c.in = [n.in[0], n.in[1]];
  if (n.out) c.out = [n.out[0], n.out[1]];
  if (n.smooth) c.smooth = true;
  return c;
}
function cloneSubpath(s: Subpath): Subpath {
  return { closed: s.closed, nodes: s.nodes.map(cloneNode) };
}
export function cloneGeom(g: PathGeom): PathGeom {
  return { fillRule: g.fillRule, subpaths: g.subpaths.map(cloneSubpath) };
}

/** True if both handles are present and anti-parallel (a smooth node). */
function handlesSmooth(hin: Vec2 | undefined, hout: Vec2 | undefined): boolean {
  if (isZero(hin) || isZero(hout)) return false;
  const [ax, ay] = hin!;
  const [bx, by] = hout!;
  const la = Math.hypot(ax, ay);
  const lb = Math.hypot(bx, by);
  const cross = Math.abs(ax * by - ay * bx) / (la * lb);
  const dot = (ax * bx + ay * by) / (la * lb);
  return cross < 1e-3 && dot < 0;
}

/* ───────────────────────────── Conversion ───────────────────────────── */

export function subpathToPaper(sp: Subpath): paper.Path {
  getPaper();
  const segments = sp.nodes.map(
    (n) =>
      new paper.Segment(
        pt(n.p),
        n.in ? pt(n.in) : new paper.Point(0, 0),
        n.out ? pt(n.out) : new paper.Point(0, 0),
      ),
  );
  const path = new paper.Path({ insert: false });
  path.addSegments(segments);
  path.closed = sp.closed;
  return path;
}

/** PathGeom → CompoundPath (always a compound, even for one subpath). Caller owns the item. */
export function toPaper(geom: PathGeom): paper.CompoundPath {
  getPaper();
  const cp = new paper.CompoundPath({ insert: false });
  cp.addChildren(geom.subpaths.filter((s) => s.nodes.length > 0).map(subpathToPaper));
  cp.fillRule = geom.fillRule;
  return cp;
}

function pathToSubpath(path: paper.Path): Subpath {
  const nodes: Node[] = path.segments.map((s) => {
    const n: Node = { p: vec(s.point) };
    const hin = vec(s.handleIn);
    const hout = vec(s.handleOut);
    if (!isZero(hin)) n.in = hin;
    if (!isZero(hout)) n.out = hout;
    if (handlesSmooth(n.in, n.out)) n.smooth = true;
    return n;
  });
  return { closed: path.closed, nodes };
}

/**
 * Paper item (Path, CompoundPath or Group of those) → PathGeom. Paper segments map 1:1 to
 * nodes (handles relative). `smooth` is inferred from anti-parallel handles.
 */
export function fromPaper(item: paper.Item, fillRule?: FillRule): PathGeom {
  const subpaths: Subpath[] = [];
  const visit = (it: paper.Item) => {
    if (it instanceof paper.Path) {
      if (it.segments.length > 0) subpaths.push(pathToSubpath(it));
    } else if (it.children) {
      for (const c of it.children) visit(c);
    }
  };
  visit(item);
  const rule: FillRule =
    fillRule ?? ((item as paper.PathItem).fillRule === 'evenodd' ? 'evenodd' : 'nonzero');
  return { subpaths, fillRule: rule };
}

const toPaperMatrix = (m: Matrix) => new paper.Matrix(m[0], m[1], m[2], m[3], m[4], m[5]);

/**
 * Parse SVG path data with Paper (arcs become cubics). If `matrix` is given it is baked into the
 * anchors and handles.
 */
export function parsePathDataPaper(d: string, matrix?: Matrix, fillRule: FillRule = 'nonzero'): PathGeom {
  getPaper();
  const cp = new paper.CompoundPath({ insert: false });
  cp.pathData = d;
  if (matrix) cp.transform(toPaperMatrix(matrix));
  return fromPaper(cp, fillRule);
}

/** Bake an affine matrix into a geometry (pure; no Paper). */
export function transformGeom(geom: PathGeom, m: Matrix): PathGeom {
  const ap = (v: Vec2): Vec2 => [m[0] * v[0] + m[2] * v[1] + m[4], m[1] * v[0] + m[3] * v[1] + m[5]];
  const al = (v: Vec2): Vec2 => [m[0] * v[0] + m[2] * v[1], m[1] * v[0] + m[3] * v[1]];
  return {
    fillRule: geom.fillRule,
    subpaths: geom.subpaths.map((s) => ({
      closed: s.closed,
      nodes: s.nodes.map((n) => {
        const c: Node = { p: ap(n.p) };
        if (n.in) c.in = al(n.in);
        if (n.out) c.out = al(n.out);
        if (n.smooth) c.smooth = true;
        return c;
      }),
    })),
  };
}

/** Path data (absolute, M/C/L/Z) for a geometry — handy for SVG output and debugging. */
export function toPathData(geom: PathGeom): string {
  getPaper();
  return toPaper(geom).pathData;
}

/* ───────────────────────────── Booleans ───────────────────────────── */

function closedOnly(geom: PathGeom): PathGeom {
  return { fillRule: geom.fillRule, subpaths: geom.subpaths.filter((s) => s.closed && s.nodes.length > 0) };
}

/** Signed area of a Path or CompoundPath (Paper types omit `area` on PathItem). */
function itemArea(it: paper.PathItem): number {
  return (it as paper.PathItem & { area: number }).area;
}

function isEmptyItem(it: paper.PathItem): boolean {
  return fromPaper(it).subpaths.length === 0;
}

/**
 * Boolean operation on filled geometries (open subpaths are ignored — they have no area).
 * `geoms` are in z-order, bottom → top.
 *
 * - unite / intersect / exclude: folded left to right; returns one geometry (or none if empty).
 * - subtract: the back (first) geometry minus the union of all the others (SPEC FR-1.3).
 * - divide: all non-overlapping pieces of the arrangement, each piece one connected region
 *   (outer + its holes).
 *
 * Results use the nonzero rule with Paper's normalised orientation (outer clockwise on screen,
 * holes counter-clockwise), so they also render correctly under evenodd.
 */
export function booleanGeoms(op: BooleanOp, geoms: PathGeom[]): PathGeom[] {
  getPaper();
  const items = geoms.map((g) => toPaper(closedOnly(g)));
  if (items.length === 0) return [];
  const out = (it: paper.PathItem | null): PathGeom[] => {
    if (!it || isEmptyItem(it)) return [];
    return [fromPaper(it, 'nonzero')];
  };
  const fold = (fn: (a: paper.PathItem, b: paper.PathItem) => paper.PathItem, list: paper.PathItem[]) =>
    list.slice(1).reduce((acc, it) => fn(acc, it), list[0]);
  const opts = { insert: false };
  switch (op) {
    case 'unite':
      return out(fold((a, b) => a.unite(b, opts), items));
    case 'intersect':
      return out(fold((a, b) => a.intersect(b, opts), items));
    case 'exclude':
      return out(fold((a, b) => a.exclude(b, opts), items));
    case 'subtract': {
      if (items.length === 1) return out(items[0].unite(new paper.CompoundPath({ insert: false }), opts));
      const rest = fold((a, b) => a.unite(b, opts), items.slice(1));
      return out(items[0].subtract(rest, opts));
    }
    case 'divide': {
      let pieces: paper.PathItem[] = [];
      let covered: paper.PathItem | null = null;
      for (const it of items) {
        const next: paper.PathItem[] = [];
        for (const p of pieces) {
          next.push(p.intersect(it, opts), p.subtract(it, opts));
        }
        next.push(
          covered ? it.subtract(covered, opts) : it.unite(new paper.CompoundPath({ insert: false }), opts),
        );
        covered = covered ? covered.unite(it, opts) : it;
        pieces = next.filter((p) => !isEmptyItem(p) && Math.abs(itemArea(p)) > 1e-9);
      }
      const result: PathGeom[] = [];
      for (const p of pieces) {
        for (const g of splitSubpaths(fromPaper(p, 'nonzero'))) {
          if (geomArea(g) > 1e-9) result.push(g);
        }
      }
      return result;
    }
  }
}

/**
 * Clip a geometry by a clip region (SVG `clip-path`). `mode: 'fill'` intersects areas (open
 * subpaths are closed implicitly by Paper); `mode: 'stroke'` keeps the parts of every subpath's
 * outline inside the clip as open subpaths. Returns null if nothing remains.
 */
export function clipGeom(geom: PathGeom, clip: PathGeom, mode: 'fill' | 'stroke' = 'fill'): PathGeom | null {
  getPaper();
  const c = toPaper(closedOnly(clip));
  if (c.children.length === 0) return null;
  const g = toPaper(geom);
  if (g.children.length === 0) return null;
  // Fast paths: no boundary crossings → entirely inside or entirely outside.
  if (g.getIntersections(c).length === 0) {
    const probe = (g.firstChild as paper.Path).firstSegment.point;
    // A probe on the clip boundary is ambiguous; fall through to the boolean in that case.
    if (c.getNearestPoint(probe).getDistance(probe) > 1e-7) {
      return c.contains(probe) ? cloneGeom(geom) : null;
    }
  }
  if (mode === 'fill') {
    const r = g.intersect(c, { insert: false });
    const res = fromPaper(r, 'nonzero');
    return res.subpaths.length ? res : null;
  }
  const subpaths: Subpath[] = [];
  for (const sp of geom.subpaths) {
    if (sp.nodes.length < 2) continue;
    const r = subpathToPaper(sp).intersect(c, { insert: false, stroke: true } as object);
    subpaths.push(...fromPaper(r).subpaths);
  }
  return subpaths.length ? { fillRule: geom.fillRule, subpaths } : null;
}

/* ───────────────────────────── Measurement ───────────────────────────── */

/** Exact bounds (curve extrema included), or null for empty geometry. */
export function geomBounds(geom: PathGeom): BBox | null {
  if (!geom.subpaths.some((s) => s.nodes.length > 0)) return null;
  const b = toPaper(geom).bounds;
  return { minX: b.left, minY: b.top, maxX: b.right, maxY: b.bottom };
}

/** Union of the exact bounds of several geometries. */
export function geomsBounds(geoms: PathGeom[]): BBox | null {
  let r: BBox | null = null;
  for (const g of geoms) {
    const b = geomBounds(g);
    if (!b) continue;
    r = r
      ? {
          minX: Math.min(r.minX, b.minX),
          minY: Math.min(r.minY, b.minY),
          maxX: Math.max(r.maxX, b.maxX),
          maxY: Math.max(r.maxY, b.maxY),
        }
      : b;
  }
  return r;
}

/** Filled area (mm²) honouring the fill rule; open subpaths are ignored. */
export function geomArea(geom: PathGeom): number {
  const g = closedOnly(geom);
  if (g.subpaths.length === 0) return 0;
  const cp = toPaper(g) as paper.CompoundPath & { resolveCrossings(): paper.PathItem };
  const resolved = cp.resolveCrossings().reorient(geom.fillRule === 'nonzero', true);
  return Math.abs(itemArea(resolved));
}

/* ───────────────────────────── Node editing ───────────────────────────── */

/** Nearest point on the geometry's outline, or null for empty geometry. */
export function nearestLocation(geom: PathGeom, point: Vec2): PathLocation | null {
  getPaper();
  let best: PathLocation | null = null;
  geom.subpaths.forEach((sp, subpathIndex) => {
    if (sp.nodes.length === 0) return;
    let loc: PathLocation;
    if (sp.nodes.length === 1) {
      const p = sp.nodes[0].p;
      loc = {
        subpathIndex,
        segmentIndex: 0,
        t: 0,
        point: [p[0], p[1]],
        distance: Math.hypot(p[0] - point[0], p[1] - point[1]),
      };
    } else {
      const path = subpathToPaper(sp);
      const l = path.getNearestLocation(pt(point));
      if (!l) return;
      loc = {
        subpathIndex,
        segmentIndex: l.curve.index,
        t: l.time,
        point: vec(l.point),
        distance: l.distance,
      };
    }
    if (!best || loc.distance < best.distance) best = loc;
  });
  return best;
}

/**
 * Insert a node at a location (Paper `divideAtTime`), preserving the curve's shape exactly.
 * Returns the new geometry and the index of the inserted node within its subpath. If `t` is at
 * an existing node (t ≈ 0 or 1) nothing is inserted and that node's index is returned.
 */
export function insertNodeAt(
  geom: PathGeom,
  loc: Pick<PathLocation, 'subpathIndex' | 'segmentIndex' | 't'>,
): { geom: PathGeom; nodeIndex: number } {
  const out = cloneGeom(geom);
  const sp = out.subpaths[loc.subpathIndex];
  const n = sp?.nodes.length ?? 0;
  if (!sp || n < 2) return { geom: out, nodeIndex: 0 };
  const curveCount = sp.closed ? n : n - 1;
  const ci = Math.max(0, Math.min(curveCount - 1, loc.segmentIndex));
  if (loc.t <= 1e-6) return { geom: out, nodeIndex: ci };
  if (loc.t >= 1 - 1e-6) return { geom: out, nodeIndex: (ci + 1) % n };
  const path = subpathToPaper(sp);
  path.curves[ci].divideAtTime(loc.t);
  const divided = pathToSubpath(path);
  // Keep the original nodes' explicit smooth flags; the new node is smooth unless it sits on a line.
  const newNodes = divided.nodes.map((node, i) => {
    if (i === ci + 1) return node;
    const orig = sp.nodes[i <= ci ? i : i - 1];
    const c = { ...node };
    if (orig.smooth) c.smooth = true;
    else delete c.smooth;
    return c;
  });
  out.subpaths[loc.subpathIndex] = { closed: sp.closed, nodes: newNodes };
  return { geom: out, nodeIndex: ci + 1 };
}

/** Remove nodes. Subpaths left with fewer than 2 nodes are dropped. */
export function removeNodes(geom: PathGeom, refs: NodeRef[]): PathGeom {
  const kill = new Set(refs.map((r) => `${r.subpathIndex}:${r.nodeIndex}`));
  const subpaths: Subpath[] = [];
  geom.subpaths.forEach((sp, si) => {
    const nodes = sp.nodes.filter((_, ni) => !kill.has(`${si}:${ni}`)).map(cloneNode);
    if (nodes.length >= 2) subpaths.push({ closed: sp.closed, nodes });
  });
  return { fillRule: geom.fillRule, subpaths };
}

/**
 * Toggle corner/smooth: a smooth node becomes a corner (handles retracted); a corner becomes
 * smooth (handles computed from its neighbours, Catmull-Rom like Paper's `Segment#smooth`).
 */
export function toggleSmooth(geom: PathGeom, refs: NodeRef[]): PathGeom {
  const out = cloneGeom(geom);
  const bySub = new Map<number, number[]>();
  for (const r of refs) {
    if (!out.subpaths[r.subpathIndex]?.nodes[r.nodeIndex]) continue;
    bySub.set(r.subpathIndex, [...(bySub.get(r.subpathIndex) ?? []), r.nodeIndex]);
  }
  for (const [si, idxs] of bySub) {
    const sp = out.subpaths[si];
    const path = subpathToPaper(sp);
    for (const ni of idxs) {
      const node = sp.nodes[ni];
      if (node.smooth) {
        delete node.in;
        delete node.out;
        delete node.smooth;
      } else {
        const seg = path.segments[ni];
        seg.smooth({ type: 'catmull-rom', factor: 0.5 });
        const hin = vec(seg.handleIn);
        const hout = vec(seg.handleOut);
        if (isZero(hin)) delete node.in;
        else node.in = hin;
        if (isZero(hout)) delete node.out;
        else node.out = hout;
        node.smooth = !isZero(hin) || !isZero(hout);
        if (!node.smooth) delete node.smooth;
      }
    }
  }
  return out;
}

function reverseSubpath(sp: Subpath): Subpath {
  const flip = (n: Node): Node => {
    const c: Node = { p: [n.p[0], n.p[1]] };
    if (n.out) c.in = [n.out[0], n.out[1]];
    if (n.in) c.out = [n.in[0], n.in[1]];
    if (n.smooth) c.smooth = true;
    return c;
  };
  const rev = sp.nodes.slice().reverse().map(flip);
  // Closed subpaths keep their start node.
  if (sp.closed && rev.length > 1) rev.unshift(rev.pop()!);
  return { closed: sp.closed, nodes: rev };
}

/** Reverse the direction of every subpath (or only those listed). */
export function reverseGeom(geom: PathGeom, subpathIndices?: number[]): PathGeom {
  const only = subpathIndices ? new Set(subpathIndices) : null;
  return {
    fillRule: geom.fillRule,
    subpaths: geom.subpaths.map((s, i) => (!only || only.has(i) ? reverseSubpath(s) : cloneSubpath(s))),
  };
}

/**
 * Refit curves (Paper `simplify`). `tolerance` is the maximum deviation in mm. Curved input is
 * first flattened (tolerance / 4) so the fit follows the true outline, not just the anchors.
 */
export function simplifyGeom(geom: PathGeom, tolerance = 0.1): PathGeom {
  getPaper();
  return {
    fillRule: geom.fillRule,
    subpaths: geom.subpaths.map((sp) => {
      if (sp.nodes.length < 3) return cloneSubpath(sp);
      const path = subpathToPaper(sp);
      if (sp.nodes.some((n) => !isZero(n.in) || !isZero(n.out))) path.flatten(Math.max(tolerance / 4, 1e-4));
      // Paper's closed-path fitting misbehaves around the seam, so fit closed paths as open ones
      // (start point repeated at the end) and close them again afterwards.
      if (sp.closed) {
        path.closed = false;
        path.add(path.firstSegment.point.clone());
      }
      // Paper compares its tolerance with *squared* distances.
      path.simplify(tolerance * tolerance);
      const res = pathToSubpath(path);
      if (sp.closed) {
        res.closed = true;
        if (res.nodes.length > 1) {
          const last = res.nodes.pop()!;
          const first = res.nodes[0];
          if (last.in) first.in = last.in;
          // Re-smooth the seam unless it is a real corner (> 30° turn).
          if (first.in && first.out) {
            const li = Math.hypot(first.in[0], first.in[1]);
            const lo = Math.hypot(first.out[0], first.out[1]);
            const ux = -first.in[0] / li + first.out[0] / lo;
            const uy = -first.in[1] / li + first.out[1] / lo;
            const cos = (-first.in[0] * first.out[0] - first.in[1] * first.out[1]) / (li * lo);
            const lu = Math.hypot(ux, uy);
            if (cos > Math.cos(Math.PI / 6) && lu > EPS) {
              first.in = [(-ux / lu) * li, (-uy / lu) * li];
              first.out = [(ux / lu) * lo, (uy / lu) * lo];
              first.smooth = true;
            }
          }
        }
      }
      return res;
    }),
  };
}

/* ───────────────────────────── Path operations ───────────────────────────── */

/** Combine several geometries into one compound (fill rule of the first). */
export function combine(geoms: PathGeom[]): PathGeom {
  return {
    fillRule: geoms[0]?.fillRule ?? 'nonzero',
    subpaths: geoms.flatMap((g) => g.subpaths.map(cloneSubpath)),
  };
}

/**
 * Break apart: one geometry per filled region (an outer subpath together with the holes it
 * contains, decided by containment under the geometry's fill rule), plus one per open subpath.
 * Subpaths that do not change the filled area (e.g. a same-direction duplicate inside a nonzero
 * fill) are dropped. Orientation is normalised (outer clockwise on screen, holes opposite).
 */
export function splitSubpaths(geom: PathGeom): PathGeom[] {
  getPaper();
  const result: PathGeom[] = [];
  const closed = closedOnly(geom);
  if (closed.subpaths.length === 1) {
    result.push(cloneGeom(closed));
  } else if (closed.subpaths.length > 1) {
    const cp = toPaper(closed);
    cp.reorient(geom.fillRule === 'nonzero', true);
    const paths = (cp.children as paper.Path[]).slice();
    const outers = paths.filter((p) => p.area > 0).sort((a, b) => a.area - b.area);
    const groups = new Map<paper.Path, paper.Path[]>(outers.map((o) => [o, []]));
    for (const h of paths.filter((p) => p.area <= 0)) {
      const probe = h.interiorPoint ?? h.firstSegment.point;
      const hb = h.bounds;
      const owner =
        outers.find(
          (o) => o.bounds.contains(hb) && Math.abs(o.area) > Math.abs(h.area) && o.contains(probe),
        ) ?? outers.find((o) => o.bounds.contains(hb));
      if (owner) groups.get(owner)!.push(h);
    }
    // Keep the original order of outers.
    for (const o of paths.filter((p) => groups.has(p))) {
      result.push({ fillRule: geom.fillRule, subpaths: [o, ...groups.get(o)!].map(pathToSubpath) });
    }
  }
  for (const sp of geom.subpaths) {
    if (!sp.closed && sp.nodes.length > 0)
      result.push({ fillRule: geom.fillRule, subpaths: [cloneSubpath(sp)] });
  }
  return result;
}

const near = (a: Vec2, b: Vec2, tol: number) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= tol;

/** Close a subpath; coincident first/last nodes are merged. */
export function closePath(geom: PathGeom, subpathIndex: number, tolerance = JOIN_TOLERANCE): PathGeom {
  const out = cloneGeom(geom);
  const sp = out.subpaths[subpathIndex];
  if (!sp || sp.closed) return out;
  const n = sp.nodes.length;
  if (n >= 2 && near(sp.nodes[0].p, sp.nodes[n - 1].p, tolerance)) {
    const last = sp.nodes.pop()!;
    if (last.in) sp.nodes[0].in = last.in;
    else delete sp.nodes[0].in;
  }
  sp.closed = true;
  return out;
}

/**
 * Open a closed subpath. Without `atNode` the closing segment is removed. With `atNode` the
 * path is cut at that node: it is duplicated so the outline keeps its shape and the new open
 * path starts and ends there.
 */
export function openPath(geom: PathGeom, subpathIndex: number, atNode?: number): PathGeom {
  const out = cloneGeom(geom);
  const sp = out.subpaths[subpathIndex];
  if (!sp || !sp.closed) return out;
  sp.closed = false;
  if (atNode === undefined || sp.nodes.length < 2) return out;
  const k = ((atNode % sp.nodes.length) + sp.nodes.length) % sp.nodes.length;
  const rotated = [...sp.nodes.slice(k), ...sp.nodes.slice(0, k)];
  const start = cloneNode(rotated[0]);
  const end = cloneNode(rotated[0]);
  delete start.in;
  delete end.out;
  delete start.smooth;
  delete end.smooth;
  sp.nodes = [start, ...rotated.slice(1), end];
  return out;
}

/**
 * Join two open endpoints. The same subpath's two ends → close it. Two different subpaths →
 * one subpath (reversing either as needed) connected by a straight segment, or merged into one
 * node when the endpoints coincide. The joined subpath takes the lower index.
 */
export function joinEndpoints(
  geom: PathGeom,
  a: EndpointRef,
  b: EndpointRef,
  tolerance = JOIN_TOLERANCE,
): PathGeom {
  const spA = geom.subpaths[a.subpathIndex];
  const spB = geom.subpaths[b.subpathIndex];
  if (!spA || !spB || spA.closed || spB.closed) return cloneGeom(geom);
  if (a.subpathIndex === b.subpathIndex) {
    return a.end === b.end ? cloneGeom(geom) : closePath(geom, a.subpathIndex, tolerance);
  }
  const first = a.end === 'end' ? cloneSubpath(spA) : reverseSubpath(spA);
  const second = b.end === 'start' ? cloneSubpath(spB) : reverseSubpath(spB);
  const last = first.nodes[first.nodes.length - 1];
  const head = second.nodes[0];
  let nodes: Node[];
  if (near(last.p, head.p, tolerance)) {
    const merged: Node = { p: last.p };
    if (last.in) merged.in = last.in;
    if (head.out) merged.out = head.out;
    if (handlesSmooth(merged.in, merged.out)) merged.smooth = true;
    nodes = [...first.nodes.slice(0, -1), merged, ...second.nodes.slice(1)];
  } else {
    nodes = [...first.nodes, ...second.nodes];
  }
  const lo = Math.min(a.subpathIndex, b.subpathIndex);
  const hi = Math.max(a.subpathIndex, b.subpathIndex);
  const subpaths = geom.subpaths.map(cloneSubpath);
  subpaths[lo] = { closed: false, nodes };
  subpaths.splice(hi, 1);
  return { fillRule: geom.fillRule, subpaths };
}
