// SPDX-License-Identifier: GPL-3.0-or-later
/** Diagnostics from the stitch plan; clicking one selects the affected element. */
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import type { Diagnostic } from '@/engine/types';
import { buildElementIndex } from '@/model/factories';
import { useDoc } from '@/store/documentStore';
import { usePlan } from '@/store/planStore';
import { useUi } from '@/store/uiStore';
import { zoomAt } from '@/canvas/viewport';
import { cn } from '@/lib/utils';

const ICON = { error: XCircle, warning: AlertTriangle, info: Info } as const;

export function IssuesPanel() {
  const design = useDoc((s) => s.design);
  const plan = usePlan((s) => s.plan);
  const notes = useUi((s) => s.importNotes);
  if (!design) return null;
  const diags = [
    ...(plan?.diagnostics ?? []),
    ...notes.map((n): Diagnostic => ({
      severity: 'info',
      code: 'import-' + n.code,
      message: `Import: ${n.message}`,
    })),
  ];
  const index = buildElementIndex(design);
  const order = { error: 0, warning: 1, info: 2 };
  const sorted = diags.slice().sort((a, b) => order[a.severity] - order[b.severity]);
  const open = (d: Diagnostic) => {
    const ui = useUi.getState();
    if (d.elementId) {
      const ref = index.get(d.elementId);
      if (ref) ui.setSelection({ shapeIds: [ref.shapeId], elementIds: [d.elementId], nodes: [] });
    }
    if (d.at) {
      const v = ui.viewport;
      const screen: [number, number] = [d.at[0] * v.zoom + v.pan[0], d.at[1] * v.zoom + v.pan[1]];
      const centred = {
        zoom: v.zoom,
        pan: [
          v.pan[0] + ui.canvasSize.width / 2 - screen[0],
          v.pan[1] + ui.canvasSize.height / 2 - screen[1],
        ] as [number, number],
      };
      ui.setViewport(
        v.zoom < 8
          ? zoomAt(centred, 8 / v.zoom, [ui.canvasSize.width / 2, ui.canvasSize.height / 2])
          : centred,
      );
    }
  };
  if (!sorted.length) {
    return (
      <div className="flex flex-col items-center gap-2 p-6 text-center text-xs text-muted-foreground">
        <CheckCircle2 className="size-6 text-emerald-600" />
        No issues found.
      </div>
    );
  }
  return (
    <ul className="divide-y">
      {sorted.map((d, i) => {
        const Icon = ICON[d.severity];
        const ref = d.elementId ? index.get(d.elementId) : undefined;
        const shape = ref ? design.shapes[ref.shapeId] : undefined;
        return (
          <li key={i}>
            <button
              type="button"
              onClick={() => open(d)}
              className="flex w-full items-start gap-2 px-3 py-2 text-left text-xs hover:bg-accent"
            >
              <Icon
                className={cn(
                  'mt-0.5 size-3.5 shrink-0',
                  d.severity === 'error'
                    ? 'text-destructive'
                    : d.severity === 'warning'
                      ? 'text-amber-600'
                      : 'text-muted-foreground',
                )}
              />
              <span className="min-w-0">
                <span className="block">{d.message}</span>
                {shape && (
                  <span className="text-muted-foreground">
                    {ref!.role === 'fill' ? 'Fill' : 'Outline'} · {shape.name}
                  </span>
                )}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
