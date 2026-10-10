// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Blanket (E-stitch): a running baseline along the path with prongs sewn out and back,
 * perpendicular to the path, at a regular spacing. Corners always get a prong.
 */
import { flattenToPaths } from '@/geom/flatten';
import { signedArea } from '@/geom/polygon';
import { resampleEven, vertexNormals } from '@/geom/polyline';
import type { Polyline } from '@/geom/types';
import type { StitchTypeDef } from '../../def';
import { num, str } from '../../params/types';
import { beanify } from '../common';
import { routeFixedPaths, type FixedPath } from '../p2util';

export interface BlanketPrep {
  paths: FixedPath[];
}

/** Sign applied to the +normal (−dy, dx) for the requested side. In y-down documents +normal is
 * to the right of the direction of travel. */
function sideSign(side: string, pl: Polyline, closed: boolean): number {
  if ((side === 'inside' || side === 'outside') && closed) {
    // Positive shoelace area: the interior is on the +normal side.
    const inside = signedArea(pl.subarray(0, pl.length - 2)) > 0 ? 1 : -1;
    return side === 'inside' ? inside : -inside;
  }
  return side === 'right' ? 1 : -1;
}

export function blanketPath(
  pl: Polyline,
  closed: boolean,
  spacing: number,
  width: number,
  side: string,
  bean: number,
): FixedPath | null {
  const base = resampleEven(pl, spacing, 30);
  const n = base.length / 2;
  if (n < 2) return null;
  const normals = vertexNormals(base, closed);
  const sg = sideSign(side, pl, closed);
  const out: number[] = [];
  const anchors: number[] = [];
  for (let i = 0; i < n; i++) {
    const x = base[i * 2],
      y = base[i * 2 + 1];
    anchors.push(out.length / 2);
    out.push(x, y);
    // A closed path ends on its start point, which already has a prong.
    if (closed && i === n - 1) break;
    const nx = normals[i * 2] * sg,
      ny = normals[i * 2 + 1] * sg;
    out.push(x + nx * width, y + ny * width, x, y);
  }
  const pts = beanify(Float64Array.from(out), bean);
  // Anchor indices refer to the un-beaned sequence; bean expands each stitch to 2·bean + 1 steps.
  const scale = 2 * bean + 1;
  return { pts, closed, anchors: closed ? anchors.slice(0, -1).map((a) => a * scale) : undefined };
}

export const blanketDef: StitchTypeDef<BlanketPrep> = {
  id: 'blanket',
  label: 'Blanket (E-stitch)',
  description: 'A run with prongs sewn out and back at regular spacing. For appliqué edges and borders.',
  role: 'outline',
  params: [
    {
      key: 'spacing',
      label: 'Prong spacing',
      help: 'Distance between prongs along the path. Corners always get a prong.',
      kind: 'length',
      unit: 'mm',
      min: 0.5,
      max: 10,
      step: 0.1,
      group: 'basic',
    },
    {
      key: 'width',
      label: 'Prong width',
      help: 'Length of each prong, measured from the path.',
      kind: 'length',
      unit: 'mm',
      min: 0.5,
      max: 10,
      step: 0.1,
      group: 'basic',
    },
    {
      key: 'side',
      label: 'Prong side',
      help: 'Side of the path the prongs point to. Inside/outside apply to closed paths; open paths use left.',
      kind: 'enum',
      options: [
        { value: 'inside', label: 'Inside' },
        { value: 'outside', label: 'Outside' },
        { value: 'left', label: 'Left' },
        { value: 'right', label: 'Right' },
      ],
      group: 'basic',
    },
    {
      key: 'bean',
      label: 'Bean repeats',
      help: 'Extra back-and-forth passes over every stitch for a bolder line. 0 = single.',
      kind: 'number',
      min: 0,
      max: 2,
      step: 1,
      group: 'advanced',
    },
  ],
  defaults: { spacing: 2.5, width: 2.5, side: 'inside', bean: 0 },
  appliesTo: (s) => s.hasClosed || s.hasOpen,
  prepare(geom, params, _el, ctx) {
    const spacing = Math.max(0.3, num(params, 'spacing', 2.5));
    const width = Math.max(0.1, num(params, 'width', 2.5));
    const side = str(params, 'side', 'inside');
    const bean = Math.max(0, Math.min(3, Math.round(num(params, 'bean', 0))));
    const paths: FixedPath[] = [];
    for (const { pts, closed } of flattenToPaths(geom, ctx.tolerance)) {
      const p = blanketPath(pts, closed, spacing, width, side, bean);
      if (p) paths.push(p);
    }
    return { paths };
  },
  route(prep, hints) {
    return routeFixedPaths(prep.paths, hints.entry, hints.exit).build();
  },
};
