// SPDX-License-Identifier: GPL-3.0-or-later
/** PES export options (SPEC FR-6.1–6.4): machine label, version, colour preview, stats, checks. */
import { useId, useMemo } from 'react';
import { ArrowRight, Info } from 'lucide-react';
import type { Diagnostic, StitchPlan } from '@/engine/types';
import { pesLabelFor } from '@/io/pes';
import type { Design } from '@/model/types';
import { cn, fmt } from '@/lib/utils';
import { DELTA_E_HINT, pecColorMapping } from './colorMapping';
import { DesignStats, DiagnosticList, SectionTitle, Swatch } from './parts';
import { PlanCanvas } from './PlanCanvas';

export type PesVersion = 1 | 6;

const VERSIONS: { v: PesVersion; title: string; hint: string }[] = [
  {
    v: 1,
    title: 'PES v1 — widest compatibility (default)',
    hint: 'Colours are mapped to Brother’s 64-colour palette. Reads on every Brother and Baby Lock machine.',
  },
  {
    v: 6,
    title: 'PES v6 — exact thread colours and brands',
    hint: 'Stores exact RGB, thread names and codes for PE-Design and newer machines.',
  },
];

/** Reliable label length on Brother machine screens. */
const LABEL_CHARS = 8;

export function PesExportTab({
  plan,
  design,
  version,
  onVersion,
  diagnostics,
  fabricColor,
}: {
  plan: StitchPlan;
  design: Design;
  version: PesVersion;
  onVersion: (v: PesVersion) => void;
  diagnostics: Diagnostic[];
  fabricColor: string;
}) {
  const group = useId();
  const label = pesLabelFor(design.name);
  const nameTooLong = design.name.trim().length > LABEL_CHARS;

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-[12.5rem_1fr]">
        <div className="grid content-start gap-3">
          <PlanCanvas
            plan={plan}
            background={fabricColor}
            mode="realistic"
            padding={10}
            className="aspect-square w-full rounded-md border"
            label={`Stitch preview of ${design.name}`}
          />
          <DesignStats plan={plan} />
        </div>

        <div className="grid min-w-0 content-start gap-4">
          <div className="grid gap-1.5">
            <SectionTitle>Machine label</SectionTitle>
            <div className="flex items-center gap-2">
              <code className="rounded-md border bg-muted px-2 py-1 font-mono text-sm tracking-wider">
                {label}
              </code>
              <span className="text-xs text-muted-foreground">from the design name</span>
            </div>
            {nameTooLong && (
              <p className="flex gap-1.5 text-xs text-muted-foreground">
                <Info className="mt-px size-3.5 shrink-0" aria-hidden />
                <span>
                  Brother machines show {LABEL_CHARS} characters reliably, so “{design.name.trim()}” is stored
                  as “{label}”. Rename the design to choose the label.
                </span>
              </p>
            )}
          </div>

          <fieldset className="grid gap-1.5">
            <legend className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              PES version
            </legend>
            {VERSIONS.map(({ v, title, hint }) => {
              const checked = version === v;
              return (
                <label
                  key={v}
                  className={cn(
                    'flex cursor-pointer gap-2.5 rounded-md border px-2.5 py-2 transition-colors hover:bg-accent/60',
                    'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50',
                    checked && 'border-primary bg-accent',
                  )}
                >
                  <input
                    type="radio"
                    name={group}
                    value={v}
                    checked={checked}
                    onChange={() => onVersion(v)}
                    className="peer sr-only"
                  />
                  <span
                    aria-hidden
                    className={cn(
                      'mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded-full border',
                      checked ? 'border-primary' : 'border-muted-foreground/50',
                    )}
                  >
                    {checked && <span className="size-1.5 rounded-full bg-primary" />}
                  </span>
                  <span className="grid gap-0.5">
                    <span className="text-sm leading-tight font-medium">{title}</span>
                    <span className="text-xs text-muted-foreground">{hint}</span>
                  </span>
                </label>
              );
            })}
          </fieldset>

          {version === 1 ? (
            <PecColorList plan={plan} design={design} />
          ) : (
            <ThreadList plan={plan} design={design} />
          )}
        </div>
      </div>

      <div className="grid gap-1.5">
        <SectionTitle>Checks</SectionTitle>
        <DiagnosticList diagnostics={diagnostics} />
      </div>
    </div>
  );
}

