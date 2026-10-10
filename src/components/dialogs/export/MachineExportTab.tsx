// SPDX-License-Identifier: GPL-3.0-or-later
/** Machine format picker, and the DST / JEF / EXP / VP3 export panel (SPEC §3.3, P2). */
import { useId, useMemo } from 'react';
import { ArrowRight, Info } from 'lucide-react';
import type { Diagnostic, StitchPlan } from '@/engine/types';
import { buildFormatPattern } from '@/io/formats/encoder';
import { DST_LABEL_CHARS, dstLabel } from '@/io/formats/dst';
import { JEF_HOOPS, JEF_SETTINGS, jefDesignSize, jefHoopFor } from '@/io/formats/jef';
import { resolveChart } from '@/io/export/pesFormat';
import type { Design } from '@/model/types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn, fmt } from '@/lib/utils';
import { DELTA_E_HINT } from './colorMapping';
import {
  MACHINE_FORMATS,
  isMachineFormat,
  jefColorMapping,
  machineFormatInfo,
  type MachineChoice,
} from './machineFormats';
import { DesignStats, DiagnosticList, SectionTitle, Swatch } from './parts';
import { PlanCanvas } from './PlanCanvas';

export function MachineFormatPicker({
  value,
  onChange,
}: {
  value: MachineChoice;
  onChange: (v: MachineChoice) => void;
}) {
  const id = useId();
  const info = machineFormatInfo(value);
  return (
    <div className="grid gap-1.5">
      <SectionTitle id={id}>Machine format</SectionTitle>
      <div className="grid items-start gap-x-3 gap-y-1.5 sm:grid-cols-[16rem_1fr]">
        <Select value={value} onValueChange={(v) => isMachineFormat(v) && onChange(v)}>
          <SelectTrigger size="sm" aria-labelledby={id} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MACHINE_FORMATS.map((f) => (
              <SelectItem key={f.id} value={f.id}>
                {f.title}
                {f.id === 'pes' && <span className="text-muted-foreground"> (default)</span>}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground sm:pt-1.5">{info.machines}</p>
      </div>
    </div>
  );
}

export function MachineExportTab({
  format,
  plan,
  design,
  diagnostics,
  fabricColor,
}: {
  format: Exclude<MachineChoice, 'pes'>;
  plan: StitchPlan;
  design: Design;
  diagnostics: Diagnostic[];
  fabricColor: string;
}) {
  const info = machineFormatInfo(format);
  const jefHoop = useMemo(() => {
    if (format !== 'jef') return null;
    const { width, height } = jefDesignSize(buildFormatPattern(plan, design, JEF_SETTINGS));
    const hoop = jefHoopFor(width, height);
    return hoop.fits ? (JEF_HOOPS.find((h) => h.code === hoop.code)?.label ?? '') : 'None fits';
  }, [format, plan, design]);
  const extra: [string, string][] = [];
  if (jefHoop) extra.push(['Janome hoop', jefHoop]);

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
          <DesignStats plan={plan} extra={extra} />
        </div>

        <div className="grid min-w-0 content-start gap-4">
          <p className="flex gap-1.5 rounded-md bg-muted px-2.5 py-2 text-xs text-muted-foreground">
            <Info className="mt-px size-3.5 shrink-0" aria-hidden />
            <span>{info.colors}</span>
          </p>
          {format === 'dst' && <DstLabel name={design.name} />}
          {format === 'jef' ? (
            <JefColorList plan={plan} design={design} />
          ) : format === 'vp3' ? (
            <BlockList plan={plan} design={design} title="Threads in the file" withBrand />
          ) : (
            <BlockList plan={plan} design={design} title="Thread order (set at the machine)" />
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

function DstLabel({ name }: { name: string }) {
  const label = dstLabel(name);
  return (
    <div className="grid gap-1.5">
      <SectionTitle>Machine label</SectionTitle>
      <div className="flex items-center gap-2">
        <code className="rounded-md border bg-muted px-2 py-1 font-mono text-sm tracking-wider">{label}</code>
        <span className="text-xs text-muted-foreground">
          from the design name, up to {DST_LABEL_CHARS} characters
        </span>
      </div>
    </div>
  );
}

/** Colour blocks in sewing order (DST / EXP: for the operator; VP3: what the file stores). */
function BlockList({
  plan,
  design,
  title,
  withBrand = false,
}: {
  plan: StitchPlan;
  design: Design;
  title: string;
  withBrand?: boolean;
}) {
  const titleId = useId();
  if (!plan.colorBlocks.length) return null;
  return (
    <div className="grid gap-1.5">
      <SectionTitle id={titleId}>{title}</SectionTitle>
      <ol
        aria-labelledby={titleId}
        className="grid max-h-52 gap-px overflow-y-auto rounded-md border bg-border"
      >
        {plan.colorBlocks.map((b, i) => {
          const t = design.threads[b.threadId];
          const stop = i > 0 && plan.colorBlocks[i - 1].threadId === b.threadId;
          const brand = withBrand && t?.chart ? (resolveChart(t.chart)?.brand ?? t.chart) : undefined;
          return (
            <li key={i} className="flex items-center gap-2 bg-background px-2 py-1 text-xs">
              <span className="w-5 text-muted-foreground tabular-nums">{i + 1}</span>
              <Swatch color={b.color} />
              <span className="min-w-0 flex-1 truncate">{t?.name ?? b.color.toUpperCase()}</span>
              {stop && <span className="rounded bg-muted px-1 text-[10px] text-muted-foreground">stop</span>}
              {brand && <span className="truncate text-muted-foreground">{brand}</span>}
              {t?.code && <span className="text-muted-foreground tabular-nums">{t.code}</span>}
              <span className="font-mono text-[10px] text-muted-foreground uppercase">{b.color}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** JEF: design colour → Janome palette colour the machine will display. */
function JefColorList({ plan, design }: { plan: StitchPlan; design: Design }) {
  const rows = useMemo(() => jefColorMapping(plan, design), [plan, design]);
  const titleId = useId();
  if (!rows.length) return null;
  return (
    <div className="grid gap-1.5">
      <SectionTitle id={titleId}>Machine will display</SectionTitle>
      <ol
        aria-labelledby={titleId}
        className="grid max-h-52 gap-px overflow-y-auto rounded-md border bg-border"
      >
        {rows.map((r) => {
          const far = r.deltaE > DELTA_E_HINT;
          const designLabel =
            [r.threadName, r.threadCode].filter(Boolean).join(' · ') || r.designColor.toUpperCase();
          return (
            <li
              key={r.entry}
              className="grid grid-cols-[1.25rem_minmax(0,1fr)_auto_minmax(0,1fr)_auto] items-center gap-2 bg-background px-2 py-1 text-xs"
            >
              <span className="text-muted-foreground tabular-nums">{r.entry + 1}</span>
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
                {r.jef ? (
                  <>
                    <Swatch color={r.jef.color} />
                    <span className="truncate" title={`${r.jef.name} (Janome ${r.jef.code})`}>
                      {r.jef.name} <span className="text-muted-foreground">{r.jef.code}</span>
                    </span>
                  </>
                ) : (
                  <span className="text-muted-foreground">Stop</span>
                )}
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
                {r.jef ? `ΔE ${fmt(r.deltaE, 0)}` : ''}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
