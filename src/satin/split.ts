// SPDX-License-Identifier: GPL-3.0-or-later
import { flattenSubpath } from '@/geom/flatten';
import { compound, polylineGeom } from '@/geom/shapes';
import { resolveParams } from '@/engine/params/resolve';
import { num, str } from '@/engine/params/types';
import { satinCommonDefaults } from '@/engine/stitches/satin';
import {
  colA,
  colB,
  columnFromCenterline,
  resolveSatinUnderlay,
  type Column,
} from '@/engine/stitches/satin/column';
import { columnFromRails } from '@/engine/stitches/satinColumn';
import { newId } from '@/lib/ids';
import type { Design, Shape, Vec2, PathGeom, StitchElement } from '@/model/types';

export function splitSatinGeometry(
  shape: Shape,
  design: Pick<Design, 'fabric' | 'fabricProfile'>,
  fraction: number,
) {
  const el = shape.outline;
  if (el?.satinGroups) throw new Error('Ungroup the satin columns before splitting one.');
  if (shape.locked) throw new Error('Unlock the column before splitting it.');
  if (shape.fill || !el || !['satin', 'satinColumn'].includes(el.type))
    throw new Error('Select one satin outline or rail column without a fill.');
  if (!Number.isFinite(fraction) || fraction < 0.01 || fraction > 0.99)
    throw new Error('Choose a split position from 1% to 99%.');
  if (shape.geom.subpaths.some((s) => s.closed)) throw new Error('Open the satin path before splitting it.');
  const params = resolveParams(el, design.fabric, design.fabricProfile);
  const paths = shape.geom.subpaths.map((s) => flattenSubpath(s, 0.03));
  let col: Column,
    width = 0;
  if (el.type === 'satin') {
    if (paths.length !== 1)
      throw new Error('Select a single open centerline. Break apart compound paths first.');
    width = typeof params.width === 'number' ? params.width : Math.max(0.8, shape.art.strokeWidth ?? 2);
    col = columnFromCenterline(paths[0], false, width / 2);
  } else {
    if (paths.length < 2) throw new Error('A rail column needs two open rails.');
    const rungs: [Vec2, Vec2][] = paths
      .slice(2)
      .filter((p) => p.length >= 4)
      .map((p) => [
        [p[0], p[1]],
        [p[p.length - 2], p[p.length - 1]],
      ]);
    col = columnFromRails(paths[0], paths[1], [...rungs, ...(el.guides ?? [])]);
    for (let i = 0; i < col.a.length; i += 2)
      width = Math.max(
        width,
        Math.hypot(col.a[i] - col.b[i], col.a[i + 1] - col.b[i + 1]) + 2 * num(params, 'pullComp', 0.2),
      );
  }
  if (col.length < 0.2) throw new Error('The column is too short to split.');
  if (col.s.length > 2000)
    throw new Error('This column exceeds the 2,000-sample splitting limit. Split a shorter section first.');
  const cut = col.length * fraction;
  if (Math.min(cut, col.length - cut) < 0.1) throw new Error('Each section must be at least 0.1 mm long.');
  const sections = [
    [0, cut],
    [cut, col.length],
  ].map(([start, end]) => {
    const positions = [start, ...Array.from(col.s).filter((s) => s > start + 1e-7 && s < end - 1e-7), end];
    const a = positions.map((s) => colA(col, s)),
      b = positions.map((s) => colB(col, s));
    const geom: PathGeom = compound([polylineGeom(a), polylineGeom(b)]);
    // Keep paired rail correspondence (including original rungs), rather than re-matching
    // unequal rail arc lengths after cutting. Rungs remain editable direction guides.
    const guides: [Vec2, Vec2][] = a.slice(1, -1).map((p, i) => [p, b[i + 1]]);
    // Validate the baked correspondence now so the command cannot create an invalid column.
    columnFromRails(Float64Array.from(a.flat()), Float64Array.from(b.flat()), guides);
    return { geom, guides };
  });
  const settings: StitchElement['params'] = {};
  for (const key of Object.keys(satinCommonDefaults)) settings[key] = params[key];
  settings.underlay = resolveSatinUnderlay(
    str(params, 'underlay', 'auto'),
    width,
    num(params, 'underlayBoost', 0),
  );
  return {
    sections,
    cut: [colA(col, cut), colB(col, cut)] as [Vec2, Vec2],
    length: col.length,
    params: settings,
  };
}

export function splitSatinShape(
  shape: Shape,
  design: Pick<Design, 'fabric' | 'fabricProfile'>,
  fraction: number,
): Shape[] {
  const split = splitSatinGeometry(shape, design, fraction);
  return split.sections.map((section, i) => {
    const outline: StitchElement = {
      ...structuredClone(shape.outline!),
      id: newId('e'),
      type: 'satinColumn',
      params: { ...split.params },
      guides: section.guides,
      userEdited: true,
    };
    delete outline.entry;
    delete outline.exit;
    delete outline.railSplit;
    return {
      ...structuredClone(shape),
      id: newId('s'),
      name: `${shape.name} (${i + 1})`,
      geom: section.geom,
      outline,
    };
  });
}
