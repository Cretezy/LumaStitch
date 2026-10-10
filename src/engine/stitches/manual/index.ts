// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Manual stitching: every node of the shape is a needle penetration, in node order, with no
 * resampling (curve handles are ignored). Stitches are edited with the direct-select node tool.
 * Subpaths are sewn in their stored order, joined by jumps.
 */
import type { Polyline } from '@/geom/types';
import type { StitchTypeDef } from '../../def';
import { bool, num } from '../../params/types';
import { RunBuilder } from '../common';

export interface ManualPrep {
  paths: Polyline[];
}

/** Node positions of every subpath (closed subpaths return to their first node). */
export function manualPaths(
  subpaths: { closed: boolean; nodes: { p: [number, number] }[] }[],
  maxLength: number,
): Polyline[] {
  const out: Polyline[] = [];
  for (const sp of subpaths) {
    const nodes = sp.nodes.map((n) => n.p);
    if (!nodes.length) continue;
    if (sp.closed && nodes.length > 2) nodes.push(nodes[0]);
    const pts: number[] = [nodes[0][0], nodes[0][1]];
    for (let i = 1; i < nodes.length; i++) {
      const [ax, ay] = nodes[i - 1];
      const [bx, by] = nodes[i];
      if (maxLength > 0) {
        const m = Math.ceil(Math.hypot(bx - ax, by - ay) / maxLength - 1e-9);
        for (let j = 1; j < m; j++) pts.push(ax + ((bx - ax) * j) / m, ay + ((by - ay) * j) / m);
      }
      pts.push(bx, by);
    }
    out.push(Float64Array.from(pts));
  }
  return out;
}

export const manualDef: StitchTypeDef<ManualPrep> = {
  id: 'manual',
  label: 'Manual',
  description:
    'Every node is a needle penetration, sewn in order. Place and move stitches one by one with the node tool.',
  role: 'outline',
  params: [
    {
      key: 'splitLong',
      label: 'Split long stitches',
      help: 'Add evenly spaced penetrations to stitches longer than the maximum length.',
      kind: 'boolean',
      group: 'basic',
    },
    {
      key: 'maxLength',
      label: 'Maximum length',
      help: 'Stitches longer than this are split when splitting is on. (Stitches over the design maximum are always split.)',
      kind: 'length',
      unit: 'mm',
      min: 1,
      max: 12,
      step: 0.1,
      group: 'basic',
      visibleIf: (p) => p.splitLong === true,
    },
  ],
  defaults: { splitLong: false, maxLength: 7 },
  appliesTo: (s) => s.hasClosed || s.hasOpen,
  prepare(geom, params) {
    const maxLength = bool(params, 'splitLong', false) ? Math.max(0.5, num(params, 'maxLength', 7)) : 0;
    return { paths: manualPaths(geom.subpaths, maxLength) };
  },
  route(prep) {
    const b = new RunBuilder();
    for (const pts of prep.paths) {
      if (b.length) b.jumpTo(pts[0], pts[1]);
      b.pushPolyline(pts, 0, b.length > 0);
    }
    return b.build();
  },
};
