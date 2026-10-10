// SPDX-License-Identifier: GPL-3.0-or-later
/** Width × height in mm with a locked aspect ratio: typing one side drives the other. */
import { useEffect, useId, useState } from 'react';
import { LockIcon } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Tip } from '@/components/ui/tooltip';
import { cn, fmt } from '@/lib/utils';

export type SizeAxis = 'width' | 'height';

export interface SizeValue {
  axis: SizeAxis;
  /** mm along `axis`. */
  value: number;
}

export const MIN_SIZE_MM = 1;
export const MAX_SIZE_MM = 2000;

/** Both sides of a size value given the aspect ratio (width / height). */
export function sizeToWH(v: SizeValue, aspect: number): { width: number; height: number } {
  const a = aspect > 0 && Number.isFinite(aspect) ? aspect : 1;
  return v.axis === 'width'
    ? { width: v.value, height: v.value / a }
    : { width: v.value * a, height: v.value };
}

function Field({
  label,
  value,
  active,
  disabled,
  onCommit,
}: {
  label: string;
  value: number;
  active: boolean;
  disabled?: boolean;
  onCommit: (v: number) => void;
}) {
  const id = useId();
  const [text, setText] = useState(fmt(value, 1));
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setText(fmt(value, 1));
  }, [value, editing]);
  const parsed = Number.parseFloat(text.replace(',', '.'));
  const valid = Number.isFinite(parsed) && parsed >= MIN_SIZE_MM && parsed <= MAX_SIZE_MM;
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <label htmlFor={id} className="text-[11px] font-medium text-muted-foreground">
        {label}
      </label>
      <div className="relative">
        <Input
          id={id}
          inputMode="decimal"
          disabled={disabled}
          aria-invalid={!valid}
          value={text}
          className={cn('pr-9 tabular-nums', active && 'border-ring/60', !valid && 'border-destructive')}
          onFocus={() => setEditing(true)}
          onBlur={() => {
            setEditing(false);
            setText(fmt(value, 1));
          }}
          onChange={(e) => {
            setText(e.target.value);
            const v = Number.parseFloat(e.target.value.replace(',', '.'));
            if (Number.isFinite(v) && v >= MIN_SIZE_MM && v <= MAX_SIZE_MM) onCommit(v);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault();
              const step = e.shiftKey ? 10 : 1;
              const next = Math.min(
                MAX_SIZE_MM,
                Math.max(MIN_SIZE_MM, Math.round(value) + (e.key === 'ArrowUp' ? step : -step)),
              );
              setText(String(next));
              onCommit(next);
            }
          }}
        />
        <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-xs text-muted-foreground">
          mm
        </span>
      </div>
    </div>
  );
}

export function SizeFields({
  value,
  aspect,
  onChange,
  disabled,
}: {
  value: SizeValue;
  /** width / height */
  aspect: number;
  onChange: (v: SizeValue) => void;
  disabled?: boolean;
}) {
  const wh = sizeToWH(value, aspect);
  return (
    <div className="flex items-end gap-1.5">
      <Field
        label="Width"
        value={wh.width}
        active={value.axis === 'width'}
        disabled={disabled}
        onCommit={(v) => onChange({ axis: 'width', value: v })}
      />
      <Tip label="Aspect ratio is locked">
        <span
          className="mb-2 inline-flex size-4 shrink-0 items-center justify-center text-muted-foreground"
          aria-label="Aspect ratio locked"
        >
          <LockIcon className="size-3.5" />
        </span>
      </Tip>
      <Field
        label="Height"
        value={wh.height}
        active={value.axis === 'height'}
        disabled={disabled}
        onCommit={(v) => onChange({ axis: 'height', value: v })}
      />
    </div>
  );
}
