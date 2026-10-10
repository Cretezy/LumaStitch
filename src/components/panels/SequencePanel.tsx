// SPDX-License-Identifier: GPL-3.0-or-later
/** Sewing order grouped into colour blocks; drag to reorder elements or whole blocks; stops. */
import { useEffect, useMemo, useRef } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ArrowDownToLine,
  ArrowUpToLine,
  ChevronDown,
  ChevronUp,
  CirclePause,
  GripVertical,
  PaintBucket,
  Route,
  Spline,
  Trash2,
  Wand2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tip } from '@/components/ui/tooltip';
import { Swatch, threadLabel } from '@/components/threads/ThreadPicker';
import { F, type StitchPlan } from '@/engine/types';
import { getStitchType } from '@/engine/registry';
import { buildElementIndex, getElement } from '@/model/factories';
import type { Design, Id, SequenceEntry } from '@/model/types';
import { insertStop, moveElements, removeStop, reorderSequence, selectedElementIds } from '@/store/commands';
import { optimizeSequence } from '@/store/actions';
import { useDoc } from '@/store/documentStore';
import { usePlan } from '@/store/planStore';
import { useUi } from '@/store/uiStore';
import { sim } from '@/simulator/controller';
import { cn, fmtInt, MOD } from '@/lib/utils';

type Row =
  | { kind: 'block'; key: string; block: number; threadId: Id; entries: number[] }
  | { kind: 'element'; key: string; seqIndex: number; elementId: Id; shapeId: Id; role: 'fill' | 'outline' }
  | { kind: 'stop'; key: string; seqIndex: number; id: Id; note?: string };

const keyOf = (e: SequenceEntry) => (e.kind === 'element' ? 'e:' + e.elementId : 's:' + e.id);

function buildRows(design: Design): Row[] {
  const index = buildElementIndex(design);
  const rows: Row[] = [];
  let cur: Id | null = null;
  let block: Row & { kind: 'block' } = null as never;
  let blockNo = 0;
  let afterStop = false;
  design.sequence.forEach((e, i) => {
    if (e.kind === 'stop') {
      rows.push({ kind: 'stop', key: keyOf(e), seqIndex: i, id: e.id, note: e.note });
      afterStop = true;
      return;
    }
    const ref = index.get(e.elementId);
    const el = getElement(design, ref);
    if (!el || !ref) return;
    if (el.threadId !== cur || afterStop || !block) {
      cur = el.threadId;
      block = { kind: 'block', key: 'b:' + blockNo, block: blockNo++, threadId: el.threadId, entries: [] };
      rows.push(block);
    }
    afterStop = false;
    block.entries.push(i);
    rows.push({
      kind: 'element',
      key: keyOf(e),
      seqIndex: i,
      elementId: e.elementId,
      shapeId: ref.shapeId,
      role: ref.role,
    });
  });
  return rows;
}

function useElementStitches(plan: StitchPlan | null): Map<Id, number> {
  return useMemo(() => {
    const m = new Map<Id, number>();
    if (!plan) return m;
    for (const r of plan.elementRanges) {
      let c = 0;
      for (let i = r.start; i < r.end; i++)
        if (!(plan.flags[i] & (F.JUMP | F.TRIM | F.COLOR_CHANGE | F.STOP | F.END))) c++;
      m.set(r.elementId, c);
    }
    return m;
  }, [plan]);
}

function SortableRow({
  id,
  children,
  className,
}: {
  id: string;
  children: (handle: React.HTMLAttributes<HTMLElement>) => React.ReactNode;
  className?: string;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(className, isDragging && 'relative z-10 opacity-80 shadow-md')}
      data-row={id}
    >
      {children({ ...attributes, ...listeners })}
    </div>
  );
}

