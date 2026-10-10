// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { compound, ellipseGeom, polylineGeom, rectGeom } from '@/geom/shapes';
import { createDesign, createElement, createShape, createThread } from '@/model/factories';
import type { Design, PathGeom, Shape } from '@/model/types';
import { escapeXml, exportSvg } from './svg';

function addShape(d: Design, name: string, geom: PathGeom, init: (s: Shape) => void = () => {}): Shape {
  const s = createShape(name, geom);
  init(s);
  d.shapes[s.id] = s;
  d.zOrder.push(s.id);
  return s;
}

function paths(svg: string): string[] {
  return svg.match(/<path [^>]*\/>/g) ?? [];
}

function attr(el: string, name: string): string | undefined {
  return new RegExp(`\\s${name}="([^"]*)"`).exec(el)?.[1];
}

describe('exportSvg', () => {
  it('writes one path per visible shape in z-order with mm sizing', () => {
    const d = createDesign({ name: 'Logo' });
    const red = createThread('#ff0000', 'Red');
    const blk = createThread('#111111', 'Black');
    d.threads[red.id] = red;
    d.threads[blk.id] = blk;
    addShape(d, 'Back', rectGeom(0, 0, 40, 20), (s) => {
      s.fill = createElement('fill', 'tatami', red.id);
      s.outline = createElement('outline', 'satin', blk.id, { width: 2 });
    });
    addShape(d, 'Hidden', rectGeom(100, 100, 5, 5), (s) => {
      s.hidden = true;
      s.fill = createElement('fill', 'tatami', red.id);
    });
    addShape(
      d,
      'Line',
      polylineGeom([
        [0, 30],
        [40, 30],
      ]),
      (s) => {
        s.outline = createElement('outline', 'running', blk.id);
      },
    );
    addShape(d, 'Donut', compound([ellipseGeom(20, 10, 6), ellipseGeom(20, 10, 3)], 'evenodd'), (s) => {
      s.fill = createElement('fill', 'tatami', blk.id);
    });

    const svg = exportSvg(d, { margin: 2 });
    expect(
      svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg"'),
    ).toBe(true);
    expect(svg).toContain('<title>Logo</title>');
    // Bounds: x −1..41 (satin width 2 → 1 mm each side), y −1..30.2 (running stroke 0.4), + 2 mm margin.
    const root = /<svg [^>]*>/.exec(svg)![0];
    expect(attr(root, 'width')).toBe('46mm');
    expect(attr(root, 'height')).toBe('35.2mm');
    expect(attr(root, 'viewBox')).toBe('-3 -3 46 35.2');

    const ps = paths(svg);
    expect(ps.map((p) => attr(p, 'data-name'))).toEqual(['Back', 'Line', 'Donut']);
    const [back, line, donut] = ps;
    expect(attr(back, 'fill')).toBe('#ff0000');
    expect(attr(back, 'stroke')).toBe('#111111');
    expect(attr(back, 'stroke-width')).toBe('2');
    expect(attr(back, 'd')).toMatch(/^M0 0/);
    expect(attr(line, 'fill')).toBe('none');
    expect(attr(line, 'stroke-width')).toBe('0.4');
    expect(attr(donut, 'fill-rule')).toBe('evenodd');
    expect(attr(donut, 'stroke')).toBe('none');
    expect(attr(donut, 'd')!.match(/M/g)).toHaveLength(2);
  });

  it('escapes names and keeps ids valid and unique', () => {
    const d = createDesign({ name: 'A <b> & "c"' });
    const t = createThread('#00ff00');
    d.threads[t.id] = t;
    for (const name of ['<script>&"x"', '<script>&"x"', '1 été\u0001']) {
      addShape(d, name, rectGeom(0, 0, 1, 1), (s) => {
        s.fill = createElement('fill', 'tatami', t.id);
      });
    }
    const svg = exportSvg(d);
    expect(svg).toContain('<title>A &lt;b&gt; &amp; &quot;c&quot;</title>');
    expect(svg).not.toContain('<script');
    expect(svg).not.toContain('\u0001');
    const ps = paths(svg);
    expect(ps.map((p) => attr(p, 'data-name'))).toEqual([
      '&lt;script&gt;&amp;&quot;x&quot;',
      '&lt;script&gt;&amp;&quot;x&quot;',
      '1 été',
    ]);
    const ids = ps.map((p) => attr(p, 'id')!);
    expect(new Set(ids).size).toBe(3);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z_][A-Za-z0-9_.-]*$/);
    expect(ids[2]).toBe('_1_ete');
  });

  it('falls back to artwork paint for unstitched shapes and handles an empty design', () => {
    const d = createDesign();
    addShape(d, 'Art', rectGeom(0, 0, 10, 10), (s) => {
      s.art = { fill: '#abcdef', stroke: '#123456', strokeWidth: 1.5 };
    });
    const p = paths(exportSvg(d))[0];
    expect(attr(p, 'fill')).toBe('#abcdef');
    expect(attr(p, 'stroke')).toBe('#123456');
    expect(attr(p, 'stroke-width')).toBe('1.5');

    const empty = exportSvg(createDesign());
    expect(paths(empty)).toHaveLength(0);
    expect(empty).toContain('viewBox="-2 -2 4 4"');
  });

  it('escapeXml covers all special characters', () => {
    expect(escapeXml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&apos;&amp;&apos;&lt;/a&gt;');
  });
});
