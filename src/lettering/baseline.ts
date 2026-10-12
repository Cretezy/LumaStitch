// SPDX-License-Identifier: GPL-3.0-or-later
import { current, isDraft, type Draft } from 'immer';
import { createShape } from '@/model/factories';
import { transformGeomM } from '@/model/geomOps';
import { invert } from '@/geom/matrix';
import type { Design, LetteringOptions, Matrix, PathGeom } from '@/model/types';
import { layoutLettering } from './layout';
export class BaselineEditError extends Error {}
export function letteringBaseline(options: LetteringOptions, matrix: Matrix) {
  return options.baseline
    ? createShape('Lettering baseline (guide)', transformGeomM(options.baseline, matrix), {
        stroke: '#008b9b',
        strokeWidth: 0.25,
      })
    : undefined;
}
/** Reflow only baseline edits. Whole-group transforms already update the saved group matrix. */
export function reflowLetteringBaselines(draft: Draft<Design>, before: Design) {
  for (const [id, group] of Object.entries(draft.lettering ?? {})) {
    const old = before.lettering?.[id],
      sid = group.baselineShapeId;
    if (
      !old ||
      !sid ||
      !group.options.baseline ||
      !draft.shapes[sid] ||
      JSON.stringify(old) !== JSON.stringify(group)
    )
      continue;
    const geometry = draft.shapes[sid].geom;
    const geom = isDraft(geometry) ? current(geometry) : geometry;
    if (
      geom === before.shapes[sid]?.geom ||
      JSON.stringify(geom) === JSON.stringify(before.shapes[sid]?.geom)
    )
      continue;
    if (
      group.shapeIds.some(
        (id) =>
          id !== sid &&
          draft.shapes[id] &&
          (isDraft(draft.shapes[id].geom) ? current(draft.shapes[id].geom) : draft.shapes[id].geom) !==
            before.shapes[id]?.geom,
      )
    )
      continue;
    try {
      const options = {
        ...group.options,
        baseline: transformGeomM(geom as PathGeom, invert(group.matrix as Matrix)),
      };
      const ids = group.shapeIds.filter((s) => s !== sid),
        first = draft.shapes[ids[0]];
      const element = first?.fill ?? first?.outline;
      if (!element) continue;
      const shapes = layoutLettering(
        options,
        element.threadId,
        draft.threads[element.threadId]?.color ?? '#234a73',
        group.matrix as Matrix,
      );
      if (shapes.length !== ids.length) throw new Error('The lettering geometry no longer matches its text.');
      group.options = options;
      shapes.forEach((s, i) => {
        if (!draft.shapes[ids[i]]) throw new Error('The lettering block is incomplete.');
        draft.shapes[ids[i]].geom = s.geom;
        const el = draft.shapes[ids[i]].fill ?? draft.shapes[ids[i]].outline;
        if (el) {
          delete el.entry;
          delete el.exit;
          delete el.guides;
          delete el.railSplit;
        }
      });
    } catch (e) {
      throw new BaselineEditError(e instanceof Error ? e.message : String(e));
    }
  }
}
