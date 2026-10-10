// SPDX-License-Identifier: GPL-3.0-or-later
/** Production worksheet (PDF) panel: what the printable sheet contains, and its preview background. */
import { useId, useMemo } from 'react';
import type { StitchPlan } from '@/engine/types';
import { worksheetData, worksheetPageCount } from '@/io/export/pdf';
import type { Design } from '@/model/types';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { fmtInt } from '@/lib/utils';
import { PlanCanvas } from './PlanCanvas';
import { SectionTitle, Swatch } from './parts';

export type PdfBackground = 'white' | 'fabric';

export function PdfExportTab({
  plan,
  design,
  background,
  onBackground,
  fabricColor,
}: {
  plan: StitchPlan;
  design: Design;
  background: PdfBackground;
  onBackground: (b: PdfBackground) => void;
  fabricColor: string;
}) {
  const bgId = useId();
  const data = useMemo(() => worksheetData(plan, design), [plan, design]);
  const pages = worksheetPageCount(data);
  const stops = data.rows.filter((r) => r.stop).length;
  return (
    <div className="grid gap-4 sm:grid-cols-[1fr_13rem]">
      <PlanCanvas
        plan={plan}
        mode="realistic"
        background={background === 'fabric' ? fabricColor : '#ffffff'}
        className="h-64 rounded-md border"
        label={`Worksheet preview image of ${design.name}`}
      />
      <div className="grid content-start gap-4">
        <div className="grid gap-1.5">
          <SectionTitle id={bgId}>Preview background</SectionTitle>
          <ToggleGroup
            type="single"
            value={background}
            onValueChange={(v) => v && onBackground(v as PdfBackground)}
            aria-labelledby={bgId}
            className="w-full"
          >
            <ToggleGroupItem value="white" className="flex-1">
              White
            </ToggleGroupItem>
            <ToggleGroupItem value="fabric" className="flex-1">
              <Swatch color={fabricColor} className="size-3" />
              Fabric
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        <div className="grid gap-1.5 text-xs text-muted-foreground">
          <p>
            A printable A4 sheet for the machine operator: size, stitch counts, estimated time, fabric and
            stabiliser, a stitch preview and the colour sequence with stitch counts and stops.
          </p>
          <p>
            <span className="font-medium text-foreground tabular-nums">
              {fmtInt(data.rows.length)} colour step{data.rows.length === 1 ? '' : 's'}
            </span>
            {stops > 0 && (
              <>
                , <span className="font-medium text-foreground tabular-nums">{fmtInt(stops)}</span> stop
                {stops === 1 ? '' : 's'}
              </>
            )}{' '}
            on{' '}
            <span className="font-medium text-foreground tabular-nums">
              {pages} page{pages === 1 ? '' : 's'}
            </span>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
