// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { prepareMachineImport } from '@/io/machine/import';
import { pesFormat } from '@/io/export/pesFormat';
import { detectStitches } from './detect';
import { recognitionCandidates, recognizedShapes } from './recognize';
import { recognitionExample } from '../../tests/recognition/examples';
import { buildPlan } from '@/engine/plan';
import { F } from '@/engine/types';
import { parseProjectFile, serializeProject } from '@/model/schema';
import type { Node, Vec2 } from '@/model/types';

const nodes = (p: Vec2[]): Node[] => p.map((p) => ({ p }));
const zig = (count = 100) => nodes(Array.from({ length: count }, (_, i) => [i * 0.2, i % 2 ? 3 : -3]));
const fill = (angle: number, reverse = false): Node[] => {
  const a = (angle * Math.PI) / 180;
  const p: Vec2[] = [];
  for (let row = 0; row < 25; row++) {
    const y = row * 0.4;
    for (let j = 0; j <= 12; j++) {
      const x = (row % 2 ? 12 - j : j) * 2;
      p.push([
        Math.round((x * Math.cos(a) - y * Math.sin(a)) * 10) / 10,
        Math.round((x * Math.sin(a) + y * Math.cos(a)) * 10) / 10,
      ]);
    }
  }
  return nodes(reverse ? p.reverse() : p);
};

it.each([0, 17, 45, 90, 133, 178])(
  'recognizes quantized tatami rows at %s degrees in either sewing direction',
  (angle) => {
    for (const reverse of [false, true]) {
      const found = detectStitches(fill(angle, reverse));
      expect(found).toHaveLength(1);
      expect(found[0].type).toBe('tatami');
      expect(found[0].params.density).toBeCloseTo(0.4, 1);
      expect(found[0].params.stitchLength).toBeCloseTo(2, 1);
      expect(found[0].params.underlay).toBe('none');
    }
  },
);
it('recognizes satin with ties and underlay left as manual nodes', () => {
  const prefix = nodes([
    [-4, 0],
    [-3, 0],
    [-2, 0],
    [0, 0],
    [0, -0.2],
    [0, 0],
  ]);
  const found = detectStitches([...prefix, ...zig(), { p: [20, 0], command: 'stop' }]);
  expect(found).toHaveLength(1);
  expect(found[0].start).toBe(prefix.length);
  expect(found[0].end).toBe(prefix.length + 100);
  expect(found[0].params.density).toBeCloseTo(0.4);
});
it('never bridges jumps, trims or stops and does not recognize short decorative zigzags', () => {
  for (const command of ['jump', 'trim', 'stop'] as const) {
    expect(detectStitches([...zig(12), { p: [2, 0], command }, ...zig(12)])).toEqual([]);
    expect(detectStitches([...zig(30), { p: [2, 0], command }, ...zig(30)])).toHaveLength(2);
  }
});
it('refuses irregular rows, doublebacks and sparse running stitches', () => {
  expect(
    detectStitches(
      nodes([
        [0, 0],
        [4, 0],
        [8, 0],
        [12, 0],
        [12, 4],
        [8, 4],
        [4, 4],
        [0, 4],
      ]),
    ),
  ).toEqual([]);
  const irregular = fill(0);
  for (let i = 100; i < irregular.length; i++) irregular[i].p[1] += 4;
  expect(detectStitches(irregular)).toEqual([]);
  const doubled = zig();
  doubled.splice(50, 50, ...zig(50).reverse());
  expect(detectStitches(doubled).every((c) => c.end - c.start < 100)).toBe(true);
});
it('retains source commands, residual needles and thread IDs while regenerating editable objects', () => {
  const { before, after, edited, candidates } = recognitionExample();
  expect(candidates.map((c) => c.type).sort()).toEqual(['satinColumn', 'tatami']);
  for (const id of before.zOrder) {
    const source = before.shapes[id],
      matches = candidates.filter((c) => c.shapeId === id);
    if (!matches.length) continue;
    const results = recognizedShapes(source, matches),
      original = source.geom.subpaths.flatMap((s) => s.nodes);
    const retained = original.filter((_, i) => !matches.some((c) => i >= c.start && i < c.end));
    expect(
      results
        .filter((s) => s.outline?.type === 'manual')
        .flatMap((s) => s.geom.subpaths.flatMap((p) => p.nodes)),
    ).toEqual(retained);
    expect(results.every((s) => (s.fill ?? s.outline)!.threadId === source.outline!.threadId)).toBe(true);
  }
  const a = buildPlan(after),
    e = buildPlan(edited),
    b = buildPlan(before);
  expect(a.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  expect(e.stats.stitches).toBeLessThan(a.stats.stitches);
  expect([...a.flags].filter((f) => f & F.COLOR_CHANGE)).toHaveLength(
    [...b.flags].filter((f) => f & F.COLOR_CHANGE).length,
  );
  expect([...a.flags].filter((f) => f & F.STOP)).toHaveLength(1);
  expect(parseProjectFile(serializeProject(after))).toEqual(JSON.parse(JSON.stringify(after)));
});
it('validates selection and bounds before recognizing', () => {
  const { before } = recognitionExample();
  expect(() => recognitionCandidates(before, [])).toThrow(/Select/);
  const s = before.shapes[before.zOrder[0]];
  s.locked = true;
  expect(() => recognitionCandidates(before, before.zOrder)).toThrow(/unlocked/);
  s.locked = false;
  s.geom.subpaths[0].nodes = Array.from({ length: 50001 }, () => ({ p: [0, 0] as Vec2 }));
  expect(() => recognitionCandidates(before, before.zOrder)).toThrow(/50,000/);
});

it.each(readdirSync('tests/fixtures/recognition'))(
  'recognizes independently encoded pyembroidery pattern %s',
  (file) => {
    const { design } = prepareMachineImport(
      new Uint8Array(readFileSync(`tests/fixtures/recognition/${file}`)),
      file,
    );
    const found = recognitionCandidates(design, design.zOrder);
    expect(found.map((c) => c.type)).toEqual(['satinColumn', 'tatami']);
    expect(Number(found[0].params.density)).toBeCloseTo(0.4, 1);
    expect(Number(found[1].params.density)).toBeCloseTo(0.5, 1);
  },
);

it.each(['before', 'after', 'edited'])(
  'reproduces the committed %s PES from its editable project',
  (name) => {
    const dir = `docs/recognition/${name}/${name}`;
    const design = parseProjectFile(readFileSync(`${dir}.lumastitch`, 'utf8'));
    const plan = buildPlan(design);
    expect(plan.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(pesFormat.write(plan, design, { version: 6 })).toEqual(new Uint8Array(readFileSync(`${dir}.pes`)));
  },
);
