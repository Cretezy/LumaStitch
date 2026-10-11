// SPDX-License-Identifier: GPL-3.0-or-later
import { createDesign, createElement, createShape } from '@/model/factories';
import { polylineGeom, rectGeom } from '@/geom/shapes';

export function stitchExamples() {
  const design = createDesign({ name: 'Fabric calibration sampler' });
  design.threads.blue = { id: 'blue', name: 'Blue calibration thread', color: '#234a73' };
  design.hoop = { width: 100, height: 100, margin: 2, shape: 'rectangle' };
  for (const [i, density] of [0.3, 0.4, 0.5, 0.6].entries()) {
    const s = createShape(`Tatami ${density} mm spacing`, rectGeom((i % 2) * 27, Math.floor(i / 2) * 27, 20, 20));
    s.id = `tatami-${i}`; s.fill = createElement('fill', 'tatami', 'blue', { density, angle: 45, underlay: 'tatami', pullComp: 0.2 }); s.fill.id = `fill-${i}`;
    design.shapes[s.id] = s; design.zOrder.push(s.id); design.sequence.push({ kind: 'element', elementId: s.fill.id });
  }
  for (const [i, width] of [2, 4, 6].entries()) {
    const s = createShape(`Satin ${width} mm width`, polylineGeom([[57 + i * 10, 0], [57 + i * 10, 47]], false));
    s.id = `satin-${i}`; s.outline = createElement('outline', 'satin', 'blue', { width, density: 0.4, pullComp: 0.2 }); s.outline.id = `outline-${i}`;
    design.shapes[s.id] = s; design.zOrder.push(s.id); design.sequence.push({ kind: 'element', elementId: s.outline.id });
  }
  return [{ name: 'fabric-calibration', design }];
}
