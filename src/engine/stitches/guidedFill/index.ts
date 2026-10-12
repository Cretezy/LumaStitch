// SPDX-License-Identifier: GPL-3.0-or-later
/** Arbitrary Bézier guides: translated copies or constant-distance offset contours. */
import { clipPolylines, offset, offsetPolylines } from '@/geom/clipper';
import { flattenSubpath } from '@/geom/flatten';
import { polyShapeBBox } from '@/geom/polygon';
import { nearestOnPolyline, reversePolyline, rotateClosedTo } from '@/geom/polyline';
import type { PolyShape, Polyline } from '@/geom/types';
import type { StitchTypeDef } from '../../def';
import { num, str } from '../../params/types';
import { F } from '../../types';
import { RunBuilder, runningPoints } from '../common';
import { closeRing } from '../p2util';
import {
  fillPolygon,
  makeRouter,
  prepareTatamiLike,
  routeTatami,
  tatamiDefaults,
  tatamiParams,
  travelTo,
  type TatamiPrep,
} from '../tatami';

export type GuideMode = 'copy' | 'parallel' | 'buffer';

function extend(line: Polyline, distance: number): Polyline {
  const a = Array.from(line);
  const n = a.length;
  const first = Math.hypot(a[2] - a[0], a[3] - a[1]);
  const last = Math.hypot(a[n - 2] - a[n - 4], a[n - 1] - a[n - 3]);
  if (first > 0)
    a.unshift(a[0] - ((a[2] - a[0]) * distance) / first, a[1] - ((a[3] - a[1]) * distance) / first);
  if (last > 0)
    a.push(
      line[n - 2] + ((line[n - 2] - line[n - 4]) * distance) / last,
      line[n - 1] + ((line[n - 1] - line[n - 3]) * distance) / last,
    );
  return Float64Array.from(a);
}

/** Rows clipped at 1 µm precision. Offset contours resolve self-intersections through Clipper. */
export function guidedRows(
  area: PolyShape,
  guides: Polyline[],
  spacing: number,
  mode: GuideMode,
  angle: number,
): Polyline[][] {
  if (!area.length || !guides.length) return [];
  const bounds = polyShapeBBox(area);
  const radius =
    Math.max(
      ...[bounds.minX, bounds.maxX].flatMap((x) =>
        [bounds.minY, bounds.maxY].map((y) => Math.hypot(x - guides[0][0], y - guides[0][1])),
      ),
    ) + spacing;
  if (radius / spacing > 2000)
    throw new Error('Guided fill exceeds 2000 offset levels; increase row spacing or move the guide closer.');
  const source = mode === 'buffer' ? guides : guides.map((p) => extend(p, radius * 2));
  const rows: Polyline[][] = [];
  if (mode === 'copy') {
    const nx = Math.cos((angle * Math.PI) / 180),
      ny = Math.sin((angle * Math.PI) / 180);
    // Bounds in the translation frame guarantee every potentially intersecting copy is considered.
    const corners = [bounds.minX, bounds.maxX].flatMap((x) =>
      [bounds.minY, bounds.maxY].map((y) => x * nx + y * ny),
    );
    let lo = Infinity,
      hi = -Infinity;
    for (const g of source)
      for (let i = 0; i < g.length; i += 2) {
        const p = g[i] * nx + g[i + 1] * ny;
        lo = Math.min(lo, p);
        hi = Math.max(hi, p);
      }
    const start = Math.ceil((Math.min(...corners) - hi) / spacing),
      end = Math.floor((Math.max(...corners) - lo) / spacing);
    if (end - start > 4000)
      throw new Error('Guided fill exceeds 4000 copy rows; increase spacing or change the copy direction.');
    for (let k = start; k <= end; k++) {
      const lines = source.map((g) => Float64Array.from(g, (v, i) => v + k * spacing * (i % 2 ? ny : nx)));
      const clipped = clipPolylines(lines, area);
      if (clipped.length) rows.push(clipped);
    }
  } else {
    rows.push(clipPolylines(guides, area));
    for (let d = spacing; d <= radius; d += spacing) {
      const buffer = offsetPolylines(source, d, 'round', mode === 'buffer' ? 'round' : 'butt');
      const clipped = clipPolylines(
        buffer.flatMap((p) => [p.outer, ...p.holes].map(closeRing)),
        area,
      );
      if (clipped.length) rows.push(clipped);
    }
  }
  return rows.filter((r) => r.length);
}

