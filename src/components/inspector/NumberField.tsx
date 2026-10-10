// SPDX-License-Identifier: GPL-3.0-or-later
/** Numeric input that commits on Enter/blur, reverts on Escape, supports "Mixed" and arrow-key steps. */
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export interface NumberFieldProps {
  value: number | null; // null = mixed
  onCommit: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  digits?: number;
  unit?: string;
  label?: string;
  className?: string;
  disabled?: boolean;
  inherited?: boolean;
  id?: string;
  ariaLabel?: string;
  /** Placeholder shown when value is null (default "Mixed"). */
  placeholder?: string;
}

function round(v: number, digits: number) {
  const f = Math.pow(10, digits);
  return Math.round(v * f) / f;
}

export function NumberField({
  value,
  onCommit,
  min,
  max,
  step = 0.1,
  digits = 2,
  unit,
  label,
  className,
  disabled,
  inherited,
  id,
  ariaLabel,
  placeholder = 'Mixed',
}: NumberFieldProps) {
  const [text, setText] = useState('');
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const skipBlur = useRef(false);
  const shown = value === null ? '' : String(round(value, digits));
  useEffect(() => {
    if (!editing) setText(shown);
  }, [shown, editing]);

  const commit = (raw: string) => {
    const t = raw.trim();
    if (!t) return;
    let v = Number(t.replace(',', '.').replace(/\s*(mm|°|%)$/, ''));
    if (!Number.isFinite(v)) {
      setText(shown);
      return;
    }
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    v = round(v, Math.max(digits, 3));
    if (value === null || Math.abs(v - value) > 1e-9) onCommit(v);
    setText(String(round(v, digits)));
  };

  return (
    <label
      className={cn(
        'group relative flex h-7 min-w-0 items-center rounded-md border bg-transparent text-xs shadow-xs focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30',
        disabled && 'opacity-50',
        className,
      )}
    >
      {label && (
        <span className="pl-1.5 text-[10px] font-medium text-muted-foreground select-none">{label}</span>
      )}
      <input
        ref={ref}
        id={id}
        aria-label={ariaLabel ?? label}
        disabled={disabled}
        inputMode="decimal"
        className={cn(
          'h-full w-full min-w-0 bg-transparent px-1.5 text-right tabular-nums outline-none',
          inherited && 'text-muted-foreground',
        )}
        value={editing ? text : shown}
        placeholder={value === null ? placeholder : undefined}
        onFocus={(e) => {
          setEditing(true);
          setText(shown);
          requestAnimationFrame(() => e.target.select());
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (!skipBlur.current) commit(text);
          skipBlur.current = false;
          setEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            // onBlur commits (exactly once).
            (e.target as HTMLInputElement).blur();
          } else if (e.key === 'Escape') {
            skipBlur.current = true;
            setText(shown);
            setEditing(false);
            (e.target as HTMLInputElement).blur();
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const base = value ?? 0;
            const s = (e.shiftKey ? 10 : 1) * step * (e.key === 'ArrowUp' ? 1 : -1);
            let v = round(base + s, 4);
            if (min !== undefined) v = Math.max(min, v);
            if (max !== undefined) v = Math.min(max, v);
            onCommit(v);
            setText(String(round(v, digits)));
          }
          e.stopPropagation();
        }}
      />
      {unit && <span className="pr-1.5 text-[10px] text-muted-foreground select-none">{unit}</span>}
    </label>
  );
}
