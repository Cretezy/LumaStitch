// SPDX-License-Identifier: GPL-3.0-or-later
/** Preview panes of the image import dialog: the original image and the live traced result. */
import { useEffect, useMemo, useRef, type CSSProperties, type ReactNode } from 'react';
import { LoaderCircle } from 'lucide-react';
import { geomToD } from '@/canvas/pathD';
import { cn } from '@/lib/utils';
import type { ResolvedPalette } from '@/raster/palette';
import type { QuantizeResult, TracedShapes } from '@/raster/types';
import { recolourPreview } from './paletteEdits';

export const CHECKERBOARD: CSSProperties = {
  backgroundColor: 'var(--background)',
  backgroundImage:
    'linear-gradient(45deg, var(--muted) 25%, transparent 25%), linear-gradient(-45deg, var(--muted) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, var(--muted) 75%), linear-gradient(-45deg, transparent 75%, var(--muted) 75%)',
  backgroundSize: '16px 16px',
  backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0',
};

/** A framed box that fits content of the given aspect ratio (width / height). */
export function PreviewFrame({
  aspect,
  children,
  busy,
  className,
  label,
}: {
  aspect: number;
  children?: ReactNode;
  busy?: boolean;
  className?: string;
  label: string;
}) {
  const a = aspect > 0 && Number.isFinite(aspect) ? aspect : 1;
  return (
    <div
      role="img"
      aria-label={label}
      aria-busy={busy || undefined}
      className={cn(
        'relative flex h-[300px] items-center justify-center overflow-hidden rounded-md border lg:h-[380px]',
        className,
      )}
      style={{ ...CHECKERBOARD, containerType: 'size' }}
    >
      {/* Largest box of aspect `a` that fits the frame (container query units). */}
      <div className="relative" style={{ aspectRatio: String(a), width: `min(100cqw, ${a} * 100cqh)` }}>
        {children}
      </div>
      {busy && (
        <span className="absolute top-2 right-2 inline-flex items-center gap-1 rounded bg-background/85 px-1.5 py-0.5 text-[11px] text-muted-foreground shadow-xs">
          <LoaderCircle className="size-3 animate-spin" aria-hidden />
          Updating
        </span>
      )}
    </div>
  );
}

/** The quantised label map with palette edits applied (skipped colours transparent). */
export function LabelCanvas({ quant, resolved }: { quant: QuantizeResult; resolved: ResolvedPalette }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { width, height, rgba } = quant.labelPreview;
  const pixels = useMemo(
    () => recolourPreview(rgba, quant.palette, resolved),
    [rgba, quant.palette, resolved],
  );
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx || !width || !height) return;
    ctx.putImageData(new ImageData(pixels, width, height), 0, 0);
  }, [pixels, width, height]);
  return <canvas ref={ref} width={width} height={height} className="absolute inset-0 size-full" />;
}

/** Traced shapes as SVG (mm, centred on the origin): fills as cutouts, line art as strokes. */
export function TracedSvg({ traced, className }: { traced: TracedShapes; className?: string }) {
  const w = traced.widthMm || 1;
  const h = traced.heightMm || 1;
  return (
    <svg
      viewBox={`${-w / 2} ${-h / 2} ${w} ${h}`}
      className={cn('absolute inset-0 size-full', className)}
      aria-hidden
    >
      {traced.shapes.map((s, i) =>
        s.lineArt ? (
          <path
            key={i}
            d={geomToD(s.geom)}
            fill="none"
            stroke={s.color}
            strokeWidth={Math.max(0.15, s.strokeWidth ?? 0.4)}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : (
          <path key={i} d={geomToD(s.geom)} fill={s.color} fillRule={s.geom.fillRule} />
        ),
      )}
    </svg>
  );
}