interface Prep {
  rows: Polyline[][];
  underlay: TatamiPrep;
  router: ReturnType<typeof makeRouter>;
  travelLen: number;
  travelLimit: number;
}
export const guidedFillDef: StitchTypeDef<Prep> = {
  id: 'guidedFill',
  label: 'Guided fill',
  role: 'fill',
  description:
    'Curved rows follow editable open guide paths. Select a closed shape and an open path, then Object → Make guided fill.',
  defaults: { ...tatamiDefaults, guideMode: 'parallel', copyAngle: 90, travelLimit: 4 },
  params: [
    {
      key: 'travelLimit',
      label: 'Maximum row travel',
      kind: 'length',
      unit: 'mm',
      min: 0.5,
      max: 20,
      step: 0.5,
      group: 'advanced',
      help: 'Longer moves between guide rows are trimmed to avoid visible lines across completed fill.',
    },
    {
      key: 'guideMode',
      label: 'Guide strategy',
      kind: 'enum',
      group: 'basic',
      options: [
        { value: 'parallel', label: 'Parallel offset' },
        { value: 'copy', label: 'Translated copies' },
        { value: 'buffer', label: 'Buffer around guide' },
      ],
    },
    {
      key: 'copyAngle',
      label: 'Copy direction',
      kind: 'angle',
      unit: '°',
      min: 0,
      max: 360,
      step: 1,
      group: 'basic',
      visibleIf: (p) => p.guideMode === 'copy',
    },
    ...tatamiParams
      .filter((p) => !['offset'].includes(p.key))
      .map((p) => (p.key === 'angle' ? { ...p, label: 'Underlay direction' } : p)),
  ],
  appliesTo: (s) => s.hasClosed,
  prepare(geom, params, _el, ctx) {
    const guides = geom.subpaths
      .filter((p) => !p.closed)
      .map((p) => flattenSubpath(p, Math.min(ctx.tolerance, 0.03)))
      .filter((p) => p.length >= 4);
    const base = fillPolygon(geom, params, ctx);
    const area = offset(base, num(params, 'pullComp', 0.2));
    const underlay = prepareTatamiLike(geom, params, ctx);
    underlay.top.sections = [];
    underlay.topPart = new Int32Array(0);
    underlay.empty = false;
    let rows: Polyline[][] = [];
    if (!guides.length)
      ctx.diag(
        'guided-path',
        'Guided fill needs an open guide path. Select the fill shape and a guide, then Object → Make guided fill.',
        undefined,
        'error',
      );
    else
      try {
        rows = guidedRows(
          area,
          guides,
          Math.max(0.1, num(params, 'density', 0.4)),
          str(params, 'guideMode', 'parallel') as GuideMode,
          num(params, 'copyAngle', 90),
        );
        // Re-clip the penetration chords as well as their source curves: a long needle chord
        // must not cut through a hole or concave boundary even when its endpoints are inside.
        rows = rows.map((row) =>
          clipPolylines(
            row.map((p) => runningPoints(p, Math.max(0.5, num(params, 'stitchLength', 3.5)))),
            area,
          ),
        );
        if (rows.reduce((n, row) => n + row.length, 0) > 6000)
          throw new Error('Guided fill exceeds 6000 clipped paths; simplify guides or increase spacing.');
        if (!rows.some((r) => r.length))
          ctx.diag('guided-empty', 'The guide produces no rows inside the fill.', undefined, 'error');
      } catch (e) {
        rows = [];
        ctx.diag('guided-limit', e instanceof Error ? e.message : String(e), undefined, 'error');
      }
    const travelArea = offset(area, -0.25);
    return {
      rows,
      underlay,
      router: makeRouter(travelArea.length ? travelArea : area),
      travelLen: Math.max(0.5, num(params, 'travelStitchLength', 2)),
      travelLimit: Math.max(0.5, num(params, 'travelLimit', 4)),
    };
  },
  route(prep, hints) {
    const b = new RunBuilder();
    if (!prep.rows.length) return b.build();
    b.append(routeTatami(prep.underlay, { entry: hints.entry }));
    // Route adjacent curves together instead of alternating the two sides of every offset
    // level, which repeatedly crosses the guide and leaves visible travel on finished rows.
    const remaining = prep.rows.flat();
    let sewnRows = 0;
    while (remaining.length) {
      const cur = b.last() ?? hints.entry;
      let bi = 0,
        rev = false,
        best = Infinity;
      remaining.forEach((p, i) => {
        const closed = Math.hypot(p[0] - p[p.length - 2], p[1] - p[p.length - 1]) < 0.002;
        if (closed && cur) {
          const d = nearestOnPolyline(p, ...cur).dist;
          if (d < best) {
            best = d;
            bi = i;
            rev = false;
          }
        } else
          for (const backwards of [false, true]) {
            const j = backwards ? p.length - 2 : 0;
            let d = cur ? Math.hypot(p[j] - cur[0], p[j + 1] - cur[1]) : 0;
            if (remaining.length === 1 && hints.exit) {
              const k = backwards ? 0 : p.length - 2;
              d += Math.hypot(p[k] - hints.exit[0], p[k + 1] - hints.exit[1]);
            }
            if (d < best) {
              best = d;
              bi = i;
              rev = backwards;
            }
          }
      });
      const p = remaining.splice(bi, 1)[0];
      const closed = Math.hypot(p[0] - p[p.length - 2], p[1] - p[p.length - 1]) < 0.002;
      const points = closed && cur ? rotateClosedTo(p, ...cur) : rev ? reversePolyline(p) : p;
      if (sewnRows && cur && Math.hypot(points[0] - cur[0], points[1] - cur[1]) > prep.travelLimit)
        b.jumpTo(points[0], points[1], F.TRIM);
      else travelTo(b, [points[0], points[1]], prep);
      b.pushPolyline(points, 0, true);
      sewnRows++;
    }
    if (hints.userExit && hints.exit && prep.router?.isInside(...hints.exit)) travelTo(b, hints.exit, prep);
    return b.build();
  },
};
