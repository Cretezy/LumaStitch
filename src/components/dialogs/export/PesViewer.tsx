// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Read-only viewer for a `.pes` file (SPEC FR-6.6): rendered preview, header info, colour
 * list and a simple stitch-out playback. Uses the same reader that verifies our exports.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { LoaderCircle, Pause, Play, RotateCcw } from 'lucide-react';
import { Slider as SliderPrimitive } from 'radix-ui';
import { F, type StitchPlan } from '@/engine/types';
import type { PesReadResult } from '@/io/pes';
import { pesColorAt, pesColorIndexOf } from '@/io/pes/toPlan';
import { DEFAULT_SETTINGS } from '@/model/factories';
import { useDoc } from '@/store/documentStore';
import { fabricColorOf } from '@/model/types';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn, fmt, fmtInt, fmtTime } from '@/lib/utils';
import { PlanCanvas } from './PlanCanvas';
import { DesignStats, ErrorBox, SectionTitle, Swatch } from './parts';
import { loadPesFile, versionLabel, type LoadedPes } from './pesFile';

export function PesViewer({ file }: { file: File }) {
  const [state, setState] = useState<LoadedPes>({ kind: 'loading' });
  useEffect(() => {
    let alive = true;
    setState({ kind: 'loading' });
    void loadPesFile(file).then((s) => alive && setState(s));
    return () => {
      alive = false;
    };
  }, [file]);

  if (state.kind === 'loading') {
    return (
      <p className="flex items-center gap-2 py-10 text-sm text-muted-foreground" role="status">
        <LoaderCircle className="size-4 animate-spin" aria-hidden /> Reading {file.name}…
      </p>
    );
  }
  if (state.kind === 'error') {
    return (
      <ErrorBox title={state.title}>
        {file.name}: {state.detail}
      </ErrorBox>
    );
  }
  return <ViewerBody read={state.read} plan={state.plan} name={file.name} />;
}

const SPEEDS = ['1', '5', '25', '100', 'max'] as const;
type Speed = (typeof SPEEDS)[number];