export function SequencePanel() {
  const design = useDoc((s) => s.design);
  const plan = usePlan((s) => s.plan);
  const sel = useUi((s) => s.selection);
  const hover = useUi((s) => s.hover);
  const simActive = useUi((s) => s.sim.active);
  const simIndex = useUi((s) => s.sim.index);
  const stitches = useElementStitches(plan);
  const listRef = useRef<HTMLDivElement>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const rows = useMemo(() => (design ? buildRows(design) : []), [design]);
  const selectedEls = design ? new Set(selectedElementIds(design)) : new Set<Id>();
  const current = simActive && plan ? sim.currentElementId(plan, simIndex) : null;

  useEffect(() => {
    if (!current || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-row="e:${current}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [current]);

  if (!design) return null;
  const blockStitches = (b: Row & { kind: 'block' }) =>
    b.entries.reduce(
      (n, i) => n + (stitches.get((design.sequence[i] as { elementId: Id }).elementId) ?? 0),
      0,
    );

  /** Moves rows in the visual list, then rebuilds the sequence from it (headers are dropped). */
  const onDragEnd = (e: DragEndEvent) => {
    const active = String(e.active.id);
    const over = e.over ? String(e.over.id) : null;
    if (!over || active === over) return;
    const from = rows.findIndex((r) => r.key === active);
    const to = rows.findIndex((r) => r.key === over);
    if (from < 0 || to < 0) return;
    const activeRow = rows[from];
    let moving: number[];
    if (activeRow.kind === 'block') {
      // The header plus its element rows (they follow it contiguously).
      moving = [from];
      for (
        let i = from + 1;
        i < rows.length &&
        rows[i].kind === 'element' &&
        activeRow.entries.includes((rows[i] as { seqIndex: number }).seqIndex);
        i++
      )
        moving.push(i);
    } else if (activeRow.kind === 'element' && selectedEls.has(activeRow.elementId) && selectedEls.size > 1) {
      // Dragging a selected element moves the whole selection with it.
      moving = rows
        .map((r, i) => (r.kind === 'element' && selectedEls.has(r.elementId) ? i : -1))
        .filter((i) => i >= 0);
    } else moving = [from];
    if (moving.includes(to)) return; // dropped onto itself
    const movingSet = new Set(moving);
    const items = moving.map((i) => rows[i]);
    const rest = rows.filter((_, i) => !movingSet.has(i));
    let at = rest.indexOf(rows[to]);
    if (from < to) at += 1; // moving down: insert after the target row
    rest.splice(at, 0, ...items);
    const seq: SequenceEntry[] = [];
    for (const r of rest) if (r.kind !== 'block') seq.push(design.sequence[r.seqIndex]);
    if (seq.every((x, i) => x === design.sequence[i])) return;
    reorderSequence(seq, activeRow.kind === 'block' ? 'Move colour block' : 'Reorder');
  };

  const clickElement = (r: Row & { kind: 'element' }, ev: React.MouseEvent) => {
    const ui = useUi.getState();
    if (simActive && plan) {
      const range = plan.elementRanges.find((x) => x.elementId === r.elementId);
      if (range) sim.seek(range.start);
      return;
    }
    if (ev.shiftKey || ev.metaKey || ev.ctrlKey) {
      const has = sel.elementIds.includes(r.elementId);
      const elementIds = has
        ? sel.elementIds.filter((x) => x !== r.elementId)
        : [...sel.elementIds, r.elementId];
      const shapeIds = [...new Set(elementIds.map((id) => buildElementIndex(design).get(id)!.shapeId))];
      ui.setSelection({ elementIds, shapeIds, nodes: [] });
    } else ui.setSelection({ shapeIds: [r.shapeId], elementIds: [r.elementId], nodes: [] });
  };

  const selIds = selectedElementIds(design);
  const insertStopHere = () => {
    let idx = design.sequence.length;
    if (selIds.length) {
      const last = Math.max(
        ...selIds.map((id) => design.sequence.findIndex((e) => e.kind === 'element' && e.elementId === id)),
      );
      if (last >= 0) idx = last + 1;
    }
    insertStop(idx);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-0.5 border-b px-2 py-1">
        <Tip label={`Sew earlier (${MOD}[)`}>
          <Button
            variant="ghost"
            size="iconSm"
            disabled={!selIds.length || simActive}
            onClick={() => moveElements(selIds, 'up')}
            aria-label="Move up"
          >
            <ChevronUp />
          </Button>
        </Tip>
        <Tip label={`Sew later (${MOD}])`}>
          <Button
            variant="ghost"
            size="iconSm"
            disabled={!selIds.length || simActive}
            onClick={() => moveElements(selIds, 'down')}
            aria-label="Move down"
          >
            <ChevronDown />
          </Button>
        </Tip>
        <Tip label="Move to start">
          <Button
            variant="ghost"
            size="iconSm"
            disabled={!selIds.length || simActive}
            onClick={() => moveElements(selIds, 'start')}
            aria-label="Move to start"
          >
            <ArrowUpToLine />
          </Button>
        </Tip>
        <Tip label="Move to end">
          <Button
            variant="ghost"
            size="iconSm"
            disabled={!selIds.length || simActive}
            onClick={() => moveElements(selIds, 'end')}
            aria-label="Move to end"
          >
            <ArrowDownToLine />
          </Button>
        </Tip>
        <Tip label="Insert a stop after the selection (manual thread change, appliqué…)">
          <Button
            variant="ghost"
            size="iconSm"
            disabled={simActive}
            onClick={insertStopHere}
            aria-label="Insert stop"
          >
            <CirclePause />
          </Button>
        </Tip>
        <div className="ml-auto" />
        <Tip label="Fewest colour changes first, then shortest travel, without sewing a lower layer over an upper one">
          <Button variant="ghost" size="sm" disabled={simActive} onClick={() => void optimizeSequence()}>
            <Wand2 /> Optimize
          </Button>
        </Tip>
      </div>
      <div
        ref={listRef}
        className="flex-1 overflow-y-auto py-1"
        role="listbox"
        aria-multiselectable="true"
        aria-label="Sewing sequence"
      >
        {!rows.length && <p className="p-4 text-center text-xs text-muted-foreground">Nothing to sew yet.</p>}
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={rows.map((r) => r.key)} strategy={verticalListSortingStrategy}>
            {rows.map((r) => {
              if (r.kind === 'block') {
                const t = design.threads[r.threadId];
                return (
                  <SortableRow key={r.key} id={r.key} className="mt-1 first:mt-0">
                    {(h) => (
                      <div className="group flex items-center gap-1.5 bg-muted/60 px-2 py-1 text-xs font-medium">
                        <span
                          {...h}
                          className="cursor-grab text-muted-foreground/60 hover:text-foreground"
                          aria-label="Drag colour block"
                        >
                          <GripVertical className="size-3.5" />
                        </span>
                        <Swatch color={t?.color ?? null} />
                        <span className="tabular-nums text-muted-foreground">{r.block + 1}</span>
                        <span className="truncate">{t ? threadLabel(t) : '?'}</span>
                        <span className="ml-auto tabular-nums text-muted-foreground">
                          {fmtInt(blockStitches(r))}
                        </span>
                      </div>
                    )}
                  </SortableRow>
                );
              }
              if (r.kind === 'stop') {
                return (
                  <SortableRow key={r.key} id={r.key}>
                    {(h) => (
                      <div className="group flex items-center gap-1.5 px-2 py-1 text-xs text-red-600">
                        <span {...h} className="cursor-grab text-muted-foreground/60" aria-label="Drag stop">
                          <GripVertical className="size-3.5" />
                        </span>
                        <CirclePause className="size-3.5" />
                        <span>Stop{r.note ? ` · ${r.note}` : ''}</span>
                        <button
                          type="button"
                          className="ml-auto opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                          onClick={() => removeStop(r.id)}
                          aria-label="Remove stop"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    )}
                  </SortableRow>
                );
              }
              const shape = design.shapes[r.shapeId];
              const el = r.role === 'fill' ? shape.fill : shape.outline;
              const selected = selectedEls.has(r.elementId);
              const isCurrent = current === r.elementId;
              return (
                <SortableRow key={r.key} id={r.key}>
                  {(h) => (
                    <div
                      role="option"
                      aria-selected={selected}
                      tabIndex={0}
                      onClick={(ev) => clickElement(r, ev)}
                      onKeyDown={(ev) => {
                        if (ev.key === 'Enter' || ev.key === ' ') {
                          ev.preventDefault();
                          clickElement(r, ev as unknown as React.MouseEvent);
                        } else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
                          ev.preventDefault();
                          const all = [
                            ...(listRef.current?.querySelectorAll<HTMLElement>('[role=option]') ?? []),
                          ];
                          const i = all.indexOf(ev.currentTarget);
                          all[i + (ev.key === 'ArrowDown' ? 1 : -1)]?.focus();
                        }
                      }}
                      onMouseEnter={() =>
                        useUi.getState().set({ hover: { elementId: r.elementId, shapeId: r.shapeId } })
                      }
                      onMouseLeave={() =>
                        hover?.elementId === r.elementId && useUi.getState().set({ hover: null })
                      }
                      className={cn(
                        'flex cursor-default items-center gap-1.5 py-1 pr-2 pl-5 text-xs outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset',
                        selected && 'bg-primary/10 hover:bg-primary/15',
                        isCurrent && 'bg-amber-200/60 dark:bg-amber-500/25',
                        shape.hidden && 'opacity-50',
                      )}
                    >
                      <span
                        {...h}
                        className="cursor-grab text-muted-foreground/50 hover:text-foreground"
                        aria-label="Drag to reorder"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <GripVertical className="size-3" />
                      </span>
                      {r.role === 'fill' ? (
                        <PaintBucket className="size-3.5 text-muted-foreground" />
                      ) : el?.type === 'running' || el?.type === 'triple' ? (
                        <Route className="size-3.5 text-muted-foreground" />
                      ) : (
                        <Spline className="size-3.5 text-muted-foreground" />
                      )}
                      <span className="min-w-0 flex-1 truncate">
                        <span className="text-muted-foreground">
                          {el ? getStitchType(el.type).label : ''} ·{' '}
                        </span>
                        {shape.name}
                      </span>
                      <span className="tabular-nums text-muted-foreground">
                        {fmtInt(stitches.get(r.elementId) ?? 0)}
                      </span>
                    </div>
                  )}
                </SortableRow>
              );
            })}
          </SortableContext>
        </DndContext>
      </div>
    </div>
  );
}
