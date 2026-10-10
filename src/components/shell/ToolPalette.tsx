// SPDX-License-Identifier: GPL-3.0-or-later
import {
  Circle,
  Compass,
  Flag,
  Hand,
  MousePointer2,
  MousePointerClick,
  PenTool,
  Square,
  Spline,
  ZoomIn,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Tip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { getTool } from '@/tools';
import { useUi, type ToolId } from '@/store/uiStore';

const ITEMS: { id: ToolId; icon: LucideIcon; label: string; key?: string; help?: string }[] = [
  {
    id: 'select',
    icon: MousePointer2,
    label: 'Select',
    key: 'V',
    help: 'Click, shift-click or drag a box to select. Drag to move; handles scale; drag just outside a corner to rotate.',
  },
  {
    id: 'direct',
    icon: MousePointerClick,
    label: 'Direct select',
    key: 'A',
    help: 'Edit nodes and curve handles. Double-click a segment to add a node.',
  },
  {
    id: 'pen',
    icon: PenTool,
    label: 'Pen',
    key: 'P',
    help: 'Click for corners, drag for curves. Click the first node to close; Enter to finish.',
  },
  { id: 'rect', icon: Square, label: 'Rectangle', key: 'M' },
  { id: 'ellipse', icon: Circle, label: 'Ellipse', key: 'L' },
  { id: 'hand', icon: Hand, label: 'Hand', key: 'H', help: 'Or hold Space and drag.' },
  {
    id: 'zoom',
    icon: ZoomIn,
    label: 'Zoom',
    key: 'Z',
    help: 'Click to zoom in, Alt-click to zoom out. The mouse wheel also zooms.',
  },
  {
    id: 'angle',
    icon: Compass,
    label: 'Stitch angle',
    key: 'G',
    help: 'Drag across a fill to set the direction of its stitch rows. Shift snaps to 15°.',
  },
  {
    id: 'entryExit',
    icon: Flag,
    label: 'Start / end point',
    key: 'T',
    help: 'Click to set where the selected element starts sewing; Alt-click sets where it ends.',
  },
  {
    id: 'satinDirection',
    icon: Spline,
    label: 'Satin direction',
    help: 'Drag across a satin fill to add a direction line. Alt-click the outline to move rail split points. Delete removes the last line.',
  },
];

export function ToolPalette() {
  const tool = useUi((s) => s.tool);
  const setTool = useUi((s) => s.setTool);
  const sim = useUi((s) => s.sim.active);
  return (
    <nav aria-label="Tools" className="flex w-11 flex-col items-center gap-0.5 border-r bg-background py-2">
      {ITEMS.map((it, i) => (
        <div key={it.id} className="contents">
          {(i === 2 || i === 5 || i === 7) && <div className="my-1 h-px w-6 bg-border" />}
          <Tip
            side="right"
            label={
              <span>
                <b>{it.label}</b>
                {it.key ? <span className="ml-1 opacity-70">({it.key})</span> : null}
                {it.help ? <span className="mt-0.5 block opacity-80">{it.help}</span> : null}
              </span>
            }
          >
            <button
              type="button"
              aria-label={it.label}
              aria-pressed={tool === it.id}
              disabled={sim}
              onClick={() => {
                getTool(tool).onCancel?.();
                setTool(it.id);
              }}
              className={cn(
                'grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40',
                tool === it.id && 'bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary',
              )}
            >
              <it.icon className="size-4" />
            </button>
          </Tip>
        </div>
      ))}
      {tool === 'entryExit' && <EntryExitMode />}
    </nav>
  );
}

function EntryExitMode() {
  const mode = useUi((s) => s.entryExitMode);
  return (
    <div className="mt-2 flex flex-col gap-0.5 text-[10px]">
      {(['entry', 'exit'] as const).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => useUi.getState().set({ entryExitMode: m })}
          className={cn(
            'rounded px-1 py-0.5',
            mode === m ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent',
          )}
        >
          {m === 'entry' ? 'Start' : 'End'}
        </button>
      ))}
    </div>
  );
}
