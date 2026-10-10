import { describe, expect, it } from 'vitest';
import { createDesign, createElement, createShape, createThread } from './factories';
import { checkInvariants, repairDesign } from './invariants';
import { parseProjectFile, serializeProject } from './schema';
import { DEFAULT_FABRIC_COLOR, fabricColorOf } from './types';
import { ellipseGeom, polylineGeom } from '@/geom/shapes';
import type { Design } from './types';

function sample(): Design {
  const d = createDesign({ name: 'Sample' });
  const t = createThread('#ff0000');
  d.threads[t.id] = t;
  const a = createShape('A', ellipseGeom(0, 0, 10), { fill: '#ff0000' });
  a.fill = createElement('fill', 'tatami', t.id, { angle: 30, density: 0.35 });
  a.fill.entry = [1, 2];
  const b = createShape(
    'B',
    polylineGeom([
      [0, 0],
      [10, 0],
    ]),
    { stroke: '#ff0000', strokeWidth: 2 },
  );
  b.outline = createElement('outline', 'satin', t.id, { width: 2 });
  for (const s of [a, b]) {
    d.shapes[s.id] = s;
    d.zOrder.push(s.id);
  }
  d.sequence = [
    { kind: 'element', elementId: a.fill.id },
    { kind: 'stop', id: 'st1', note: 'appliqué' },
    { kind: 'element', elementId: b.outline.id },
  ];
  d.artwork = { kind: 'svg', svg: '<svg/>', matrix: [1, 0, 0, 1, 0, 0], visible: true, opacity: 0.35 };
  return d;
}

const canon = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(canon)
    : v && typeof v === 'object'
      ? Object.fromEntries(
          Object.keys(v as object)
            .sort()
            .map((k) => [k, canon((v as any)[k])]),
        )
      : v;

describe('project files', () => {
  it('a saved project reopens identically', () => {
    const d = sample();
    expect(checkInvariants(d)).toEqual([]);
    const back = parseProjectFile(serializeProject(d));
    expect(canon(back)).toEqual(canon(d));
  });
  it('keeps the fabric colour, which older files leave out', () => {
    const d = sample();
    expect(fabricColorOf(parseProjectFile(serializeProject(d)))).toBe(DEFAULT_FABRIC_COLOR);
    d.fabricColor = '#1f2a44';
    expect(parseProjectFile(serializeProject(d)).fabricColor).toBe('#1f2a44');
  });
  it('rejects foreign files and newer schema versions', () => {
    expect(() => parseProjectFile('{"hello":1}')).toThrow();
    expect(() => parseProjectFile('not json')).toThrow();
    const d = sample() as any;
    d.schemaVersion = 99;
    expect(() =>
      parseProjectFile(JSON.stringify({ format: 'lumastitch-project', schemaVersion: 99, design: d })),
    ).toThrow(/newer/);
  });
  it('repairs dangling references', () => {
    const d = sample();
    d.sequence.push({ kind: 'element', elementId: 'missing' });
    d.zOrder.pop();
    expect(checkInvariants(d).length).toBeGreaterThan(0);
    expect(checkInvariants(repairDesign(d))).toEqual([]);
  });
});
