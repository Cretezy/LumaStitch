// SPDX-License-Identifier: GPL-3.0-or-later
/** Playback bar (Simulate mode): transport, speed, timeline with colour blocks, counters and machine time. */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronFirst,
  ChevronLast,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  StepBack,
  StepForward,
  Video,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tip } from '@/components/ui/tooltip';
import { Switch } from '@/components/ui/switch';
import { F, type StitchPlan } from '@/engine/types';
import { cn, fmtInt, fmtTime } from '@/lib/utils';
import { buildElementIndex } from '@/model/factories';
import { useDoc } from '@/store/documentStore';
import { usePlan } from '@/store/planStore';
import { useUi } from '@/store/uiStore';
import { toggleSimulate } from '@/store/actions';
import { SPEEDS, sim } from './controller';

function useLiveIndex(): number {
  const [i, setI] = useState(() => Math.floor(sim.index));
  useEffect(() => sim.subscribe(setI), []);
  return i;
}

/** Cumulative penetration count per command. */
const countCache = new WeakMap<StitchPlan, Uint32Array>();
function stitchCounts(plan: StitchPlan): Uint32Array {
  let c = countCache.get(plan);
  if (c) return c;
  c = new Uint32Array(plan.flags.length);
  let n = 0;
  for (let i = 0; i < plan.flags.length; i++) {
    if (!(plan.flags[i] & (F.JUMP | F.TRIM | F.COLOR_CHANGE | F.STOP | F.END))) n++;
    c[i] = n;
  }
  countCache.set(plan, c);
  return c;
}

function Timeline({ plan, index }: { plan: StitchPlan; index: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ x: number; i: number } | null>(null);
  const design = useDoc((s) => s.design);
  const n = Math.max(1, plan.flags.length - 1);
  const markers = useMemo(() => {
    const out: { i: number; kind: 'trim' | 'stop' }[] = [];
    for (let i = 0; i < plan.flags.length; i++) {
      if (plan.flags[i] & F.TRIM) out.push({ i, kind: 'trim' });
      else if (plan.flags[i] & F.STOP) out.push({ i, kind: 'stop' });
    }
    return out;
  }, [plan]);
  const nameAt = (i: number) => {
    const id = sim.currentElementId(plan, i);
    if (!id || !design) return '';
    const ref2 = buildElementIndex(design).get(id);
    const s = ref2 ? design.shapes[ref2.shapeId] : null;
    return s ? `${ref2!.role === 'fill' ? 'Fill' : 'Outline'} · ${s.name}` : '';
  };
  const idxAt = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    return Math.round(Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * n);
  };
  const counts = stitchCounts(plan);
  return (
    <div
      ref={ref}
      role="slider"
      tabIndex={0}
      aria-label="Simulation position"
      aria-valuemin={0}
      aria-valuemax={n}
      aria-valuenow={index}
      className="relative h-6 flex-1 cursor-pointer select-none"
      onPointerDown={(e) => {
        (e.target as Element).setPointerCapture(e.pointerId);
        sim.pause();
        sim.seek(idxAt(e.clientX));
      }}
      onPointerMove={(e) => {
        const r = ref.current!.getBoundingClientRect();
        setHover({ x: e.clientX - r.left, i: idxAt(e.clientX) });
        if (e.buttons & 1) sim.seek(idxAt(e.clientX));
      }}
      onPointerLeave={() => setHover(null)}
    >
      <div className="absolute inset-x-0 top-1.5 flex h-3 overflow-hidden rounded-sm">
        {plan.colorBlocks.map((b, k) => (
          <div
            key={k}
            style={{ width: `${((b.end - b.start) / plan.flags.length) * 100}%`, background: b.color }}
            className="h-full border-r border-background/60 opacity-90 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.12)]"
          />
        ))}
      </div>
      {markers.map((m, k) => (
        <div
          key={k}
          className={cn(
            'pointer-events-none absolute top-0.5 h-5 w-px',
            m.kind === 'stop' ? 'bg-red-600' : 'bg-foreground/50',
          )}
          style={{ left: `${(m.i / n) * 100}%` }}
        />
      ))}
      <div
        className="pointer-events-none absolute top-0 h-6 w-0.5 -translate-x-1/2 rounded bg-foreground shadow"
        style={{ left: `${(index / n) * 100}%` }}
      >
        <div className="absolute -top-1 left-1/2 size-2.5 -translate-x-1/2 rounded-full border-2 border-background bg-foreground" />
      </div>
      {hover && (
        <div
          className="pointer-events-none absolute bottom-7 z-10 -translate-x-1/2 rounded bg-foreground px-2 py-1 text-[11px] whitespace-nowrap text-background"
          style={{ left: hover.x }}
        >
          Stitch {fmtInt(counts[Math.min(hover.i, counts.length - 1)] ?? 0)}
          {nameAt(hover.i) ? ` · ${nameAt(hover.i)}` : ''}
        </div>
      )}
    </div>
  );
}

