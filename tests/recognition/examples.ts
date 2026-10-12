// SPDX-License-Identifier: GPL-3.0-or-later
import { createDesign, createElement, createShape } from '@/model/factories';
import { compound, polylineGeom, rectGeom } from '@/geom/shapes';
import { buildPlan } from '@/engine/plan';
import { pesFormat } from '@/io/export/pesFormat';
import { prepareMachineImport } from '@/io/machine/import';
import { recognitionCandidates, recognizedShapes } from '@/recognition/recognize';
import type { Design, Vec2 } from '@/model/types';

export function recognitionSource() {
  const d = createDesign({ name: 'Satin and tatami recognition sampler' });
  d.threads.green = { id: 'green', name: 'Forest green', color: '#296450' };
  d.threads.gold = { id: 'gold', name: 'Gold', color: '#c79736' };
  const a: Vec2[] = [], b: Vec2[] = [];
  for (let i = 0; i <= 16; i++) {
    const x = i * 3, y = 6 * Math.sin(i * Math.PI / 16), w = 2 + Math.sin(i * Math.PI / 16);
    a.push([x, y - w]); b.push([x, y + w]);
  }
  const satin = createShape('Curved satin ribbon', compound([polylineGeom(a), polylineGeom(b)]), { stroke: '#296450', strokeWidth: 0.2 });
  satin.outline = createElement('outline', 'satinColumn', 'green', { density: 0.4, underlay: 'center', pullComp: 0, shortStitches: false, splitAbove: 0 });
  satin.outline.guides = a.slice(1, -1).map((p, i) => [p, b[i + 1]]);
  const fill = createShape('Tatami panel', rectGeom(0, 17, 48, 15), { fill: '#c79736' });
  fill.fill = createElement('fill', 'tatami', 'gold', { density: 0.5, stitchLength: 3.5, underlay: 'none', angle: 0, pullComp: 0 });
  // Deliberately retain an unrecognized running flourish and a real operator stop.
  const run = createShape('Running flourish', polylineGeom([[0, 39], [12, 43], [24, 37], [36, 43], [48, 39]]), { stroke: '#c79736' });
  run.outline = createElement('outline', 'running', 'gold', { stitchLength: 2 });
  for (const [i, s] of [satin, fill, run].entries()) {
    s.id = `source-${i}`;
    const el = s.fill ?? s.outline!;
    el.id = `source-element-${i}`;
    el.tieIn = el.tieOut = 'off';
    d.shapes[s.id] = s; d.zOrder.push(s.id);
    if (i === 2) d.sequence.push({ kind: 'stop', id: 'operator-stop' });
    d.sequence.push({ kind: 'element', elementId: el.id });
  }
  return d;
}

export function recognitionExample() {
  const source = recognitionSource();
  const before = prepareMachineImport(pesFormat.write(buildPlan(source), source, { version: 6 }), 'sampler.pes').design;
  before.name = 'Imported satin and tatami sampler';
  const candidates = recognitionCandidates(before, before.zOrder);
  const after = structuredClone(before);
  after.name = 'Recognized editable satin and tatami';
  const results = before.zOrder.flatMap(id => {
    const matches = candidates.filter(c => c.shapeId === id);
    return matches.length ? recognizedShapes(before.shapes[id], matches) : [structuredClone(before.shapes[id])];
  });
  after.shapes = Object.fromEntries(results.map(s => [s.id, s]));
  after.zOrder = results.map(s => s.id);
  after.sequence = results.map(s => ({ kind: 'element', elementId: (s.fill ?? s.outline)!.id }));
  const edited: Design = structuredClone(after);
  edited.name = 'Recognized objects with wider stitch spacing';
  for (const s of Object.values(edited.shapes)) {
    const el = s.fill ?? s.outline!;
    if (el.type !== 'manual') el.params.density = Number(el.params.density) * 1.4;
  }
  return { source, before, after, edited, candidates };
}
export function stitchExamples() {
  const examples = recognitionExample();
  return (['before', 'after', 'edited'] as const).map(name => ({ name, design: examples[name], optimize: false }));
}
