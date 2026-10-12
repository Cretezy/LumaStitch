// SPDX-License-Identifier: GPL-3.0-or-later
import { useDoc, exec } from '@/store/documentStore';
import { useUi } from '@/store/uiStore';
import type { Node } from '@/model/types';

export function ManualCommandSettings() {
  const design = useDoc((s) => s.design);
  const refs = useUi((s) => s.selection.nodes);
  const selected = refs.filter((r) => design?.shapes[r.shapeId]?.outline?.params.preserveCommands === true);
  if (!design || !selected.length) return null;
  const values = selected.map(
    (r) => design.shapes[r.shapeId].geom.subpaths[r.sub]?.nodes[r.idx]?.command ?? 'stitch',
  );
  const same = values.every((v) => v === values[0]);
  return (
    <div className="grid gap-2 border-b p-3 text-xs">
      <label className="grid gap-1">
        Selected machine command
        <select
          aria-label="Selected machine command"
          className="rounded border bg-background p-2"
          value={same ? values[0] : 'mixed'}
          onChange={(e) => {
            const command = e.target.value;
            if (command === 'mixed') return;
            exec('Change machine command', (d) => {
              for (const ref of selected) {
                const s = d.shapes[ref.shapeId];
                if (!s || s.locked) continue;
                const n = s.geom.subpaths[ref.sub]?.nodes[ref.idx];
                if (n) {
                  if (command === 'stitch') delete n.command;
                  else n.command = command as Node['command'];
                }
              }
            });
          }}
        >
          <option value="mixed" disabled>
            Mixed commands
          </option>
          <option value="stitch">Needle down</option>
          <option value="jump">Jump</option>
          <option value="trim">Trim</option>
          <option value="stop">Stop</option>
        </select>
      </label>
      <p className="text-muted-foreground">
        Move needles with the node tool. Delete removes the selected commands; double-click inserts a needle
        point. Resizing scales the existing stitches.
      </p>
    </div>
  );
}
