// SPDX-License-Identifier: GPL-3.0-or-later
import { resolveParams } from '@/engine/params/resolve';
import { satinColumnDef } from '@/engine/stitches/satinColumn';
import { polylineGeom } from '@/geom/shapes';
import { newId } from '@/lib/ids';
import type { Design, Shape, StitchElement } from '@/model/types';

export function groupSatinColumns(design: Design, ids: string[]): Shape {
  if (ids.length < 2 || ids.length > 50 || new Set(ids).size !== ids.length)
    throw new Error('Select 2–50 separate satin rail columns.');
  const sources = ids.map((id) => design.shapes[id]);
  if (
    sources.some(
      (s) =>
        !s ||
        s.locked ||
        s.hidden ||
        s.fill ||
        s.outline?.type !== 'satinColumn' ||
        s.outline.satinGroups ||
        s.geom.subpaths.some((p) => p.closed),
    )
  )
    throw new Error(
      'Select unlocked, visible Satin rails objects without fills. Ungroup existing groups first.',
    );
  const first = sources[0].outline!,
    params = resolveParams(first, design.fabric, design.fabricProfile);
  const settings = (el: StitchElement) =>
    JSON.stringify([
      el.threadId,
      el.tieIn,
      el.tieOut,
      el.trimAfter,
      Object.entries(resolveParams(el, design.fabric, design.fabricProfile)).sort(),
    ]);
  if (sources.some((s) => settings(s.outline!) !== settings(first)))
    throw new Error(
      'Grouped columns must use the same thread, stitch parameters and tie/trim settings. Widths can differ through their rail geometry.',
    );
  if (sources.some((s) => s.geom.subpaths.length + (s.outline!.guides?.length ?? 0) > 2002))
    throw new Error('Each column can have at most 2,000 direction guides.');
  const elementIds = new Set(sources.map((s) => s.outline!.id));
  const positions = design.sequence.flatMap((e, i) =>
    e.kind === 'element' && elementIds.has(e.elementId) ? [i] : [],
  );
  if (positions.length !== sources.length || positions.at(-1)! - positions[0] + 1 !== positions.length)
    throw new Error(
      'Put these columns together in the sewing sequence, without stops or other elements between them, before grouping.',
    );
  sources.sort(
    (a, b) =>
      design.sequence.findIndex((e) => e.kind === 'element' && e.elementId === a.outline!.id) -
      design.sequence.findIndex((e) => e.kind === 'element' && e.elementId === b.outline!.id),
  );
  const geom = {
    fillRule: 'nonzero' as const,
    subpaths: sources.flatMap((s) => [
      ...structuredClone(s.geom.subpaths),
      ...(s.outline!.guides ?? []).flatMap((g) => polylineGeom(g).subpaths),
    ]),
  };
  const outline: StitchElement = {
    ...structuredClone(first),
    id: newId('e'),
    params,
    satinGroups: sources.map((s) => s.geom.subpaths.length + (s.outline!.guides?.length ?? 0)),
    userEdited: true,
  };
  delete outline.guides;
  delete outline.railSplit;
  delete outline.entry;
  delete outline.exit;
  const diagnostics: string[] = [];
  satinColumnDef.prepare(geom, params, outline, {
    settings: design.settings,
    tolerance: 0.03,
    diag: (_code, text, _point, severity) => {
      if (severity === 'error') diagnostics.push(text);
    },
  });
  if (diagnostics.length) throw new Error(diagnostics.join(' '));
  return {
    ...structuredClone(sources[0]),
    id: newId('s'),
    name: `Satin rail group (${sources.length} columns)`,
    geom,
    outline,
  };
}

export function ungroupSatinColumns(shape: Shape): Shape[] {
  const el = shape.outline,
    groups = el?.satinGroups;
  if (shape.locked || !el || !groups) throw new Error('Select one unlocked grouped satin object.');
  if (groups.reduce((a, b) => a + b, 0) !== shape.geom.subpaths.length)
    throw new Error('The grouped subpath count changed. Undo that path operation first.');
  let offset = 0;
  return groups.map((count, i) => {
    const outline = { ...structuredClone(el), id: newId('e') };
    delete outline.satinGroups;
    delete outline.guides;
    delete outline.entry;
    delete outline.exit;
    const result = {
      ...structuredClone(shape),
      id: newId('s'),
      name: `Satin column ${i + 1}`,
      geom: { ...shape.geom, subpaths: structuredClone(shape.geom.subpaths.slice(offset, offset + count)) },
      outline,
    };
    offset += count;
    return result;
  });
}
