// SPDX-License-Identifier: GPL-3.0-or-later
/** Inspector controls generated from ParamDefs (slider + number, select, switch, angle dial). */
import { useRef, useState } from 'react';
import type { ParamDef } from '@/engine/params/types';
import type { ParamValue } from '@/model/types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Tip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { NumberField } from './NumberField';

export interface ParamState {
  /** Effective value, or null when mixed across the selection. */
  value: ParamValue | null;
  /** True when any selected element overrides it. */
  overridden: boolean;
}

/** Small circular dial for angles (screen CCW from +x). */
export function AngleDial({
  value,
  onChange,
  size = 28,
}: {
  value: number | null;
  onChange: (v: number) => void;
  size?: number;
}) {
  const ref = useRef<SVGSVGElement>(null);
  // Track the drag locally; commit once on release (one undo step, one plan rebuild).
  const [drag, setDrag] = useState<number | null>(null);
  const shown = drag ?? value;
  const r = size / 2 - 2;
  const a = ((shown ?? 0) * Math.PI) / 180;
  const angleAt = (e: React.PointerEvent) => {
    const rect = ref.current!.getBoundingClientRect();
    const dx = e.clientX - (rect.left + rect.width / 2),
      dy = e.clientY - (rect.top + rect.height / 2);
    let deg = (-Math.atan2(dy, dx) * 180) / Math.PI;
    deg = ((deg % 180) + 180) % 180;
    if (e.shiftKey) deg = Math.round(deg / 15) * 15;
    return Math.round(deg) % 180;
  };
  return (
    <svg
      ref={ref}
      width={size}
      height={size}
      className="shrink-0 cursor-pointer"
      role="img"
      aria-label={`Angle ${value ?? 'mixed'}°`}
      onPointerDown={(e) => {
        (e.target as Element).setPointerCapture(e.pointerId);
        setDrag(angleAt(e));
      }}
      onPointerMove={(e) => {
        if (e.buttons & 1) setDrag(angleAt(e));
      }}
      onPointerUp={(e) => {
        const v = angleAt(e);
        setDrag(null);
        if (v !== value) onChange(v);
      }}
      onPointerCancel={() => setDrag(null)}
    >
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" opacity={0.25} />
      {shown !== null && (
        <line
          x1={size / 2 - Math.cos(a) * r}
          y1={size / 2 + Math.sin(a) * r}
          x2={size / 2 + Math.cos(a) * r}
          y2={size / 2 - Math.sin(a) * r}
          stroke="var(--primary)"
          strokeWidth={2}
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}

/** Slider that tracks the drag locally and commits once on release (one undo step). */
export function LiveSlider({
  value,
  min,
  max,
  step,
  onCommit,
  label,
}: {
  value: number | null;
  min: number;
  max: number;
  step: number;
  onCommit: (v: number) => void;
  label: string;
}) {
  const [drag, setDrag] = useState<number | null>(null);
  const v = drag ?? (value === null ? null : Math.max(min, Math.min(max, value)));
  return (
    <Slider
      className="flex-1"
      min={min}
      max={max}
      step={step}
      value={v === null ? [min] : [v]}
      onValueChange={(x) => setDrag(x[0])}
      onValueCommit={(x) => {
        setDrag(null);
        onCommit(Number((Math.round(x[0] / step) * step).toFixed(4)));
      }}
      aria-label={label}
    />
  );
}

export function ParamRow({
  def,
  state,
  onChange,
  onReset,
}: {
  def: ParamDef;
  state: ParamState;
  onChange: (v: ParamValue) => void;
  onReset: () => void;
}) {
  const { value, overridden } = state;
  const label = (
    <div className="flex min-w-0 items-center gap-1">
      <Tip label={def.help}>
        <span
          className={cn(
            'truncate text-xs',
            def.help &&
              'cursor-help underline decoration-dotted decoration-muted-foreground/50 underline-offset-2',
          )}
        >
          {def.label}
        </span>
      </Tip>
      {overridden && (
        <Tip label="Overridden — click to reset to the inherited value">
          <button
            type="button"
            onClick={onReset}
            className="grid size-4 place-items-center rounded-full text-primary hover:bg-accent"
            aria-label={`Reset ${def.label}`}
          >
            <span className="block size-1.5 rounded-full bg-primary" />
          </button>
        </Tip>
      )}
    </div>
  );
  const inherited = !overridden;
  if (def.kind === 'boolean') {
    return (
      <div className="flex items-center justify-between gap-2 py-1">
        {label}
        <Switch checked={value === true} onCheckedChange={(c) => onChange(c)} aria-label={def.label} />
      </div>
    );
  }
  if (def.kind === 'enum') {
    return (
      <div className="grid grid-cols-[1fr_9.5rem] items-center gap-2 py-1">
        {label}
        <Select value={typeof value === 'string' ? value : undefined} onValueChange={(v) => onChange(v)}>
          <SelectTrigger
            size="sm"
            className={cn('text-xs', inherited && 'text-muted-foreground')}
            aria-label={def.label}
          >
            <SelectValue placeholder="Mixed" />
          </SelectTrigger>
          <SelectContent>
            {def.options?.map((o) => (
              <SelectItem key={o.value} value={o.value} className="text-xs">
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }
  const isAuto = value === 'auto';
  const num = typeof value === 'number' ? value : null;
  const digits = def.kind === 'angle' ? 1 : def.kind === 'fraction' ? 2 : (def.step ?? 0.1) < 0.1 ? 2 : 1;
  return (
    <div className="py-1">
      <div className="mb-1 flex items-center justify-between gap-2">
        {label}
        {def.allowAuto && (
          <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
            Auto
            <Switch
              checked={isAuto}
              onCheckedChange={(c) => onChange(c ? 'auto' : (def.min ?? 0) + (def.kind === 'angle' ? 90 : 2))}
              aria-label={`${def.label} auto`}
            />
          </label>
        )}
      </div>
      {!isAuto && (
        <div className="flex items-center gap-2">
          {def.kind === 'angle' ? (
            <AngleDial value={num} onChange={(v) => onChange(v)} />
          ) : (
            <LiveSlider
              value={num}
              min={def.min ?? 0}
              max={def.max ?? 10}
              step={def.step ?? 0.1}
              onCommit={(v) => onChange(v)}
              label={def.label}
            />
          )}
          <NumberField
            value={num}
            min={def.min}
            max={def.max}
            step={def.step}
            digits={digits}
            unit={def.unit === '%' ? '%' : def.unit}
            inherited={inherited}
            className={def.kind === 'angle' ? 'flex-1' : 'w-20'}
            onCommit={(v) => onChange(v)}
            ariaLabel={def.label}
          />
        </div>
      )}
    </div>
  );
}
