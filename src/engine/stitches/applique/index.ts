// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Appliqué: (1) a placement line shows where to lay the fabric, then the machine stops; (2) a
 * tack-down holds the fabric, then the machine stops so the excess can be trimmed; (3) a satin
 * cover column hides the cut edge. Everything sits inside the outline: the placement and tack-down
 * lines run along the cover's centreline, half its width in from the edge.
 *
 * Machine stops inside the element are requested with a run point flagged F.JUMP | F.STOP:
 * "stop here, then continue at this point" (see plan.ts).
 */
import { clipPolylines, offset } from '@/geom/clipper';
import { rotateClosedTo } from '@/geom/polyline';
import type { Polyline, Ring } from '@/geom/types';
import type { InsideRouter } from '@/geom/visibility';
import type { Vec2 } from '@/model/types';
import type { StitchTypeDef } from '../../def';
import { bool, num, str } from '../../params/types';
import { F } from '../../types';
import { RunBuilder, dist, runningPoints } from '../common';
import { orderPaths, type PathItem } from '../running';
import { closeRing } from '../p2util';
import { columnFromCenterline, satinPass } from '../satin/column';
import { fillPolygon, makeRouter, travelTo } from '../tatami';

export interface AppliquePrep {
  /** Cover centrelines (outer rings and holes), each a ring without a repeated start point. */
  rings: Ring[];
  halfWidth: number;
  density: number;
  placementLength: number;
  tackDown: string;
  tackWidth: number;
  tackSpacing: number;
  shortStitches: boolean;
  router: InsideRouter | null;
  covers?: PathItem[];
  precut: boolean;
}

/** Greedy nearest order of the rings, each rotated to start nearest the previous end. */
function orderRings(rings: Ring[], start: Vec2 | undefined): Polyline[] {
  const remaining = rings.slice();
  const out: Polyline[] = [];
  let cur = start;
  while (remaining.length) {
    let bi = 0,
      bd = Infinity;
    if (cur)
      remaining.forEach((r, i) => {
        for (let k = 0; k < r.length; k += 2) {
          const d = dist(cur![0], cur![1], r[k], r[k + 1]);
          if (d < bd) {
            bd = d;
            bi = i;
          }
        }
      });
    const ring = closeRing(remaining.splice(bi, 1)[0]);
    const rot = cur ? rotateClosedTo(ring, cur[0], cur[1]) : ring;
    out.push(rot);
    cur = [rot[0], rot[1]];
  }
  return out;
}

