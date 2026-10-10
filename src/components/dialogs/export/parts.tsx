// SPDX-License-Identifier: GPL-3.0-or-later
/** Small building blocks shared by the export dialog and the PES viewer. */
import type { ReactNode } from 'react';
import { CircleCheck, CircleX, Info, TriangleAlert } from 'lucide-react';
import type { Diagnostic, StitchPlan } from '@/engine/types';
import { Checkbox } from '@/components/ui/checkbox';
import { cn, fmt, fmtInt, fmtTime } from '@/lib/utils';

export function Swatch({ color, className, title }: { color: string; className?: string; title?: string }) {
  return (
    <span
      className={cn(
        'inline-block size-4 shrink-0 rounded-[3px] border border-black/15 shadow-xs dark:border-white/20',
        className,
      )}
      style={{ background: color }}
      title={title}
      aria-hidden
    />
  );
}

export function SectionTitle({
  children,
  className,
  id,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <h3
      id={id}
      className={cn('text-[11px] font-semibold tracking-wide text-muted-foreground uppercase', className)}
    >
      {children}
    </h3>
  );
}

/** Number of distinct threads used by the plan. */
export function colorCount(plan: StitchPlan): number {
  return new Set(plan.colorBlocks.map((b) => b.threadId)).size;
}

export function designSizeMm(plan: StitchPlan): { w: number; h: number } {
  const b = plan.bounds;
  return { w: Math.max(0, b.maxX - b.minX), h: Math.max(0, b.maxY - b.minY) };
}

/** Design stats (SPEC FR-3.4) as a compact definition list. */
export function DesignStats({
  plan,
  extra,
  className,
}: {
  plan: StitchPlan;
  extra?: [string, ReactNode][];
  className?: string;
}) {
  const s = plan.stats;
  const { w, h } = designSizeMm(plan);
  const rows: [string, ReactNode][] = [
    ['Stitches', fmtInt(s.stitches)],
    ['Colours', fmtInt(colorCount(plan))],
    ['Colour changes', fmtInt(s.colorChanges)],
    ['Stops', fmtInt(s.stops)],
    ['Trims', fmtInt(s.trims)],
    ['Size', `${fmt(w)} × ${fmt(h)} mm`],
    ['Est. time', fmtTime(s.estSeconds)],
    ...(extra ?? []),
  ];
  return (
    <dl className={cn('grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs', className)}>
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="text-right font-medium tabular-nums">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

const SEVERITY_ICON = { error: CircleX, warning: TriangleAlert, info: Info } as const;

/** Validation results. Errors first; an empty list shows a reassuring line. */
export function DiagnosticList({
  diagnostics,
  className,
}: {
  diagnostics: readonly Diagnostic[];
  className?: string;
}) {
  if (diagnostics.length === 0) {
    return (
      <p className={cn('flex items-center gap-1.5 text-xs text-muted-foreground', className)}>
        <CircleCheck className="size-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden />
        Ready to export: no problems found.
      </p>
    );
  }
  const order = { error: 0, warning: 1, info: 2 } as const;
  const sorted = [...diagnostics].sort((a, b) => order[a.severity] - order[b.severity]);
  return (
    <ul className={cn('grid gap-1', className)} aria-label="Export checks">
      {sorted.map((d, i) => {
        const Icon = SEVERITY_ICON[d.severity];
        return (
          <li
            key={`${d.code}-${i}`}
            className={cn(
              'flex gap-2 rounded-md px-2.5 py-1.5 text-xs',
              d.severity === 'error' && 'bg-destructive/10 text-destructive',
              d.severity === 'warning' && 'bg-warning/15 text-foreground',
              d.severity === 'info' && 'bg-muted text-muted-foreground',
            )}
          >
            <Icon
              className={cn(
                'mt-px size-3.5 shrink-0',
                d.severity === 'warning' && 'text-amber-600 dark:text-amber-400',
              )}
              aria-hidden
            />
            <span>
              <span className="sr-only">
                {d.severity === 'error' ? 'Error: ' : d.severity === 'warning' ? 'Warning: ' : ''}
              </span>
              {d.message}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Inline error box. */
export function ErrorBox({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div
      role="alert"
      className="flex gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
    >
      <CircleX className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="grid gap-0.5">
        <p className="font-medium">{title}</p>
        {children && <div className="text-xs opacity-90">{children}</div>}
      </div>
    </div>
  );
}

/** On/off switch for the LumaStitch watermark on PNG and video exports. */
export function WatermarkField({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <Checkbox checked={value} onCheckedChange={(c) => onChange(!!c)} />
      LumaStitch watermark
    </label>
  );
}
