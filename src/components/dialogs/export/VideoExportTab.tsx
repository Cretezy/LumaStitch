// SPDX-License-Identifier: GPL-3.0-or-later
/** Stitch-out video export panel: timing (length or speed), size, style and a live preview. */
import { useEffect, useId, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import type { StitchPlan } from '@/engine/types';
import {
  VIDEO_HOLD_END,
  VIDEO_MAX_SECONDS,
  VIDEO_MIN_SECONDS,
  VIDEO_SIZES,
  createStitchOutRenderer,
  machineStitchSeconds,
  videoSeconds,
  videoSize,
  type VideoSize,
  type VideoTiming,
} from '@/io/export/video';
import type { Design } from '@/model/types';
import { NumberField } from '@/components/inspector/NumberField';
import { Checkbox } from '@/components/ui/checkbox';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { fmt, fmtInt, fmtTime } from '@/lib/utils';
import { SectionTitle, Swatch } from './parts';

export interface VideoSettings {
  timing: 'length' | 'speed';
  seconds: number;
  factor: number;
  size: VideoSize;
  mode: 'flat' | 'realistic';
  background: 'fabric' | 'white';
  needle: boolean;
}

export const DEFAULT_VIDEO_SETTINGS: VideoSettings = {
  timing: 'length',
  seconds: 20,
  factor: 10,
  size: 1920,
  mode: 'realistic',
  background: 'fabric',
  needle: true,
};

/** Restores saved settings, ignoring anything invalid. */
export function readVideoSettings(v: unknown): VideoSettings {
  const s = { ...DEFAULT_VIDEO_SETTINGS };
  if (!v || typeof v !== 'object') return s;
  const o = v as Partial<Record<keyof VideoSettings, unknown>>;
  if (o.timing === 'length' || o.timing === 'speed') s.timing = o.timing;
  if (typeof o.seconds === 'number' && o.seconds >= VIDEO_MIN_SECONDS && o.seconds <= VIDEO_MAX_SECONDS)
    s.seconds = o.seconds;
  if (typeof o.factor === 'number' && o.factor > 0 && o.factor <= 10000) s.factor = o.factor;
  if (VIDEO_SIZES.includes(o.size as VideoSize)) s.size = o.size as VideoSize;
  if (o.mode === 'flat' || o.mode === 'realistic') s.mode = o.mode;
  if (o.background === 'fabric' || o.background === 'white') s.background = o.background;
  if (typeof o.needle === 'boolean') s.needle = o.needle;
  return s;
}

export function videoTiming(s: VideoSettings): VideoTiming {
  return s.timing === 'length' ? { kind: 'length', seconds: s.seconds } : { kind: 'speed', factor: s.factor };
}

const SIZE_LABELS: Record<VideoSize, string> = { 1280: 'HD', 1920: 'Full HD', 3840: '4K' };

export function VideoExportTab({
  plan,
  design,
  settings,
  onChange,
  fabricColor,
  container,
  progress,
}: {
  plan: StitchPlan;
  design: Design;
  settings: VideoSettings;
  onChange: (s: VideoSettings) => void;
  fabricColor: string;
  /** File type this browser will produce; null = can't encode, undefined = still checking. */
  container: 'mp4' | 'webm' | null | undefined;
  /** Encoding progress 0..1 while exporting. */
  progress: number | null;
}) {
  const timingId = useId();
  const sizeId = useId();
  const modeId = useId();
  const bgId = useId();
  const set = (p: Partial<VideoSettings>) => onChange({ ...settings, ...p });
  const spm = design.settings.machineSpm;
  const machine = machineStitchSeconds(plan, spm);
  const seconds = videoSeconds(plan, videoTiming(settings), spm);
  const speed = machine / seconds;
  const px = videoSize(plan, settings.size);
  const background = settings.background === 'fabric' ? fabricColor : '#ffffff';

  return (
    <div className="grid gap-4 sm:grid-cols-[1fr_15rem]">
      <div className="grid content-start gap-2">
        <VideoPreview
          plan={plan}
          mode={settings.mode}
          background={background}
          needle={settings.needle}
          seconds={seconds}
          label={`Stitch-out preview of ${design.name}`}
        />
        {progress !== null ? (
          <div className="grid gap-1" role="status">
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width]"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground tabular-nums">
              Encoding… {Math.round(progress * 100)}%
            </p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            The preview plays at the video’s speed. Jumps, trims and colour changes happen instantly.
          </p>
        )}
      </div>
      <div className="grid content-start gap-4">
        <div className="grid gap-1.5">
          <SectionTitle id={timingId}>Timing</SectionTitle>
          <ToggleGroup
            type="single"
            value={settings.timing}
            onValueChange={(v) => v && set({ timing: v as VideoSettings['timing'] })}
            aria-labelledby={timingId}
            className="w-full"
          >
            <ToggleGroupItem value="length" className="flex-1">
              Length
            </ToggleGroupItem>
            <ToggleGroupItem value="speed" className="flex-1">
              Speed
            </ToggleGroupItem>
          </ToggleGroup>
          {settings.timing === 'length' ? (
            <NumberField
              value={settings.seconds}
              onCommit={(v) => set({ seconds: v })}
              min={VIDEO_MIN_SECONDS}
              max={VIDEO_MAX_SECONDS}
              step={1}
              digits={1}
              unit="s"
              ariaLabel="Video length in seconds"
            />
          ) : (
            <NumberField
              value={settings.factor}
              onCommit={(v) => set({ factor: v })}
              min={0.1}
              max={10000}
              step={1}
              digits={1}
              unit="×"
              ariaLabel="Speed relative to the machine"
            />
          )}
          <p className="text-xs text-muted-foreground" data-testid="video-timing">
            {settings.timing === 'length' ? (
              <>
                <span className="font-medium text-foreground tabular-nums">{fmtSpeed(speed)}</span> the
                machine’s speed
              </>
            ) : (
              <>
                Video length{' '}
                <span className="font-medium text-foreground tabular-nums">{fmtTime(seconds)}</span>
              </>
            )}
            . Sewing takes {fmtTime(machine)} at {fmtInt(spm)} stitches/min.
            {seconds >= VIDEO_MAX_SECONDS && ` Videos are limited to ${VIDEO_MAX_SECONDS / 60} minutes.`}
          </p>
        </div>
        <div className="grid gap-1.5">
          <SectionTitle id={sizeId}>Size</SectionTitle>
          <ToggleGroup
            type="single"
            value={String(settings.size)}
            onValueChange={(v) => v && set({ size: Number(v) as VideoSize })}
            aria-labelledby={sizeId}
            className="w-full"
          >
            {VIDEO_SIZES.map((s) => (
              <ToggleGroupItem key={s} value={String(s)} className="flex-1">
                {SIZE_LABELS[s]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        <div className="grid gap-1.5">
          <SectionTitle id={modeId}>Rendering</SectionTitle>
          <ToggleGroup
            type="single"
            value={settings.mode}
            onValueChange={(v) => v && set({ mode: v as VideoSettings['mode'] })}
            aria-labelledby={modeId}
            className="w-full"
          >
            <ToggleGroupItem value="realistic" className="flex-1">
              Realistic
            </ToggleGroupItem>
            <ToggleGroupItem value="flat" className="flex-1">
              Flat
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        <div className="grid gap-1.5">
          <SectionTitle id={bgId}>Background</SectionTitle>
          <ToggleGroup
            type="single"
            value={settings.background}
            onValueChange={(v) => v && set({ background: v as VideoSettings['background'] })}
            aria-labelledby={bgId}
            className="w-full"
          >
            <ToggleGroupItem value="fabric" className="flex-1">
              <Swatch color={fabricColor} className="size-3" />
              Fabric
            </ToggleGroupItem>
            <ToggleGroupItem value="white" className="flex-1">
              <Swatch color="#ffffff" className="size-3" />
              White
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={settings.needle} onCheckedChange={(c) => set({ needle: !!c })} />
          Show the needle
        </label>
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground tabular-nums">
            {fmtInt(px.width)} × {fmtInt(px.height)} px
          </span>
          {container === null
            ? '. This browser can’t encode video.'
            : `, 30 fps ${container === 'webm' ? 'WebM' : 'MP4'}, ${fmtTime(seconds + VIDEO_HOLD_END)} long.`}
        </p>
      </div>
    </div>
  );
}

function fmtSpeed(x: number): string {
  if (x >= 100) return `${fmtInt(x)}×`;
  if (x >= 10) return `${fmt(x, 0)}×`;
  return `${fmt(x, 1)}×`;
}

/** Loops the stitch-out at the video's speed, on a small canvas. */
function VideoPreview({
  plan,
  mode,
  background,
  needle,
  seconds,
  label,
}: {
  plan: StitchPlan;
  mode: 'flat' | 'realistic';
  background: string;
  needle: boolean;
  seconds: number;
  label: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [playing, setPlaying] = useState(true);
  // Playback position survives setting changes, so changing the speed doesn't restart it.
  const pos = useRef(0);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const box = canvas.getBoundingClientRect();
    const longest = Math.max(160, Math.round(Math.max(box.width, box.height) * dpr));
    const size = videoSize(plan, longest);
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d')!;
    const renderer = createStitchOutRenderer(plan, { ...size, mode, background, needle });
    const cycle = seconds + VIDEO_HOLD_END;
    let raf = 0;
    let last = performance.now();
    const draw = () => {
      renderer.render(pos.current / seconds);
      ctx.drawImage(renderer.canvas, 0, 0);
    };
    const tick = (t: number) => {
      pos.current = (pos.current + (t - last) / 1000) % cycle;
      last = t;
      draw();
      raf = requestAnimationFrame(tick);
    };
    draw();
    if (playing) raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [plan, mode, background, needle, seconds, playing]);

  return (
    <div className="relative flex h-64 items-center justify-center overflow-hidden rounded-md border bg-muted/40">
      <canvas
        ref={ref}
        role="img"
        aria-label={label}
        data-testid="video-preview"
        className="max-h-full max-w-full object-contain"
        style={{ width: '100%', height: '100%' }}
      />
      <button
        type="button"
        onClick={() => setPlaying((p) => !p)}
        className="absolute bottom-2 left-2 grid size-7 place-items-center rounded-full bg-background/90 text-foreground shadow-sm ring-1 ring-border hover:bg-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        aria-label={playing ? 'Pause preview' : 'Play preview'}
      >
        {playing ? <Pause className="size-3.5" aria-hidden /> : <Play className="size-3.5" aria-hidden />}
      </button>
    </div>
  );
}
