import { describe, expect, it } from 'vitest';
import { ellipseGeom, polylineGeom, rectGeom } from '@/geom/shapes';
import { analyzeShapes, classifyStroke } from './classify';
import { optimizeSequence } from '../sequence/optimize';
import { createDesign, createElement, createShape, createThread } from '@/model/factories';

describe('classify', () => {
  it('strokes by width', () => {
    expect(classifyStroke(0.3)!.type).toBe('running');
    expect(classifyStroke(0.8)!.type).toBe('triple');
    expect(classifyStroke(3)!.type).toBe('satin');
    expect(classifyStroke(3)!.params.width).toBe(3);
    expect(classifyStroke(9)).toBeNull();
  });
  it('fills by width', () => {
    const r = analyzeShapes([
      { id: 'bar', geom: rectGeom(0, 0, 30, 4), hasFill: true, hasStroke: false },
      { id: 'big', geom: ellipseGeom(50, 0, 20, 15), hasFill: true, hasStroke: false },
      { id: 'thin', geom: rectGeom(0, 20, 10, 0.5), hasFill: true, hasStroke: false },
      { id: 'dot', geom: rectGeom(0, 30, 0.5, 0.5), hasFill: true, hasStroke: false },
      {
        id: 'line',
        geom: polylineGeom([
          [0, 40],
          [10, 40],
        ]),
        hasFill: false,
        hasStroke: true,
        strokeWidth: 2,
      },
    ]);
    const by = Object.fromEntries(r.decisions.map((d) => [d.id, d]));
    expect(by.bar.fill!.type).toBe('satinFill');
    expect(by.big.fill!.type).toBe('tatami');
    expect(by.thin.fill).toBeNull();
    expect(by.thin.outline).toBeNull();
    expect(by.thin.centerline).toBeTruthy();
    expect(by.dot.droppedFill).toBe(true);
    expect(by.line.outline!.type).toBe('satin');
  });
  it('tatami angle follows the long axis, snapped to 15°', () => {
    const r = analyzeShapes([{ id: 'a', geom: rectGeom(0, 0, 40, 20), hasFill: true, hasStroke: false }]);
    expect(r.decisions[0].fill!.params.angle).toBe(0);
  });
  it('neighbouring fills with similar angles are rotated apart', () => {
    const r = analyzeShapes([
      { id: 'a', geom: rectGeom(0, 0, 40, 20), hasFill: true, hasStroke: false },
      { id: 'b', geom: rectGeom(40, 0, 40, 20), hasFill: true, hasStroke: false },
    ]);
    expect(r.decisions[0].fill!.params.angle).toBe(0);
    expect(r.decisions[1].fill!.params.angle).toBe(45);
  });
});

describe('optimizeSequence', () => {
  it('groups colours while respecting stacking', () => {
    const d = createDesign();
    const red = createThread('#ff0000'),
      blue = createThread('#0000ff');
    d.threads[red.id] = red;
    d.threads[blue.id] = blue;
    const add = (geom: any, t: string) => {
      const s = createShape('s', geom);
      s.fill = createElement('fill', 'tatami', t);
      d.shapes[s.id] = s;
      d.zOrder.push(s.id);
      d.sequence.push({ kind: 'element', elementId: s.fill.id });
      return s;
    };
    // A red, B blue (overlaps A, above), C red (separate). Paint order A,B,C → R,B,R = 2 changes.
    const a = add(rectGeom(0, 0, 10, 10), red.id);
    const b = add(rectGeom(5, 5, 10, 10), blue.id);
    const c = add(rectGeom(50, 0, 10, 10), red.id);
    const seq = optimizeSequence(d);
    const ids = seq.map((e) => (e.kind === 'element' ? e.elementId : 'stop'));
    expect(ids).toEqual([a.fill!.id, c.fill!.id, b.fill!.id]);
  });
});

describe('optimizeSequence (partial)', () => {
  it('re-placing a bottom fill keeps it under the shapes above it', () => {
    const d = createDesign();
    const t = createThread('#ff0000');
    d.threads[t.id] = t;
    const mk = (geom: any) => {
      const s = createShape('s', geom);
      s.fill = createElement('fill', 'tatami', t.id);
      d.shapes[s.id] = s;
      d.zOrder.push(s.id);
      return s;
    };
    const bottom = mk(rectGeom(0, 0, 40, 40));
    const top = mk(rectGeom(10, 10, 10, 10));
    // Current (wrong) order: top first, bottom appended (as after a partial auto-digitize).
    d.sequence = [
      { kind: 'element', elementId: top.fill!.id },
      { kind: 'element', elementId: bottom.fill!.id },
    ];
    const seq = optimizeSequence(d, { elementIds: [bottom.fill!.id] });
    expect(seq.map((e) => (e.kind === 'element' ? e.elementId : ''))).toEqual([
      bottom.fill!.id,
      top.fill!.id,
    ]);
  });
});

describe('optimizeSequence (2-opt)', () => {
  it('removes crossing travel within a colour block without breaking stacking', () => {
    const d = createDesign();
    const t = createThread('#123456');
    d.threads[t.id] = t;
    const add = (x: number, y: number) => {
      const s = createShape('s', rectGeom(x, y, 4, 4));
      s.fill = createElement('fill', 'tatami', t.id);
      d.shapes[s.id] = s;
      d.zOrder.push(s.id);
      d.sequence.push({ kind: 'element', elementId: s.fill.id });
      return s.fill.id;
    };
    // Points on a ring; any optimised tour should be no longer than the greedy one.
    const ids = [0, 1, 2, 3, 4, 5, 6, 7].map((k) =>
      add(30 * Math.cos((k * Math.PI) / 4) + (k % 2) * 7, 30 * Math.sin((k * Math.PI) / 4)),
    );
    const seq = optimizeSequence(d);
    const centers = new Map(
      ids.map((id) => {
        const s = Object.values(d.shapes).find((x) => x.fill?.id === id)!;
        const p = s.geom.subpaths[0].nodes[0].p;
        return [id, [p[0] + 2, p[1] + 2]];
      }),
    );
    let len = 0;
    const order = seq.map((e) => (e.kind === 'element' ? e.elementId : ''));
    for (let i = 1; i < order.length; i++) {
      const a = centers.get(order[i - 1])!,
        b = centers.get(order[i])!;
      len += Math.hypot(a[0] - b[0], a[1] - b[1]);
    }
    expect(new Set(order).size).toBe(8);
    expect(len).toBeLessThan(260);
  });
});