export const appliqueDef: StitchTypeDef<AppliquePrep> = {
  id: 'applique',
  label: 'Appliqué',
  description:
    'Sews a placement line, stops for you to lay fabric, tacks it down, stops for trimming, then covers the edge with satin.',
  role: 'fill',
  params: [
    {
      key: 'precut',
      label: 'Pre-cut fabric',
      kind: 'boolean',
      group: 'basic',
      help: 'Stop after placement to position a pre-cut patch. Skip the trimming stop after tack-down.',
    },
    {
      key: 'partialCover',
      label: 'Omit covered satin',
      kind: 'boolean',
      group: 'advanced',
      help: 'Omit cover sections fully inside the fabric footprint of later appliqué pieces. Placement and tack-down remain complete.',
    },
    {
      key: 'width',
      label: 'Cover width',
      help: 'Width of the satin that covers the cut fabric edge. It lies inside the outline.',
      kind: 'length',
      unit: 'mm',
      min: 1,
      max: 8,
      step: 0.1,
      group: 'basic',
    },
    {
      key: 'density',
      label: 'Cover density',
      help: 'Peak-to-peak spacing of the satin cover. Smaller is denser.',
      kind: 'length',
      unit: 'mm',
      min: 0.2,
      max: 1.5,
      step: 0.01,
      group: 'basic',
    },
    {
      key: 'tackDown',
      label: 'Tack-down',
      help: 'How the fabric is held before trimming.',
      kind: 'enum',
      options: [
        { value: 'zigzag', label: 'Zigzag' },
        { value: 'running', label: 'Running' },
        { value: 'double', label: 'Double running' },
      ],
      group: 'basic',
    },
    {
      key: 'tackWidth',
      label: 'Tack-down width',
      help: 'Width of the tack-down zigzag (kept inside the cover).',
      kind: 'length',
      unit: 'mm',
      min: 0.5,
      max: 6,
      step: 0.1,
      group: 'basic',
      visibleIf: (p) => p.tackDown === 'zigzag',
    },
    {
      key: 'tackSpacing',
      label: 'Tack-down spacing',
      help: 'Peak-to-peak spacing of the tack-down zigzag.',
      kind: 'length',
      unit: 'mm',
      min: 0.5,
      max: 5,
      step: 0.1,
      group: 'basic',
      visibleIf: (p) => p.tackDown === 'zigzag',
    },
    {
      key: 'placementStitchLength',
      label: 'Placement stitch length',
      help: 'Stitch length of the placement and running tack-down lines.',
      kind: 'length',
      unit: 'mm',
      min: 1,
      max: 6,
      step: 0.1,
      group: 'advanced',
    },
    {
      key: 'pullComp',
      label: 'Pull compensation',
      help: 'Widens the cover satin on each side, because stitches pull the fabric inwards.',
      kind: 'length',
      unit: 'mm',
      min: 0,
      max: 1,
      step: 0.05,
      group: 'compensation',
    },
    {
      key: 'shortStitches',
      label: 'Short stitches on inner curves',
      help: 'Pulls alternate cover penetrations on the inside of tight curves toward the centre.',
      kind: 'boolean',
      group: 'advanced',
    },
  ],
  defaults: {
    precut: false,
    partialCover: false,
    width: 3,
    density: 0.4,
    tackDown: 'zigzag',
    tackWidth: 1.5,
    tackSpacing: 1.5,
    placementStitchLength: 2.5,
    pullComp: 0.2,
    shortStitches: true,
  },
  appliesTo: (s) => s.hasClosed,
  prepare(geom, params, _el, ctx) {
    const base = fillPolygon(geom, params, ctx);
    const width = Math.max(0.5, num(params, 'width', 3));
    const pull = Math.max(0, num(params, 'pullComp', 0.2));
    const centre = base.length ? offset(base, -width / 2) : [];
    const rings: Ring[] = [];
    for (const p of centre) rings.push(p.outer, ...p.holes);
    if (base.length && !rings.length)
      ctx.diag(
        'applique-small',
        `The shape is narrower than the ${width.toFixed(1)} mm cover; nothing to sew.`,
      );
    let travelArea = offset(base, -0.1);
    if (!travelArea.length) travelArea = base;
    return {
      rings,
      covers:
        bool(params, 'partialCover') && ctx.appliqueCoverClip?.length
          ? clipPolylines(
              rings.map(closeRing),
              offset(ctx.appliqueCoverClip, -(width / 2 + pull + 0.1)),
              false,
            ).map((pts) => ({
              pts,
              closed: Math.hypot(pts[0] - pts[pts.length - 2], pts[1] - pts[pts.length - 1]) < 1e-6,
            }))
          : undefined,
      precut: bool(params, 'precut'),
      // The cover's outer edge sits on the outline (plus pull compensation).
      halfWidth: width / 2 + pull,
      density: Math.max(0.1, num(params, 'density', 0.4)),
      placementLength: Math.max(0.5, num(params, 'placementStitchLength', 2.5)),
      tackDown: str(params, 'tackDown', 'zigzag'),
      tackWidth: Math.min(width, Math.max(0.2, num(params, 'tackWidth', 1.5))),
      tackSpacing: Math.max(0.3, num(params, 'tackSpacing', 1.5)),
      shortStitches: bool(params, 'shortStitches', true),
      router: rings.length ? makeRouter(travelArea) : null,
    };
  },
  route(prep, hints) {
    const b = new RunBuilder();
    if (!prep.rings.length) return b.build();
    const t = { router: prep.router, travelLen: 2 };
    const rings = orderRings(prep.rings, hints.entry);
    /** Starts a phase: the first point of every phase after the first carries a machine stop. */
    const begin = (x: number, y: number, phase: number, ri: number) => {
      if (ri === 0 && phase > 0) b.push(x, y, F.JUMP | (phase === 2 && prep.precut ? 0 : F.STOP));
      else if (ri === 0) b.push(x, y);
      // Within a phase, connect rings by inside travel (placement) or a jump (fabric is down).
      else if (phase === 0) travelTo(b, [x, y], t);
      else b.jumpTo(x, y);
    };
    // 1. Placement line.
    rings.forEach((r, ri) => {
      const pts = runningPoints(r, prep.placementLength);
      begin(pts[0], pts[1], 0, ri);
      b.pushPolyline(pts, 0, true);
    });
    // 2. Tack-down.
    rings.forEach((r, ri) => {
      if (prep.tackDown === 'zigzag') {
        const col = columnFromCenterline(r, true, prep.tackWidth / 2);
        const tmp = new RunBuilder();
        satinPass(tmp, col, true, { density: prep.tackSpacing });
        begin(tmp.xy[0], tmp.xy[1], 1, ri);
        b.pushPolyline(tmp.xy, 0, true);
      } else {
        const pts = runningPoints(r, prep.placementLength);
        begin(pts[0], pts[1], 1, ri);
        b.pushPolyline(pts, 0, true);
        if (prep.tackDown === 'double') b.pushPolyline(pts, 0, true);
      }
    });
    // 3. Satin cover.
    const covers = prep.covers
      ? orderPaths(prep.covers, b.last() ?? undefined, 1)
      : rings.map((pts) => ({ pts, closed: true }));
    covers.forEach(({ pts: r, closed }, ri) => {
      const col = columnFromCenterline(r, closed, prep.halfWidth);
      const tmp = new RunBuilder();
      satinPass(tmp, col, true, { density: prep.density, shortStitches: prep.shortStitches, splitAbove: 7 });
      begin(tmp.xy[0], tmp.xy[1], 2, ri);
      b.pushPolyline(tmp.xy, 0, true);
    });
    if (!covers.length && !prep.precut && b.last()) b.push(...b.last()!, F.JUMP | F.STOP);
    return b.build();
  },
};
