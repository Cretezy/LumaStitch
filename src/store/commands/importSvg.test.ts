// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { polylineGeom, rectGeom } from '@/geom/shapes';
import { createDesign, createElement, createShape, createThread } from '@/model/factories';
import { checkInvariants } from '@/model/invariants';
import type { Artwork, Design, Shape, Thread } from '@/model/types';
import type { ThreadChart } from '@/threads/charts';
import { applySvgImport, baseFileName, isUntitledName, type SvgImportPayload } from './importSvg';

const artwork: Artwork & { kind: 'svg' } = {
  kind: 'svg',
  svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"/>',
  matrix: [1, 0, 0, 1, 0, 0],
  visible: true,
  opacity: 0.35,
};

/** A payload like importSvg's: red square (fill + black stroke), red circle-ish fill, black line. */
function payload(): SvgImportPayload {
  const red = createThread('#ff0000', '#ff0000');
  const black = createThread('#000000', '#000000');
  const a = createShape('a', rectGeom(0, 0, 10, 10), {
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0.5,
  });
  a.fill = createElement('fill', 'tatami', red.id);
  a.outline = createElement('outline', 'running', black.id);
  const b = createShape('b', rectGeom(20, 0, 5, 5), { fill: '#ff0000' });
  b.fill = createElement('fill', 'tatami', red.id);
  const c = createShape(
    'c',
    polylineGeom([
      [0, 20],
      [10, 20],
    ]),
    { stroke: '#000000', strokeWidth: 1 },
  );
  c.outline = createElement('outline', 'running', black.id);
  return { shapes: [a, b, c], threads: [red, black], artwork, name: 'logo.svg' };
}

const elementIds = (s: Shape) => [s.fill?.id, s.outline?.id].filter(Boolean);

describe('applySvgImport', () => {
  it('adds shapes in paint order with fill-then-outline sequence and keeps invariants', () => {
    const d = createDesign();
    const p = payload();
    const ids = applySvgImport(d, p);
    expect(ids).toEqual(p.shapes.map((s) => s.id));
    expect(d.zOrder).toEqual(ids);
    const seq = d.sequence.map((e) => (e.kind === 'element' ? e.elementId : 'stop'));
    expect(seq).toEqual(ids.flatMap((id) => elementIds(d.shapes[id])));
    expect(seq[0]).toBe(d.shapes[ids[0]].fill!.id);
    expect(seq[1]).toBe(d.shapes[ids[0]].outline!.id);
    expect(Object.keys(d.threads)).toHaveLength(2);
    expect(checkInvariants(d)).toEqual([]);
  });

  it('sets the artwork when missing and renames an Untitled design', () => {
    const d = createDesign();
    applySvgImport(d, payload());
    expect(d.artwork?.kind).toBe('svg');
    expect(d.name).toBe('logo');
  });

  it('adds to a non-empty design, reusing threads of the same colour and keeping the artwork', () => {
    const d: Design = createDesign({ name: 'My patch' });
    const existing: Thread = createThread('#FF0000', 'Red');
    d.threads[existing.id] = existing;
    const s = createShape('old', rectGeom(-5, -5, 2, 2), { fill: '#ff0000' });
    s.fill = createElement('fill', 'tatami', existing.id);
    d.shapes[s.id] = s;
    d.zOrder.push(s.id);
    d.sequence.push({ kind: 'element', elementId: s.fill.id }, { kind: 'stop', id: 'stop1' });
    const oldArt = { ...artwork, svg: '<svg/>' };
    d.artwork = oldArt;

    const ids = applySvgImport(d, payload());
    expect(d.zOrder).toEqual([s.id, ...ids]);
    expect(d.sequence[1]).toEqual({ kind: 'stop', id: 'stop1' });
    // Red reused, black added.
    expect(Object.keys(d.threads)).toHaveLength(2);
    expect(d.shapes[ids[0]].fill!.threadId).toBe(existing.id);
    expect(d.shapes[ids[1]].fill!.threadId).toBe(existing.id);
    expect(d.artwork).toBe(oldArt);
    expect(d.name).toBe('My patch');
    expect(checkInvariants(d)).toEqual([]);
  });

  it('replaces the artwork when asked', () => {
    const d = createDesign();
    d.artwork = { ...artwork, svg: '<svg/>' };
    applySvgImport(d, payload(), { replaceArtwork: true });
    expect(d.artwork).toEqual(artwork);
  });

  it('importing the same payload twice does not collide ids or duplicate threads', () => {
    const d = createDesign();
    const p = payload();
    const a = applySvgImport(d, p);
    const b = applySvgImport(d, p);
    expect(new Set([...a, ...b]).size).toBe(6);
    expect(Object.keys(d.threads)).toHaveLength(2);
    expect(checkInvariants(d)).toEqual([]);
  });

  it('maps colours to the nearest chart thread and dedupes chart threads', () => {
    const chart: ThreadChart = {
      id: 'test',
      name: 'Test',
      brand: 'Test',
      threads: [
        { code: '100', name: 'Poppy', color: '#ee1111' },
        { code: '200', name: 'Coal', color: '#111111' },
      ],
    };
    const d = createDesign();
    const p = payload();
    // A second, slightly different red maps to the same chart thread.
    const red2 = createThread('#f00a0a', '#f00a0a');
    p.threads.push(red2);
    p.shapes[1].fill!.threadId = red2.id;
    const ids = applySvgImport(d, p, { chart });
    const threads = Object.values(d.threads);
    expect(threads).toHaveLength(2);
    const poppy = threads.find((t) => t.code === '100')!;
    expect(poppy).toMatchObject({ name: 'Poppy', color: '#ee1111', chart: 'test' });
    expect(d.shapes[ids[0]].fill!.threadId).toBe(poppy.id);
    expect(d.shapes[ids[1]].fill!.threadId).toBe(poppy.id);
    // Original paint is kept for the artwork view.
    expect(d.shapes[ids[0]].art.fill).toBe('#ff0000');
    expect(checkInvariants(d)).toEqual([]);
  });
});

describe('names', () => {
  it('baseFileName / isUntitledName', () => {
    expect(baseFileName('logo final.svg')).toBe('logo final');
    expect(baseFileName('a.b.png')).toBe('a.b');
    expect(isUntitledName('Untitled')).toBe(true);
    expect(isUntitledName('Patch')).toBe(false);
  });
});