export function SimulatorBar() {
  const plan = usePlan((s) => s.plan);
  const simState = useUi((s) => s.sim);
  const setSim = useUi((s) => s.setSim);
  const index = useLiveIndex();
  const [playing, setPlaying] = useState(sim.isPlaying());
  useEffect(() => sim.subscribe(() => setPlaying(sim.isPlaying())), []);
  useEffect(() => setPlaying(simState.playing), [simState.playing]);
  if (!plan || !plan.flags.length) {
    return (
      <div className="flex h-11 items-center gap-2 border-t bg-background px-3 text-sm text-muted-foreground">
        Nothing to simulate yet.
        <Button variant="ghost" size="sm" onClick={toggleSimulate}>
          Close
        </Button>
      </div>
    );
  }
  const k = Math.min(index, plan.flags.length - 1);
  const counts = stitchCounts(plan);
  const times = sim.times(plan);
  const block = plan.colorBlocks.findIndex((b) => k >= b.start && k < b.end);
  const btn = (label: string, icon: React.ReactNode, onClick: () => void) => (
    <Tip label={label}>
      <Button variant="ghost" size="iconSm" onClick={onClick} aria-label={label}>
        {icon}
      </Button>
    </Tip>
  );
  return (
    <div className="flex h-11 items-center gap-1.5 border-t bg-background px-2" data-testid="simulator-bar">
      {btn('Start (Home)', <ChevronFirst />, () => sim.seek(0))}
      {btn('Previous colour', <SkipBack />, () => sim.color(-1))}
      {btn('Previous element (⇧←)', <StepBack />, () => sim.element(-1))}
      <Tip label="Play / pause (Space)">
        <Button size="iconSm" onClick={() => sim.toggle()} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? <Pause /> : <Play />}
        </Button>
      </Tip>
      {btn('Next element (⇧→)', <StepForward />, () => sim.element(1))}
      {btn('Next colour', <SkipForward />, () => sim.color(1))}
      {btn('End (End)', <ChevronLast />, () => sim.seek(plan.flags.length))}
      <div className="mx-1 flex items-center rounded-md border p-0.5" role="group" aria-label="Speed">
        {SPEEDS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSim({ speed: s })}
            className={cn(
              'rounded px-1.5 py-0.5 text-[11px] tabular-nums',
              simState.speed === s
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent',
            )}
          >
            {s === Infinity ? 'max' : `${s}×`}
          </button>
        ))}
      </div>
      <Timeline plan={plan} index={k} />
      <div className="ml-2 flex items-center gap-2 text-[11px] whitespace-nowrap tabular-nums">
        {block >= 0 && (
          <span
            className="inline-block size-3 rounded-sm border"
            style={{ background: plan.colorBlocks[block].color }}
            title={`Colour ${block + 1}`}
          />
        )}
        <span>
          {fmtInt(counts[k])} / {fmtInt(plan.stats.stitches)}
        </span>
        <span className="text-muted-foreground">
          {fmtTime(times[k])} / {fmtTime(times[times.length - 1] ?? 0)}
        </span>
      </div>
      <Tip label="Pause at each colour change or stop, like the machine">
        <label className="ml-2 flex items-center gap-1 text-[11px] text-muted-foreground">
          <Switch
            checked={simState.stopAtColorChange}
            onCheckedChange={(c) => setSim({ stopAtColorChange: c })}
          />
          Stops
        </label>
      </Tip>
      {btn('Export as video…', <Video />, () => {
        sim.pause();
        useUi.getState().openDialog('export', {
          format: 'video',
          ...(Number.isFinite(simState.speed) ? { speed: simState.speed } : {}),
        });
      })}
      {btn('Close simulator (Esc)', <X />, toggleSimulate)}
    </div>
  );
}
