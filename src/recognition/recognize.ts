// SPDX-License-Identifier: GPL-3.0-or-later
import { createElement, createShape } from '@/model/factories';
import { newId } from '@/lib/ids';
import type { Design, Node, Shape } from '@/model/types';
import { detectStitches, type Detection } from './detect';

export interface Candidate extends Detection {
  key: string;
  shapeId: string;
  sourceName: string;
}

function sourceNodes(shape: Shape): Node[] {
  if (
    shape.locked ||
    shape.hidden ||
    shape.fill ||
    shape.outline?.type !== 'manual' ||
    shape.outline.params.preserveCommands !== true
  )
    throw new Error('Select unlocked, visible imported stitch blocks.');
  if (shape.geom.subpaths.some((s) => s.closed || s.nodes.some((n) => n.in || n.out)))
    throw new Error('Recognition needs open needle paths without curve handles.');
  return shape.geom.subpaths.flatMap((s) => s.nodes);
}

export function recognitionCandidates(design: Design, shapeIds: string[]): Candidate[] {
  if (!shapeIds.length) throw new Error('Select imported stitch blocks to recognize.');
  if (new Set(shapeIds).size !== shapeIds.length) throw new Error('Duplicate stitch block selection.');
  let count = 0;
  const sources = shapeIds.map((id) => {
    const shape = design.shapes[id];
    if (!shape) throw new Error('The selected stitch block is no longer present.');
    const nodes = sourceNodes(shape);
    count += nodes.length;
    if (count > 50000)
      throw new Error('Recognize at most 50,000 commands at once. Select fewer stitch blocks.');
    if (nodes.some((n) => n.p.some((v) => !Number.isFinite(v) || Math.abs(v) > 100000)))
      throw new Error('Stitch coordinates are outside the recognition range.');
    return { shape, nodes };
  });
  const candidates: Candidate[] = [];
  for (const { shape, nodes } of sources) {
    // Even separate subpaths retain the explicit imported command stream semantics.
    for (const c of detectStitches(nodes)) {
      candidates.push({
        ...c,
        key: `${shape.id}:${c.start}:${c.end}`,
        shapeId: shape.id,
        sourceName: shape.name,
      });
      if (candidates.length > 100) throw new Error('More than 100 candidates. Select fewer stitch blocks.');
    }
  }
  return candidates;
}

/** Leave every non-converted source node, including controls and duplicate needles, in order. */
export function recognizedShapes(source: Shape, candidates: Candidate[]): Shape[] {
  const nodes = sourceNodes(source);
  const out: Shape[] = [];
  let cursor = 0;
  const manual = (end: number) => {
    if (end <= cursor) return;
    const s = structuredClone(source);
    s.id = newId('s');
    s.name = `${source.name} — manual ${out.length + 1}`;
    s.geom = {
      fillRule: 'nonzero',
      subpaths: [{ closed: false, nodes: structuredClone(nodes.slice(cursor, end)) }],
    };
    s.outline!.id = newId('e');
    s.outline!.tieIn = s.outline!.tieOut = 'off';
    // Let ordinary engine boundaries insert a trim when the next inferred start moves away.
    s.outline!.trimAfter = 'auto';
    out.push(s);
  };
  for (const c of [...candidates].sort((a, b) => a.start - b.start)) {
    if (
      c.shapeId !== source.id ||
      c.start < cursor ||
      c.end <= c.start ||
      c.end > nodes.length ||
      nodes.slice(c.start, c.end).some((n) => n.command)
    )
      throw new Error('Recognition candidates no longer match the selected stitch block.');
    manual(c.start);
    const type = c.type === 'tatami' ? 'Tatami' : 'Satin rails';
    const color = source.art.stroke ?? source.art.fill ?? '#000000';
    const s = createShape(
      `${source.name} — ${type} ${out.length + 1}`,
      structuredClone(c.geom),
      c.type === 'tatami' ? { fill: color } : { stroke: color, strokeWidth: 0.2 },
    );
    const role = c.type === 'tatami' ? 'fill' : 'outline';
    const el = createElement(role, c.type, source.outline!.threadId, { ...c.params });
    el.tieIn = el.tieOut = 'off';
    el.userEdited = true;
    el.entry = [...nodes[c.start].p];
    if (c.guides) el.guides = structuredClone(c.guides);
    s[role] = el;
    out.push(s);
    cursor = c.end;
  }
  manual(nodes.length);
  return out;
}
