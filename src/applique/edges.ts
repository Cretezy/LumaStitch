// SPDX-License-Identifier: GPL-3.0-or-later
/** Manual border selection follows source Bézier edges through transforms and offsets. */
import { flattenSegment } from '@/geom/flatten';
import { cumulativeLengths, nearestOnPolyline, pointAtLength } from '@/geom/polyline';
import type { PathGeom, StitchElement } from '@/model/types';
import type { PathItem } from '@/engine/stitches/running';

export function edgeTopology(geom: PathGeom) {
  return geom.subpaths.map((p) => `${p.closed ? 'c' : 'o'}${p.nodes.length}`).join(',');
}
export function sourceEdges(geom: PathGeom) {
  return geom.subpaths.flatMap((path, subpath) =>
    Array.from({ length: Math.max(0, path.nodes.length - (path.closed ? 0 : 1)) }, (_, segment) => {
      const a = path.nodes[segment],
        b = path.nodes[(segment + 1) % path.nodes.length],
        points = [...a.p];
      flattenSegment(points, a, b, 0.03);
      return {
        subpath,
        segment,
        points: new Float64Array(points),
        geom: { fillRule: 'nonzero' as const, subpaths: [{ closed: false, nodes: [a, b] }] },
      };
    }),
  );
}

/** Classify the inset cover against the nearest original edge, splitting boundaries to 0.01 mm. */
export function selectCoverEdges(
  paths: PathItem[],
  geom: PathGeom,
  selection: StitchElement['appliqueEdges'],
): PathItem[] {
  if (!selection?.omit.length) return paths;
  if (selection.topology !== edgeTopology(geom))
    throw new Error(
      'Appliqué edge topology changed. Open Appliqué edge coverage to review or reset the omitted edges.',
    );
  const omitted = new Set(selection.omit.map(([p, s]) => `${p}:${s}`));
  const edges = sourceEdges(geom);
  if (
    edges.length > 500 ||
    selection.omit.some(([p, s]) => !edges.some((e) => e.subpath === p && e.segment === s))
  )
    throw new Error('Choose valid edges from a path with at most 500 edges.');
  const segments = edges.flatMap((edge) =>
    Array.from({ length: edge.points.length / 2 - 1 }, (_, i) => ({
      x: edge.points[2 * i],
      y: edge.points[2 * i + 1],
      dx: edge.points[2 * i + 2] - edge.points[2 * i],
      dy: edge.points[2 * i + 3] - edge.points[2 * i + 1],
      omit: omitted.has(`${edge.subpath}:${edge.segment}`),
    })),
  );
  let work = 0;
  const keep = (x: number, y: number) => {
    if ((work += segments.length) > 20_000_000)
      throw new Error('Appliqué edge selection is too complex. Simplify the source paths.');
    let best = Infinity,
      visible = true;
    for (const e of segments) {
      const den = e.dx * e.dx + e.dy * e.dy,
        t = den ? Math.max(0, Math.min(1, ((x - e.x) * e.dx + (y - e.y) * e.dy) / den)) : 0;
      const d = (x - e.x - t * e.dx) ** 2 + (y - e.y - t * e.dy) ** 2;
      if (d < best - 1e-10) {
        best = d;
        visible = !e.omit;
      } else if (Math.abs(d - best) <= 1e-10 && e.omit) visible = false;
    }
    return visible;
  };
  return paths.flatMap(({ pts, closed }) => {
    const lengths = cumulativeLengths(pts),
      length = lengths.at(-1) ?? 0;
    if (!length) return [];
    const count = Math.ceil(length / 0.1),
      chunks: number[][] = [];
    const samples = new Set(Array.from({ length: count }, (_, i) => (length * (i + 1)) / count));
    // Project selected edge endpoints and midpoints so a very short edge cannot fall
    // entirely between the regular samples and disappear from the selection.
    for (const edge of edges)
      if (omitted.has(`${edge.subpath}:${edge.segment}`)) {
        const cum = cumulativeLengths(edge.points),
          total = cum.at(-1) ?? 0;
        for (const at of [0, total / 2, total]) {
          const point = pointAtLength(edge.points, cum, at);
          samples.add(nearestOnPolyline(pts, ...point).s);
        }
      }
    let start = 0,
      previous = keep(pts[0], pts[1]),
      current: number[] = previous ? [pts[0], pts[1]] : [];
    let anyOmitted = !previous;
    const appendRange = (from: number, to: number) => {
      let lo = 0,
        hi = lengths.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (lengths[mid] <= from) lo = mid + 1;
        else hi = mid;
      }
      for (let k = lo; k < lengths.length && lengths[k] < to; k++) current.push(pts[2 * k], pts[2 * k + 1]);
      current.push(...pointAtLength(pts, lengths, to));
    };
    for (const end of [...samples].filter((v) => v > 0).sort((a, b) => a - b)) {
      const p = pointAtLength(pts, lengths, end),
        visible = keep(...p);
      anyOmitted ||= !visible;
      if (visible !== previous) {
        let lo = start,
          hi = end;
        while (hi - lo > 0.005) {
          const mid = (lo + hi) / 2;
          if (keep(...pointAtLength(pts, lengths, mid)) === previous) lo = mid;
          else hi = mid;
        }
        const cut = (lo + hi) / 2;
        if (previous) {
          appendRange(start, cut);
          chunks.push(current);
          current = [];
        } else {
          current = [...pointAtLength(pts, lengths, cut)];
          appendRange(cut, end);
        }
      } else if (visible) appendRange(start, end);
      previous = visible;
      start = end;
    }
    if (!anyOmitted) return [{ pts, closed }];
    if (current.length >= 4) chunks.push(current);
    if (closed && chunks.length > 1 && chunks[0][0] === pts[0] && chunks[0][1] === pts[1]) {
      const last = chunks.at(-1)!;
      if (Math.hypot(last.at(-2)! - pts[0], last.at(-1)! - pts[1]) < 1e-6) {
        chunks[0] = [...last, ...chunks[0].slice(2)];
        chunks.pop();
      }
    }
    return chunks
      .filter((a) => a.length >= 4)
      .map((a) => ({
        pts: new Float64Array(a),
        closed: closed && Math.hypot(a[0] - a.at(-2)!, a[1] - a.at(-1)!) < 1e-6,
      }));
  });
}
