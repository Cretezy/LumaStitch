// SPDX-License-Identifier: GPL-3.0-or-later
/** PNG preview and SVG geometry export panels (SPEC FR-6.5). */
import { useId, useMemo } from 'react';
import type { StitchPlan } from '@/engine/types';
import { PNG_MAX_SIDE, pngSize } from '@/io/export/png';
import type { Design } from '@/model/types';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn, fmtInt } from '@/lib/utils';
import { WATERMARK_TEXT, watermarkStrip } from '@/io/export/watermark';
import { PlanCanvas } from './PlanCanvas';
import { SectionTitle, Swatch, WatermarkField } from './parts';

export type PngMode = 'flat' | 'realistic';
export type PngBackground = 'transparent' | 'fabric';

const CHECKER =
  'bg-[length:16px_16px] bg-[image:conic-gradient(#e5e5e5_25%,#ffffff_0_50%,#e5e5e5_0_75%,#ffffff_0)] dark:bg-[image:conic-gradient(#3a3a3a_25%,#2a2a2a_0_50%,#3a3a3a_0_75%,#2a2a2a_0)]';

export function PngExportTab({
  plan,
  design,
  mode,
  onMode,
  background,
  onBackground,
  fabricColor,
  watermark,
  onWatermark,
}: {
  plan: StitchPlan;
  design: Design;
  watermark: boolean;
  onWatermark: (v: boolean) => void;
  mode: PngMode;
  onMode: (m: PngMode) => void;
  background: PngBackground;
  onBackground: (b: PngBackground) => void;
  fabricColor: string;
}) {
  const modeId = useId();
  const bgId = useId();
  const size = pngSize(plan, PNG_MAX_SIDE);
  if (watermark) size.height += watermarkStrip(Math.max(size.width, size.height));
  return (
    <div className="grid gap-4 sm:grid-cols-[1fr_13rem]">
      <PlanCanvas
        plan={plan}
        mode={mode}
        background={background === 'fabric' ? fabricColor : undefined}
        className={cn('h-64 rounded-md border', background === 'transparent' && CHECKER)}
        label={`PNG preview of ${design.name}`}
        watermark={watermark ? WATERMARK_TEXT : undefined}
      />
      <div className="grid content-start gap-4">
        <div className="grid gap-1.5">
          <SectionTitle id={modeId}>Rendering</SectionTitle>
          <ToggleGroup
            type="single"
            value={mode}
            onValueChange={(v) => v && onMode(v as PngMode)}
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
            value={background}
            onValueChange={(v) => v && onBackground(v as PngBackground)}
            aria-labelledby={bgId}
            className="w-full"
          >
            <ToggleGroupItem value="transparent" className="flex-1">
              Transparent
            </ToggleGroupItem>
            <ToggleGroupItem value="fabric" className="flex-1">
              <Swatch color={fabricColor} className="size-3" />
              Fabric
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        <WatermarkField value={watermark} onChange={onWatermark} />
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground tabular-nums">
            {fmtInt(size.width)} × {fmtInt(size.height)} px
          </span>{' '}
          PNG, longest side {fmtInt(PNG_MAX_SIDE)} px.
        </p>
      </div>
    </div>
  );
}

/** Parses width/height (mm) and path count from an exported SVG string. */
function svgInfo(svg: string): { w: string; h: string; paths: number } {
  const root = /<svg [^>]*>/.exec(svg)?.[0] ?? '';
  return {
    w: /\swidth="([\d.]+)mm"/.exec(root)?.[1] ?? '0',
    h: /\sheight="([\d.]+)mm"/.exec(root)?.[1] ?? '0',
    paths: (svg.match(/<path /g) ?? []).length,
  };
}

export function SvgExportTab({ design, svg }: { design: Design; svg: string }) {
  const info = svgInfo(svg);
  const src = useMemo(() => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, [svg]);
  return (
    <div className="grid gap-4 sm:grid-cols-[1fr_13rem]">
      <div
        className={cn('flex h-64 items-center justify-center overflow-hidden rounded-md border p-3', CHECKER)}
      >
        <img src={src} alt={`Geometry of ${design.name}`} className="max-h-full max-w-full object-contain" />
      </div>
      <div className="grid content-start gap-3 text-xs text-muted-foreground">
        <p>
          The edited shapes as vector paths, sized in millimetres. Fills and outlines use their thread
          colours; hidden shapes are left out. Stitches are not included.
        </p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt>Shapes</dt>
          <dd className="text-right font-medium text-foreground tabular-nums">{fmtInt(info.paths)}</dd>
          <dt>Page size</dt>
          <dd className="text-right font-medium text-foreground tabular-nums">
            {info.w} × {info.h} mm
          </dd>
        </dl>
      </div>
    </div>
  );
}