/** v1: design colour → PEC colour the machine will display, per colour slot. */
function PecColorList({ plan, design }: { plan: StitchPlan; design: Design }) {
  const rows = useMemo(() => pecColorMapping(plan, design), [plan, design]);
  const titleId = useId();
  if (!rows.length) return null;
  return (
    <div className="grid gap-1.5">
      <SectionTitle id={titleId}>Machine will display</SectionTitle>
      <ol
        aria-labelledby={titleId}
        className="grid max-h-44 gap-px overflow-y-auto rounded-md border bg-border"
      >
        {rows.map((r) => {
          const far = r.deltaE > DELTA_E_HINT;
          const designLabel =
            [r.threadName, r.threadCode].filter(Boolean).join(' · ') || r.designColor.toUpperCase();
          return (
            <li
              key={r.slot}
              className="grid grid-cols-[1.25rem_minmax(0,1fr)_auto_minmax(0,1fr)_auto] items-center gap-2 bg-background px-2 py-1 text-xs"
            >
              <span className="text-muted-foreground tabular-nums">{r.slot + 1}</span>
              <span className="flex min-w-0 items-center gap-1.5">
                <Swatch color={r.designColor} />
                <span className="truncate" title={designLabel}>
                  {designLabel}
                </span>
                {r.stop && (
                  <span className="rounded bg-muted px-1 text-[10px] text-muted-foreground">stop</span>
                )}
              </span>
              <ArrowRight className="size-3 text-muted-foreground" aria-label="shows as" />
              <span className="flex min-w-0 items-center gap-1.5">
                <Swatch color={r.pec?.color ?? '#000000'} />
                <span className="truncate" title={r.pec ? `${r.pec.name} (PEC ${r.pec.index})` : 'Unknown'}>
                  {r.pec ? r.pec.name : 'Unknown'}{' '}
                  <span className="text-muted-foreground">#{r.pecIndex}</span>
                </span>
              </span>
              <span
                className={cn(
                  'rounded px-1 text-[10px] tabular-nums',
                  far ? 'bg-warning/20 text-foreground' : 'text-muted-foreground',
                )}
                title={
                  far
                    ? 'Noticeably different on the machine screen (ΔE2000 > 10). The stitched colour is your real thread.'
                    : 'Colour difference (ΔE2000)'
                }
              >
                ΔE {fmt(r.deltaE, 0)}
              </span>
            </li>
          );
        })}
      </ol>
      {rows.some((r) => r.deltaE > DELTA_E_HINT) && (
        <p className="text-[11px] text-muted-foreground">
          Highlighted colours look different on the machine screen. Only the on-screen preview changes; sew
          with your own threads.
        </p>
      )}
    </div>
  );
}

/** v6: the exact threads written to the file, in sewing order. */
function ThreadList({ plan, design }: { plan: StitchPlan; design: Design }) {
  const titleId = useId();
  return (
    <div className="grid gap-1.5">
      <SectionTitle id={titleId}>Threads in the file</SectionTitle>
      <ol
        aria-labelledby={titleId}
        className="grid max-h-44 gap-px overflow-y-auto rounded-md border bg-border"
      >
        {plan.colorBlocks.map((b, i) => {
          const t = design.threads[b.threadId];
          const stop = i > 0 && plan.colorBlocks[i - 1].threadId === b.threadId;
          return (
            <li key={i} className="flex items-center gap-2 bg-background px-2 py-1 text-xs">
              <span className="w-5 text-muted-foreground tabular-nums">{i + 1}</span>
              <Swatch color={b.color} />
              <span className="min-w-0 flex-1 truncate">{t?.name ?? b.color.toUpperCase()}</span>
              {stop && <span className="rounded bg-muted px-1 text-[10px] text-muted-foreground">stop</span>}
              {t?.code && <span className="text-muted-foreground tabular-nums">{t.code}</span>}
              <span className="font-mono text-[10px] text-muted-foreground uppercase">{b.color}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
