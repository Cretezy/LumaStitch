// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { edgeExample } from '../../tests/applique-edges/examples';
import { edgeTopology, selectCoverEdges } from './edges';
import { appliqueDef, appliqueBorderDef } from '@/engine/stitches/applique';
import { buildPlan, createPlanCache } from '@/engine/plan';
import { DEFAULT_SETTINGS } from '@/model/factories';
import { resolveParams } from '@/engine/params/resolve';
import { F } from '@/engine/types';
import { transformGeomM } from '@/model/geomOps';
import { apply, compose, rotateScreen, translate } from '@/geom/matrix';
import { parseProjectFile, serializeProject } from '@/model/schema';
import { readPes, writePes } from '@/io/pes';
import { polylineGeom } from '@/geom/shapes';
import { MC } from '@/io/pes/machineCommands';
const ctx = { settings: DEFAULT_SETTINGS, tolerance: 0.05, diag() {} };
function prepared(selective = true, open = false) {
  const d = edgeExample(selective, open),
    s = d.shapes.pocket,
    el = (s.fill ?? s.outline)!;
  const def = open ? appliqueBorderDef : appliqueDef;
  return { d, s, el, def, prep: def.prepare(s.geom, resolveParams(el, d.fabric), el, ctx) };
}
it('omits the selected top edge while preserving the hole and both preparatory phases', () => {
  const a = prepared(false),
    b = prepared(),
    full = a.def.route(a.prep, {}, ctx),
    selected = b.def.route(b.prep, {}, ctx);
  const stopIndex = (flags: Uint8Array) => [...flags].flatMap((f, i) => (f & F.STOP ? [i] : []))[1];
  const stop = stopIndex(full.flags);
  expect(selected.xy.slice(0, stop * 2)).toEqual(full.xy.slice(0, stop * 2));
  expect(selected.flags.slice(0, stop)).toEqual(full.flags.slice(0, stop));
  expect(selected.flags.length).toBeLessThan(full.flags.length - 150);
  expect(b.prep.covers).toHaveLength(2);
  expect(b.prep.covers!.filter((p) => p.closed)).toHaveLength(1);
  for (const p of b.prep.covers!)
    if (!p.closed) for (let i = 0; i < p.pts.length; i += 2) expect(p.pts[i + 1]).toBeGreaterThan(1.49);
});
it('edge ownership follows source indices through rotation, reflection and cover-width changes', () => {
  const a = prepared(),
    m = compose(translate(80, 50), rotateScreen(43));
  const geom = transformGeomM(a.s.geom, m),
    el = { ...a.el, params: { ...a.el.params, width: 4 } };
  const p = appliqueDef.prepare(geom, resolveParams(el, a.d.fabric), el, ctx);
  expect(p.covers).toHaveLength(2);
  const endpoint = p.covers!.find((p) => !p.closed)!.pts;
  const q = apply(m, [2, 2]),
    r = apply(m, [48, 2]);
  expect(
    Math.min(
      Math.hypot(endpoint[0] - q[0], endpoint[1] - q[1]),
      Math.hypot(endpoint[0] - r[0], endpoint[1] - r[1]),
    ),
  ).toBeLessThan(0.03);
  const mirrored = appliqueDef.prepare(
    transformGeomM(a.s.geom, [-1, 0, 0, 1, 0, 0]),
    resolveParams(a.el, a.d.fabric),
    a.el,
    ctx,
  );
  expect(mirrored.covers).toHaveLength(2);
});
it('invalidates cached omissions, detects changed topology and preserves project data', () => {
  const { d, s } = prepared(),
    cache = createPlanCache(),
    before = buildPlan(d, { cache });
  const changed = structuredClone(d);
  changed.shapes.pocket.fill!.appliqueEdges!.omit = [
    [0, 0],
    [0, 2],
  ];
  expect(buildPlan(changed, { cache })).toEqual(buildPlan(changed));
  expect(buildPlan(changed).stats.stitches).toBeLessThan(before.stats.stitches);
  expect(parseProjectFile(serializeProject(d))).toEqual(d);
  s.geom.subpaths[0].nodes.push({ p: [-1, 4] });
  expect(buildPlan(d).diagnostics.some((d) => d.message.includes('topology changed'))).toBe(true);
});
it.each(['zigzag', 'running', 'double'])(
  'open borders retain endpoints and phase stops with %s tack-down',
  (tackDown) => {
    const { d, s, el } = prepared(false, true);
    el.params.tackDown = tackDown;
    const prep = appliqueBorderDef.prepare(s.geom, resolveParams(el, d.fabric), el, ctx);
    expect(prep.paths![0].closed).toBe(false);
    const plan = buildPlan(d);
    expect(plan.stats.stops).toBe(2);
    expect(plan.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const pes = readPes(writePes(plan, d, { version: 6 }));
    expect(pes.stopCount).toBe(2);
    expect(pes.stitchCount).toBe(plan.stats.stitches);
    el.params.precut = true;
    expect(buildPlan(d).stats.stops).toBe(1);
  },
);
it('splits a sub-millimetre omitted edge into two open cover runs without erasing neighboring edges', () => {
  const geom = polylineGeom([
    [0, 0],
    [10, 0],
    [10.02, 0],
    [20, 0],
  ]);
  const parts = selectCoverEdges(
    [{ pts: new Float64Array([0, 0, 10, 0, 10.02, 0, 20, 0]), closed: false }],
    geom,
    { topology: edgeTopology(geom), omit: [[0, 1]] },
  );
  expect(parts).toHaveLength(2);
  expect(parts[0].pts.at(-2)).toBeCloseTo(10, 2);
  expect(parts[1].pts[0]).toBeCloseTo(10.02, 2);
  const { d, s, el } = prepared(false, true);
  s.geom = geom;
  el.params.width = 1;
  el.params.pullComp = 0;
  el.appliqueEdges = { topology: edgeTopology(geom), omit: [[0, 1]] };
  const plan = buildPlan(d);
  expect(plan.stats.trims).toBe(3); // Two phase stops and the tiny deliberate cover break.
});

it('omitting every edge retains placement, tack-down and the trim-in-place stop', () => {
  const { d, s, el } = prepared();
  el.appliqueEdges = {
    topology: edgeTopology(s.geom),
    omit: s.geom.subpaths.flatMap((p, i) => p.nodes.map((_, j) => [i, j] as [number, number])),
  };
  const prep = appliqueDef.prepare(s.geom, resolveParams(el, d.fabric), el, ctx);
  expect(prep.covers).toEqual([]);
  expect(buildPlan(d).stats.stops).toBe(2);
  el.params.precut = true;
  expect(buildPlan(d).stats.stops).toBe(1);
});

it.each(['before', 'after', 'open-border'])(
  '%s reproduces its machine file, stops and every rendered needle',
  (name) => {
    const base = `docs/applique-edges/${name}/${name}`,
      d = parseProjectFile(readFileSync(`${base}.lumastitch`, 'utf8'));
    const p = buildPlan(d),
      bytes = writePes(p, d, { version: 6 }),
      decoded = readPes(bytes);
    expect(bytes).toEqual(new Uint8Array(readFileSync(`${base}.pes`)));
    expect(decoded.stopCount).toBe(2);
    const expected = [];
    for (let i = 0; i < p.flags.length; i++)
      if (!(p.flags[i] & (F.JUMP | F.TRIM | F.STOP | F.COLOR_CHANGE | F.END)))
        expected.push([Math.round(p.x[i] * 10) || 0, Math.round(p.y[i] * 10) || 0]);
    expect(decoded.commands.filter((c) => c.cmd === MC.STITCH).map((c) => [c.x, c.y])).toEqual(expected);
  },
);