function ViewerBody({ read, plan, name }: { read: PesReadResult; plan: StitchPlan; name: string }) {
  const fabricColor = useDoc((s) => fabricColorOf(s.design));
  const last = Math.max(0, plan.flags.length - 1);
  const [index, setIndex] = useState(last);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>('25');
  const [mode, setMode] = useState<'flat' | 'realistic'>('flat');
  const indexRef = useRef(index);
  indexRef.current = index;

  // Prefix sums for the counters: stitches and estimated machine time up to command i.
  const prefix = useMemo(() => {
    const n = plan.flags.length;
    const stitches = new Uint32Array(n);
    const seconds = new Float64Array(n);
    const spm = DEFAULT_SETTINGS.machineSpm;
    let s = 0;
    let t = 0;
    for (let i = 0; i < n; i++) {
      const f = plan.flags[i];
      if (f === F.STITCH) {
        s++;
        t += 60 / spm;
      } else if (f & F.TRIM) t += DEFAULT_SETTINGS.trimSeconds;
      else if (f & (F.COLOR_CHANGE | F.STOP)) t += DEFAULT_SETTINGS.colorChangeSeconds;
      stitches[i] = s;
      seconds[i] = t;
    }
    return { stitches, seconds };
  }, [plan]);

  useEffect(() => {
    if (!playing) return;
    const rate =
      speed === 'max' ? Math.max(last / 6, 2000) : (DEFAULT_SETTINGS.machineSpm / 60) * Number(speed);
    let pos = indexRef.current >= last ? 0 : indexRef.current;
    let prev = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      pos = Math.min(last, pos + ((now - prev) / 1000) * rate);
      prev = now;
      setIndex(Math.floor(pos));
      if (pos >= last) {
        setPlaying(false);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, last]);

  const blocks = useMemo(
    () =>
      plan.colorBlocks.map((b, i) => {
        const c = pesColorAt(read, pesColorIndexOf(b.threadId));
        let stitches = 0;
        for (let j = b.start; j < b.end; j++) if (plan.flags[j] === F.STITCH) stitches++;
        const stop = i > 0 && b.start > 0 && (plan.flags[b.start - 1] & F.STOP) !== 0;
        return { ...b, info: c, stitches, stop };
      }),
    [plan, read],
  );
  const activeBlock = blocks.findIndex((b) => index >= b.start && index < b.end);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    if (e.key === ' ' && t.tagName !== 'BUTTON' && t.tagName !== 'INPUT') {
      e.preventDefault();
      setPlaying((p) => !p);
    }
  };

  const b = plan.bounds;
  const full = index >= last;
  return (
    <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_15rem]" onKeyDown={onKeyDown}>
      <div className="grid content-start gap-2">
        <div className="relative">
          <PlanCanvas
            plan={plan}
            mode={mode}
            upTo={full ? undefined : index}
            background={fabricColor}
            className="aspect-square w-full rounded-md border"
            label={`Stitch preview of ${name}${full ? '' : `, ${fmtInt(prefix.stitches[index] ?? 0)} of ${fmtInt(plan.stats.stitches)} stitches sewn`}`}
          />
          <ToggleGroup
            type="single"
            value={mode}
            onValueChange={(v) => v && setMode(v as 'flat' | 'realistic')}
            aria-label="Rendering"
            className="absolute top-2 right-2 bg-background/90"
          >
            <ToggleGroupItem value="flat" className="h-6 px-1.5">
              Flat
            </ToggleGroupItem>
            <ToggleGroupItem value="realistic" className="h-6 px-1.5">
              Realistic
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="iconSm"
            variant="outline"
            onClick={() => setPlaying((p) => !p)}
            aria-label={playing ? 'Pause' : full ? 'Play from the start' : 'Play'}
            disabled={last === 0}
          >
            {playing ? <Pause /> : full ? <RotateCcw /> : <Play />}
          </Button>
          <SliderPrimitive.Root
            min={0}
            max={last}
            step={1}
            value={[index]}
            onValueChange={([v]) => {
              setPlaying(false);
              setIndex(v ?? 0);
            }}
            className="relative flex h-5 flex-1 touch-none items-center select-none"
          >
            <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-muted">
              <SliderPrimitive.Range className="absolute h-full bg-primary" />
            </SliderPrimitive.Track>
            <SliderPrimitive.Thumb
              aria-label="Playback position"
              aria-valuetext={`${fmtInt(prefix.stitches[index] ?? 0)} of ${fmtInt(plan.stats.stitches)} stitches`}
              className="block size-3.5 rounded-full border border-primary bg-background shadow-sm hover:ring-4 hover:ring-ring/30 focus-visible:ring-4 focus-visible:ring-ring/40 focus-visible:outline-hidden"
            />
          </SliderPrimitive.Root>
        </div>
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5 tabular-nums">
            {activeBlock >= 0 && <Swatch color={blocks[activeBlock].color} className="size-3" />}
            {fmtInt(prefix.stitches[index] ?? 0)} / {fmtInt(plan.stats.stitches)} ·{' '}
            {fmtTime(prefix.seconds[index] ?? 0)} / {fmtTime(plan.stats.estSeconds)}
          </span>
          <ToggleGroup
            type="single"
            value={speed}
            onValueChange={(v) => v && setSpeed(v as Speed)}
            aria-label="Playback speed"
          >
            {SPEEDS.map((s) => (
              <ToggleGroupItem
                key={s}
                value={s}
                className="h-6 px-1.5"
                aria-label={s === 'max' ? 'Maximum speed' : `${s} times machine speed`}
              >
                {s === 'max' ? 'Max' : `${s}×`}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      </div>

      <div className="grid content-start gap-4">
        <div className="grid gap-1.5">
          <SectionTitle>File</SectionTitle>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <dt className="text-muted-foreground">Format</dt>
            <dd className="text-right font-medium">{versionLabel(read)}</dd>
            <dt className="text-muted-foreground">Label</dt>
            <dd className="truncate text-right font-mono font-medium">{read.label || '—'}</dd>
            {read.metadata.name && read.metadata.name !== read.label && (
              <>
                <dt className="text-muted-foreground">Name</dt>
                <dd className="truncate text-right font-medium">{read.metadata.name}</dd>
              </>
            )}
          </dl>
          <DesignStats
            plan={plan}
            extra={[
              ['Jumps', fmtInt(plan.stats.jumps)],
              ['X range', `${fmt(b.minX)} to ${fmt(b.maxX)} mm`],
              ['Y range', `${fmt(b.minY)} to ${fmt(b.maxY)} mm`],
            ]}
          />
        </div>
        <div className="grid gap-1.5">
          <SectionTitle>Colours</SectionTitle>
          <ol
            className="grid max-h-52 gap-px overflow-y-auto rounded-md border bg-border"
            aria-label="Colour sequence"
          >
            {blocks.map((blk, i) => (
              <li key={i}>
                <button
                  type="button"
                  className={cn(
                    'flex w-full items-center gap-2 bg-background px-2 py-1 text-left text-xs hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
                    i === activeBlock && !full && 'bg-accent',
                  )}
                  onClick={() => {
                    setPlaying(false);
                    setIndex(Math.max(0, blk.end - 1));
                  }}
                  aria-label={`Show up to colour ${i + 1}, ${blk.info.name ?? blk.color}`}
                >
                  <span className="w-4 text-muted-foreground tabular-nums">{i + 1}</span>
                  <Swatch color={blk.color} />
                  <span
                    className="min-w-0 flex-1 truncate"
                    title={[blk.info.name, blk.info.code, blk.info.brand].filter(Boolean).join(' · ')}
                  >
                    {blk.info.name ?? blk.color.toUpperCase()}
                    {blk.info.code && <span className="text-muted-foreground"> {blk.info.code}</span>}
                  </span>
                  {blk.stop && (
                    <span className="rounded bg-muted px-1 text-[10px] text-muted-foreground">stop</span>
                  )}
                  <span className="text-muted-foreground tabular-nums">{fmtInt(blk.stitches)}</span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}
