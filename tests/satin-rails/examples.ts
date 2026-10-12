// SPDX-License-Identifier: GPL-3.0-or-later
import { createDesign, createElement, createShape } from '@/model/factories';
import { compound, polylineGeom } from '@/geom/shapes';
import { groupSatinColumns } from '@/satin/group';
import type { Vec2 } from '@/model/types';
export function railExample(grouped = true) {
  const d = createDesign({
    name: grouped ? 'Connected variable-width satin vine' : 'Separate variable-width satin columns',
  });
  d.threads.green = { id: 'green', name: 'Vine green', color: '#42754f' };
  const make = (name: string, centers: Vec2[], widths: number[]) => {
    const a: Vec2[] = [],
      b: Vec2[] = [];
    centers.forEach((p, i) => {
      const prev = centers[Math.max(0, i - 1)],
        next = centers[Math.min(centers.length - 1, i + 1)],
        angle = Math.atan2(next[1] - prev[1], next[0] - prev[0]),
        nx = (-Math.sin(angle) * widths[i]) / 2,
        ny = (Math.cos(angle) * widths[i]) / 2;
      a.push([p[0] + nx, p[1] + ny]);
      b.push([p[0] - nx, p[1] - ny]);
    });
    const s = createShape(name, compound([polylineGeom(a), polylineGeom(b)]), {
      stroke: '#42754f',
      strokeWidth: 0.15,
    });
    s.id = name;
    s.outline = createElement('outline', 'satinColumn', 'green', {
      density: 0.42,
      pullComp: 0.15,
      underlay: 'centerEdge',
    });
    s.outline.id = `${name}-outline`;
    s.outline.guides = a.slice(1, -1).map((p, i) => [p, b[i + 1]]);
    d.shapes[s.id] = s;
    d.zOrder.push(s.id);
    d.sequence.push({ kind: 'element', elementId: s.outline.id });
  };
  make(
    'stem',
    [
      [0, 0],
      [0, 15],
      [0, 30],
      [0, 45],
    ],
    [4, 3.4, 2.6, 1.5],
  );
  for (const y of [12, 24, 36])
    for (const sign of [-1, 1]) {
      const centers: Vec2[] = Array.from({ length: 9 }, (_, i) => {
        const t = i / 8;
        return [sign * 24 * t, y - 10 * t + 3 * Math.sin(t * Math.PI)];
      });
      const widths = centers.map((_, i) => 0.9 + 4.2 * Math.sin((i / 8) * Math.PI));
      make(`leaf-${y}-${sign}`, centers, widths);
    }
  if (grouped) {
    const s = groupSatinColumns(d, d.zOrder);
    s.id = 'vine';
    s.outline!.id = 'vine-outline';
    d.shapes = { [s.id]: s };
    d.zOrder = [s.id];
    d.sequence = [{ kind: 'element', elementId: s.outline!.id }];
  }
  return d;
}
export function stitchExamples() {
  return [false, true].map((grouped) => ({
    name: grouped ? 'after' : 'before',
    design: railExample(grouped),
    optimize: false,
  }));
}
