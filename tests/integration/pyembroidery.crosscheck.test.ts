/**
 * Writes app-generated PES files plus expected stats for tests/tools/crosscheck_app.py.
 * Run: PES_APP_CROSSCHECK_DIR=/tmp/x npx vitest run tests/integration/pyembroidery && python tests/tools/crosscheck_app.py /tmp/x
 */
import { it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createDesign, createElement, createShape, createThread } from '@/model/factories';
import { compound, ellipseGeom, polylineGeom, rectGeom } from '@/geom/shapes';
import { buildPlan } from '@/engine/plan';
import { writePes } from '@/io/pes';
import type { Design, PathGeom, StitchType } from '@/model/types';

const dir = process.env.PES_APP_CROSSCHECK_DIR;

function design(): Design {
  const d = createDesign({ name: 'Logo3' });
  const items: {
    geom: PathGeom;
    fill?: StitchType;
    outline?: StitchType;
    color: string;
    params?: any;
    sw?: number;
  }[] = [
    {
      geom: compound([ellipseGeom(0, 0, 30, 24), ellipseGeom(0, 0, 10, 8)]),
      fill: 'tatami',
      color: '#c1121f',
    },
    { geom: rectGeom(-25, -3, 50, 6), fill: 'satinFill', color: '#003049' },
    { geom: ellipseGeom(0, 0, 30, 24), outline: 'satin', color: '#003049', sw: 2.5 },
    {
      geom: polylineGeom([
        [-30, 32],
        [30, 32],
      ]),
      outline: 'triple',
      color: '#fdf0d5',
    },
  ];
  for (const it of items) {
    let t = Object.values(d.threads).find((x) => x.color === it.color);
    if (!t) {
      t = createThread(it.color);
      d.threads[t.id] = t;
    }
    const s = createShape('s', it.geom, { strokeWidth: it.sw });
    if (it.fill) s.fill = createElement('fill', it.fill, t.id, it.params ?? {});
    if (it.outline) s.outline = createElement('outline', it.outline, t.id, it.params ?? {});
    d.shapes[s.id] = s;
    d.zOrder.push(s.id);
    for (const el of [s.fill, s.outline]) if (el) d.sequence.push({ kind: 'element', elementId: el.id });
  }
  return d;
}

it.skipIf(!dir)('writes app PES files for the pyembroidery cross-check', () => {
  mkdirSync(dir!, { recursive: true });
  const d = design();
  const plan = buildPlan(d);
  const expected = {
    stitches: plan.stats.stitches,
    colorBlocks: plan.colorBlocks.length,
    widthMm: plan.bounds.maxX - plan.bounds.minX,
    heightMm: plan.bounds.maxY - plan.bounds.minY,
  };
  for (const v of [1, 6] as const)
    writeFileSync(join(dir!, `app.v${v}.pes`), writePes(plan, d, { version: v }));
  writeFileSync(join(dir!, 'expected.json'), JSON.stringify(expected));
});
