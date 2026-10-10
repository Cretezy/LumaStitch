// SPDX-License-Identifier: GPL-3.0-or-later
/** Thread swatches: edit a thread to change every element using it; map all to a chart or My threads. */
import { useMemo, useState } from 'react';
import { MoreHorizontal, Pipette } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Swatch, ThreadPicker, threadLabel } from '@/components/threads/ThreadPicker';
import { F } from '@/engine/types';
import type { Design, Id, Thread } from '@/model/types';
import { deleteThread, purgeUnusedThreads, upsertThread } from '@/store/commands';
import { exec, useDoc } from '@/store/documentStore';
import { usePlan } from '@/store/planStore';
import { useUi } from '@/store/uiStore';
import { getChart, listCharts } from '@/threads/charts';
import { nearestThread } from '@/threads/nearest';
import { deltaEHex } from '@/threads/color';
import { loadMyThreads } from '@/library/myThreads';
import { fmtInt, fmt } from '@/lib/utils';

function usage(design: Design) {
  const m = new Map<Id, Id[]>();
  for (const s of Object.values(design.shapes))
    for (const el of [s.fill, s.outline]) if (el) m.set(el.threadId, [...(m.get(el.threadId) ?? []), el.id]);
  return m;
}

async function mapAllThreads(target: string) {
  const design = useDoc.getState().design;
  if (!design) return;
  let cands: { color: string; name: string; code?: string; chart?: string }[] = [];
  if (target === 'myThreads') {
    const mine = await loadMyThreads();
    cands = mine.threads.map((t) => ({ color: t.color, name: t.name, code: t.code, chart: t.chart }));
    if (!cands.length) {
      useUi.getState().showToast('My threads is empty. Add your spools first (Stitch → My threads).');
      return;
    }
  } else {
    const chart = await getChart(target);
    cands = chart.threads.map((t) => ({ color: t.color, name: t.name, code: t.code, chart: chart.id }));
  }
  let worst = 0;
  exec('Map threads', (d) => {
    for (const t of Object.values(d.threads)) {
      const n = nearestThread(t.color, cands);
      if (n.index < 0) continue;
      worst = Math.max(worst, n.deltaE);
      const c = cands[n.index];
      d.threads[t.id] = { id: t.id, name: c.name, color: c.color, code: c.code, chart: c.chart };
    }
    if (target !== 'myThreads') d.threadChart = target;
  });
  useUi.getState().showToast(`Threads mapped (largest colour difference ΔE ${fmt(worst)}).`, 'success');
}

