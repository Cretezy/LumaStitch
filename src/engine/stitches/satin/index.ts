// SPDX-License-Identifier: GPL-3.0-or-later
/** Satin column (outline) and zigzag outline. */
import { flattenToPaths } from '@/geom/flatten';
import type { StitchTypeDef } from '../../def';
import { bool, num, str, type ParamDef } from '../../params/types';
import { F } from '../../types';
import { RunBuilder } from '../common';
import { orderPaths, type PathItem } from '../running';
import { exactRouteStates } from '../running/exactOrder';
import {
  columnFromCenterline,
  resolveSatinUnderlay,
  satinPass,
  satinPassCount,
  sewColumn,
  type UnderlayKind,
} from './column';

export const SATIN_UNDERLAY_OPTIONS = [
  { value: 'auto', label: 'Auto (by width)' },
  { value: 'none', label: 'None' },
  { value: 'center', label: 'Centre walk' },
  { value: 'edge', label: 'Edge walk' },
  { value: 'zigzag', label: 'Zigzag' },
  { value: 'centerEdge', label: 'Centre + edge walk' },
  { value: 'centerZigzag', label: 'Centre walk + zigzag' },
  { value: 'edgeZigzag', label: 'Edge walk + zigzag' },
];

export const satinCommonParams: ParamDef[] = [
  {
    key: 'density',
    label: 'Density',
    help: 'Peak-to-peak spacing between stitches, measured along the centre. Smaller is denser.',
    kind: 'length',
    unit: 'mm',
    min: 0.2,
    max: 1.5,
    step: 0.01,
    group: 'basic',
  },
  {
    key: 'pullComp',
    label: 'Pull compensation',
    help: 'Widens each side, because stitches pull the fabric inwards.',
    kind: 'length',
    unit: 'mm',
    min: 0,
    max: 1,
    step: 0.05,
    group: 'compensation',
  },
  {
    key: 'underlay',
    label: 'Underlay',
    help: 'Sparse stitches sewn first to stabilise the fabric. Auto: centre walk under 2 mm, edge walk 2–4 mm, edge walk + zigzag above 4 mm.',
    kind: 'enum',
    options: SATIN_UNDERLAY_OPTIONS,
    group: 'underlay',
  },
  {
    key: 'underlayBoost',
    label: 'Underlay boost',
    help: 'Makes auto underlay one level heavier (set by knit and pile fabrics).',
    kind: 'number',
    min: 0,
    max: 2,
    step: 1,
    group: 'underlay',
    visibleIf: (p) => p.underlay === 'auto',
  },
  {
    key: 'underlayInset',
    label: 'Underlay inset',
    help: 'Keeps underlay away from the edges so it does not peek out.',
    kind: 'length',
    unit: 'mm',
    min: 0,
    max: 2,
    step: 0.05,
    group: 'underlay',
  },
  {
    key: 'zigzagUnderlaySpacing',
    label: 'Zigzag underlay spacing',
    kind: 'length',
    unit: 'mm',
    min: 0.5,
    max: 5,
    step: 0.1,
    group: 'underlay',
  },
  {
    key: 'underlayStitchLength',
    label: 'Underlay stitch length',
    kind: 'length',
    unit: 'mm',
    min: 1,
    max: 5,
    step: 0.1,
    group: 'underlay',
  },
  {
    key: 'shortStitches',
    label: 'Short stitches on inner curves',
    help: 'Pulls alternate penetrations on the inside of tight curves toward the centre to avoid bunching.',
    kind: 'boolean',
    group: 'advanced',
  },
  {
    key: 'splitAbove',
    label: 'Split satin above',
    help: 'Stitches longer than this get extra staggered penetrations so they do not snag. 0 = never split.',
    kind: 'length',
    unit: 'mm',
    min: 0,
    max: 12,
    step: 0.5,
    group: 'advanced',
  },
];

export const satinCommonDefaults = {
  density: 0.4,
  pullComp: 0.2,
  underlay: 'auto',
  underlayBoost: 0,
  underlayInset: 0.4,
  zigzagUnderlaySpacing: 2.0,
  underlayStitchLength: 2.0,
  shortStitches: true,
  splitAbove: 7.0,
};

export interface SatinColumnPrep {
  paths: PathItem[];
  halfWidth: number;
  width: number;
  density: number;
  underlay: UnderlayKind;
  underlayInset: number;
  zigzagUnderlaySpacing: number;
  underlayStitchLength: number;
  shortStitches: boolean;
  splitAbove: number;
  zigzag: boolean;
}

