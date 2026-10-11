// SPDX-License-Identifier: GPL-3.0-or-later
import { layoutLettering } from '@/lettering/layout';
import { IDENTITY } from '@/geom/matrix';
import { newId } from '@/lib/ids';
import type { LetteringOptions } from '@/model/types';
import { exec, useDoc } from '../documentStore';
import { useUi } from '../uiStore';

export function selectedLetteringId(): string | undefined {
  const d = useDoc.getState().design;
  const selected = useUi.getState().selection.shapeIds;
  return Object.entries(d?.lettering ?? {}).find(
    ([, g]) => selected.length > 0 && selected.every((id) => g.shapeIds.includes(id)),
  )?.[0];
}

export function setLettering(options: LetteringOptions, color: string, groupId?: string): string {
  const design = useDoc.getState().design;
  if (!design) throw new Error('Open a design first.');
  const old = groupId ? design.lettering?.[groupId] : undefined;
  if (groupId && !old) throw new Error('This lettering has been detached.');
  if (old) {
    const ids = new Set(
      old.shapeIds.flatMap((sid) => [design.shapes[sid]?.fill?.id, design.shapes[sid]?.outline?.id]),
    );
    const positions = design.sequence.flatMap((e, i) =>
      e.kind === 'element' && ids.has(e.elementId) ? [i] : [],
    );
    if (positions.length && positions.at(-1)! - positions[0] + 1 !== positions.length)
      throw new Error(
        'The letters are interleaved with other sewing operations. Restore their contiguous order before editing text, or use Object → Detach lettering to edit its paths.',
      );
  }
  const id = groupId ?? newId('text');
  const thread = Object.values(design.threads).find((t) => t.color.toLowerCase() === color.toLowerCase()) ?? {
    id: newId('t'),
    name: color,
    color,
  };
  const matrix = old?.matrix ?? IDENTITY;
  const shapes = layoutLettering(options, thread.id, color, matrix);
  exec(
    old ? 'Edit lettering' : 'Add lettering',
    (d) => {
      const removed = new Set(old?.shapeIds ?? []);
      const elements = new Set(
        [...removed].flatMap((sid) => [d.shapes[sid]?.fill?.id, d.shapes[sid]?.outline?.id]),
      );
      let zIndex = d.zOrder.findIndex((sid) => removed.has(sid));
      let seqIndex = d.sequence.findIndex((e) => e.kind === 'element' && elements.has(e.elementId));
      for (const sid of removed) delete d.shapes[sid];
      d.zOrder = d.zOrder.filter((sid) => !removed.has(sid));
      d.sequence = d.sequence.filter((e) => e.kind === 'stop' || !elements.has(e.elementId));
      if (zIndex < 0) zIndex = d.zOrder.length;
      if (seqIndex < 0) seqIndex = d.sequence.length;
      d.threads[thread.id] = thread;
      for (const s of shapes) d.shapes[s.id] = s;
      d.zOrder.splice(zIndex, 0, ...shapes.map((s) => s.id));
      d.sequence.splice(
        seqIndex,
        0,
        ...shapes.map((s) => ({ kind: 'element' as const, elementId: s.outline!.id })),
      );
      d.lettering ??= {};
      d.lettering[id] = { options, matrix, shapeIds: shapes.map((s) => s.id) };
    },
    { selection: { shapeIds: shapes.map((s) => s.id), elementIds: [], nodes: [] } },
  );
  return id;
}

export function detachLettering(id: string): void {
  exec('Detach lettering', (d) => {
    if (d.lettering) delete d.lettering[id];
  });
}