function ThreadRow({ t, els, stitches }: { t: Thread; els: Id[]; stitches: number }) {
  const [editing, setEditing] = useState(false);
  const threads = useDoc((s) => s.design?.threads ?? {});
  const design = useDoc((s) => s.design)!;
  const others = Object.values(threads).filter((x) => x.id !== t.id);
  const selectUsers = () => {
    const shapeIds = Object.values(design.shapes)
      .filter((s) => s.fill?.threadId === t.id || s.outline?.threadId === t.id)
      .map((s) => s.id);
    useUi.getState().setSelection({ shapeIds, elementIds: els, nodes: [] });
  };
  return (
    <div className="border-b px-3 py-2">
      <div className="flex items-center gap-2">
        <label className="relative cursor-pointer" title="Change colour">
          <Swatch color={t.color} className="size-6" />
          <input
            type="color"
            defaultValue={t.color}
            key={`${t.color}|${t.name}|${t.code ?? ''}|${t.chart ?? ''}`}
            className="absolute inset-0 cursor-pointer opacity-0"
            // React's onChange fires on every input event while the picker is dragged; commit once on the
            // native change event instead (one undo step).
            ref={(el) => {
              if (!el || (el as any).__lsBound) return;
              (el as any).__lsBound = true;
              el.addEventListener('change', () => {
                const c = el.value;
                if (c !== t.color)
                  upsertThread(
                    {
                      ...t,
                      color: c,
                      chart: undefined,
                      code: undefined,
                      name: t.chart ? c.toUpperCase() : t.name,
                    },
                    'Change thread colour',
                  );
              });
            }}
            aria-label={`Colour of ${t.name}`}
          />
        </label>
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          onClick={selectUsers}
          title="Select every element using this thread"
        >
          <div className="truncate text-xs font-medium">{threadLabel(t)}</div>
          <div className="text-[11px] text-muted-foreground">
            {t.chart ? `${t.chart} · ` : ''}
            {els.length} element{els.length === 1 ? '' : 's'} · {fmtInt(stitches)} st
          </div>
        </button>
        <ThreadPicker
          value={t.id}
          align="end"
          trigger={
            <Button variant="ghost" size="iconSm" aria-label="Replace thread from chart">
              <Pipette />
            </Button>
          }
          onPick={(c) => {
            if (c.thread) upsertThread({ id: t.id, ...c.thread }, 'Replace thread');
            else if (c.threadId && c.threadId !== t.id) deleteThread(t.id, c.threadId);
          }}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="iconSm" aria-label="Thread actions">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setEditing(true)}>Rename / set code…</DropdownMenuItem>
            <DropdownMenuItem onSelect={selectUsers}>Select elements</DropdownMenuItem>
            {others.length > 0 && <DropdownMenuSeparator />}
            {others.length > 0 && <DropdownMenuLabel>Merge into</DropdownMenuLabel>}
            {others.slice(0, 12).map((o) => (
              <DropdownMenuItem key={o.id} onSelect={() => deleteThread(t.id, o.id)}>
                <Swatch color={o.color} /> {threadLabel(o)}
                <span className="ml-auto text-[10px] text-muted-foreground">
                  ΔE {fmt(deltaEHex(t.color, o.color))}
                </span>
              </DropdownMenuItem>
            ))}
            {els.length === 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => deleteThread(t.id)}>
                  Delete unused thread
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {editing && (
        <form
          className="mt-2 grid grid-cols-[1fr_5rem_auto] gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            upsertThread(
              { ...t, name: String(f.get('name') || t.name), code: String(f.get('code') || '') || undefined },
              'Rename thread',
            );
            setEditing(false);
          }}
        >
          <Input
            name="name"
            defaultValue={t.name}
            className="h-7 text-xs"
            aria-label="Thread name"
            autoFocus
            onKeyDown={(e) => e.stopPropagation()}
          />
          <Input
            name="code"
            defaultValue={t.code ?? ''}
            placeholder="Code"
            className="h-7 text-xs"
            aria-label="Thread code"
            onKeyDown={(e) => e.stopPropagation()}
          />
          <Button size="sm" type="submit">
            Save
          </Button>
        </form>
      )}
    </div>
  );
}

export function ThreadsPanel() {
  const design = useDoc((s) => s.design);
  const plan = usePlan((s) => s.plan);
  const [target, setTarget] = useState('brother-embroidery');
  const charts = useMemo(() => listCharts(), []);
  const perThread = useMemo(() => {
    const m = new Map<Id, number>();
    if (!plan) return m;
    for (const b of plan.colorBlocks) {
      let c = 0;
      for (let i = b.start; i < b.end; i++)
        if (!(plan.flags[i] & (F.JUMP | F.TRIM | F.COLOR_CHANGE | F.STOP | F.END))) c++;
      m.set(b.threadId, (m.get(b.threadId) ?? 0) + c);
    }
    return m;
  }, [plan]);
  if (!design) return null;
  const use = usage(design);
  const threads = Object.values(design.threads);
  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto">
        {threads.map((t) => (
          <ThreadRow key={t.id} t={t} els={use.get(t.id) ?? []} stitches={perThread.get(t.id) ?? 0} />
        ))}
        {!threads.length && <p className="p-4 text-center text-xs text-muted-foreground">No threads yet.</p>}
      </div>
      <div className="space-y-2 border-t p-3">
        <div className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
          Map all colours to
        </div>
        <div className="flex gap-1.5">
          <Select value={target} onValueChange={setTarget}>
            <SelectTrigger size="sm" className="text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              <SelectItem value="myThreads" className="text-xs">
                My threads
              </SelectItem>
              {charts.map((c) => (
                <SelectItem key={c.id} value={c.id} className="text-xs">
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={() => void mapAllThreads(target)}>
            Map
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Picks the nearest thread (CIEDE2000) for every colour. Undo restores the exact colours.
        </p>
        <Button size="sm" variant="ghost" className="w-full text-xs" onClick={() => purgeUnusedThreads()}>
          Remove unused threads
        </Button>
      </div>
    </div>
  );
}