function routeColumns(prep: SatinColumnPrep, entry?: [number, number], exit?: [number, number]) {
  const b = new RunBuilder();
  // Price the actual entry/exit needle points, including the underlay passes and rail offsets.
  // Keep both directions intact: choosing a nearest entry again would undo the joint solution.
  if (prep.paths.length <= 12 && prep.paths.every((p) => !p.closed && p.pts.length >= 4)) {
    const runs = prep.paths.flatMap(({ pts }) => {
      const col = columnFromCenterline(pts, false, prep.halfWidth);
      return [true, false].map((forward) => {
        const run = new RunBuilder();
        if (col.length <= 0) return run.build();
        if (prep.zigzag) satinPass(run, col, forward, { density: prep.density });
        else sewColumn(run, col, prep, undefined, undefined, forward);
        return run.build();
      });
    });
    if (runs.every((r) => r.xy.length >= 4)) {
      const order = exactRouteStates(
        runs.map((r) => [r.xy[0], r.xy[1]]),
        runs.map((r) => [r.xy[r.xy.length - 2], r.xy[r.xy.length - 1]]),
        entry,
        exit,
      );
      if (order) {
        for (const state of order) {
          const run = runs[state];
          for (let i = 0; i < run.flags.length; i++)
            b.push(
              run.xy[i * 2],
              run.xy[i * 2 + 1],
              run.flags[i] | (i === 0 && b.length ? F.JUMP | F.TRIM : 0),
            );
        }
        return b.build();
      }
    }
  }
  const ordered = orderPaths(prep.paths, entry, prep.zigzag ? 1 : satinPassCount(prep.underlay), exit);
  ordered.forEach(({ pts, closed }, i) => {
    // orderPaths already chose where closed paths start (between the previous and next path).
    const center = pts;
    const cur = b.last() ?? entry;
    const col = columnFromCenterline(center, closed, prep.halfWidth);
    if (col.length <= 0) return;
    const start = b.length;
    if (prep.zigzag) {
      // Choose the end nearest the current position.
      let fwd = true;
      if (!closed && cur) {
        const d0 = Math.hypot(col.c[0] - cur[0], col.c[1] - cur[1]);
        const n = col.c.length;
        const d1 = Math.hypot(col.c[n - 2] - cur[0], col.c[n - 1] - cur[1]);
        fwd = d0 <= d1;
      }
      satinPass(b, col, fwd, { density: prep.density });
    } else {
      sewColumn(
        b,
        col,
        {
          density: prep.density,
          underlay: prep.underlay,
          underlayInset: prep.underlayInset,
          zigzagUnderlaySpacing: prep.zigzagUnderlaySpacing,
          underlayStitchLength: prep.underlayStitchLength,
          shortStitches: prep.shortStitches,
          splitAbove: prep.splitAbove,
        },
        cur ?? undefined,
        i === ordered.length - 1 ? exit : undefined,
        closed ? undefined : true,
      );
    }
    // Internal jump to the next column; nothing to travel through between separate paths.
    if (i > 0 && b.length > start) b.flags[start] |= F.JUMP | F.TRIM;
  });
  return b.build();
}

export const satinDef: StitchTypeDef<SatinColumnPrep> = {
  id: 'satin',
  label: 'Satin',
  description: 'Dense zigzag spanning a column along the path. Smooth and shiny; for borders, 1–8 mm wide.',
  role: 'outline',
  params: [
    {
      key: 'width',
      label: 'Width',
      help: 'Column width. Defaults to the stroke width. Above 8 mm long stitches may snag.',
      kind: 'length',
      unit: 'mm',
      min: 0.8,
      max: 12,
      step: 0.1,
      group: 'basic',
      allowAuto: true,
    },
    ...satinCommonParams,
  ],
  defaults: { width: 'auto', ...satinCommonDefaults },
  appliesTo: (s) => s.hasClosed || s.hasOpen,
  prepare(geom, params, _el, ctx) {
    const wParam = params.width;
    const width = typeof wParam === 'number' ? wParam : Math.max(0.8, ctx.art?.strokeWidth ?? 2);
    const pull = num(params, 'pullComp', 0.2);
    if (width > 8)
      ctx.diag('satin-wide', `Satin is ${width.toFixed(1)} mm wide; above 8 mm stitches may snag.`);
    if (width < 1)
      ctx.diag('satin-narrow', `Satin is only ${width.toFixed(1)} mm wide; consider a triple run.`);
    return {
      paths: flattenToPaths(geom, ctx.tolerance),
      width,
      halfWidth: width / 2 + pull,
      density: num(params, 'density', 0.4),
      underlay: resolveSatinUnderlay(str(params, 'underlay', 'auto'), width, num(params, 'underlayBoost', 0)),
      underlayInset: num(params, 'underlayInset', 0.4),
      zigzagUnderlaySpacing: num(params, 'zigzagUnderlaySpacing', 2),
      underlayStitchLength: num(params, 'underlayStitchLength', 2),
      shortStitches: bool(params, 'shortStitches', true),
      splitAbove: num(params, 'splitAbove', 7),
      zigzag: false,
    };
  },
  route(prep, hints) {
    return routeColumns(prep, hints.entry, hints.exit);
  },
};

export const zigzagDef: StitchTypeDef<SatinColumnPrep> = {
  id: 'zigzag',
  label: 'Zigzag',
  description: 'An open, low-density zigzag along the path. For tack-downs and decorative edges.',
  role: 'outline',
  params: [
    { key: 'width', label: 'Width', kind: 'length', unit: 'mm', min: 0.5, max: 6, step: 0.1, group: 'basic' },
    {
      key: 'spacing',
      label: 'Spacing',
      help: 'Peak-to-peak distance between zigzags.',
      kind: 'length',
      unit: 'mm',
      min: 0.3,
      max: 5,
      step: 0.1,
      group: 'basic',
    },
  ],
  defaults: { width: 2.0, spacing: 1.0 },
  appliesTo: (s) => s.hasClosed || s.hasOpen,
  prepare(geom, params, _el, ctx) {
    const width = num(params, 'width', 2);
    return {
      paths: flattenToPaths(geom, ctx.tolerance),
      width,
      halfWidth: width / 2,
      density: num(params, 'spacing', 1),
      underlay: 'none',
      underlayInset: 0,
      zigzagUnderlaySpacing: 0,
      underlayStitchLength: 2,
      shortStitches: false,
      splitAbove: 0,
      zigzag: true,
    };
  },
  route(prep, hints) {
    return routeColumns(prep, hints.entry, hints.exit);
  },
};
