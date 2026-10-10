// SPDX-License-Identifier: GPL-3.0-or-later
/** Palette swatches of the image import dialog: recolour, don't stitch, merge (SPEC FR-10.2, FR-10.3). */
import { ArrowRight, Merge, MoreHorizontal, Pipette, RotateCcw, Unlink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Switch } from '@/components/ui/switch';
import { Tip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { PaletteEdit } from '@/model/types';
import type { ResolvedPalette } from '@/raster/palette';
import { mergeInto, patchEdit, setStitched, unmerge, type SwatchView } from './paletteEdits';

const pct = (v: number) =>
  v >= 0.1 ? `${(v * 100).toFixed(0)}%` : v >= 0.001 ? `${(v * 100).toFixed(1)}%` : '<0.1%';

function Chip({ color, className, crossed }: { color: string; className?: string; crossed?: boolean }) {
  return (
    <span
      className={cn(
        'relative inline-block size-4 shrink-0 rounded-[4px] border border-black/15 dark:border-white/20',
        className,
      )}
      style={{ backgroundColor: color }}
      aria-hidden
    >
      {crossed && (
        <span className="absolute inset-0 m-auto h-px w-[140%] -translate-x-[15%] rotate-45 bg-foreground/70" />
      )}
    </span>
  );
}

export function PaletteSwatches({
  views,
  resolved,
  edits,
  backgroundIndex,
  onChange,
  disabled,
}: {
  views: SwatchView[];
  resolved: ResolvedPalette;
  edits: PaletteEdit[];
  backgroundIndex: number | null;
  onChange: (edits: PaletteEdit[]) => void;
  disabled?: boolean;
}) {
  const roots = views.filter((v) => !v.merged);
  return (
    <ul className="grid gap-0.5" aria-label="Colours">
      {views.map((v) => {
        const label = `Colour ${v.index + 1}`;
        if (v.merged) {
          const target = views[v.root];
          return (
            <li
              key={v.index}
              className="flex h-8 items-center gap-2 rounded-md px-1.5 text-xs text-muted-foreground"
            >
              <Chip color={v.original} className="opacity-60" />
              <span className="tabular-nums">{label}</span>
              <ArrowRight className="size-3" aria-hidden />
              <Chip color={target.color} crossed={!target.stitched} />
              <span className="min-w-0 flex-1 truncate">Colour {v.root + 1}</span>
              <Tip label="Unmerge">
                <Button
                  type="button"
                  variant="ghost"
                  size="iconSm"
                  disabled={disabled}
                  aria-label={`Unmerge ${label}`}
                  onClick={() => onChange(unmerge(edits, v.index))}
                >
                  <Unlink className="size-3.5" />
                </Button>
              </Tip>
            </li>
          );
        }
        const others = roots.filter((r) => r.index !== v.index);
        return (
          <li
            key={v.index}
            className={cn(
              'group flex h-8 items-center gap-2 rounded-md px-1.5 text-xs hover:bg-accent/50',
              !v.stitched && 'text-muted-foreground',
            )}
          >
            <Tip label="Recolour">
              <label className="relative inline-flex cursor-pointer rounded-[5px] focus-within:ring-2 focus-within:ring-ring/50">
                <Chip color={v.color} crossed={!v.stitched} className="size-5" />
                <input
                  type="color"
                  value={v.color}
                  disabled={disabled}
                  aria-label={`Recolour ${label}`}
                  className="absolute inset-0 size-full cursor-pointer opacity-0"
                  onChange={(e) =>
                    onChange(
                      patchEdit(edits, v.index, {
                        color:
                          e.target.value.toLowerCase() === v.original.toLowerCase() ? null : e.target.value,
                      }),
                    )
                  }
                />
              </label>
            </Tip>
            <span className="flex min-w-0 flex-1 flex-col leading-tight">
              <span className="flex items-center gap-1.5">
                <span className={cn('font-medium', !v.stitched && 'line-through decoration-foreground/40')}>
                  {label}
                </span>
                <span className="text-[11px] text-muted-foreground tabular-nums">{pct(v.share)}</span>
                {v.recoloured && <Pipette className="size-3 text-muted-foreground" aria-label="Recoloured" />}
              </span>
              {v.isBackground && (
                <span className="truncate text-[10.5px] text-muted-foreground">
                  background · {v.stitched ? 'stitched' : 'not stitched'}
                </span>
              )}
            </span>
            <Tip
              label={v.stitched ? 'Stitched — click to leave unstitched' : 'Not stitched — click to stitch'}
            >
              <span className="inline-flex">
                <Switch
                  checked={v.stitched}
                  disabled={disabled}
                  aria-label={`Stitch ${label}`}
                  onCheckedChange={(c) => onChange(setStitched(edits, v.index, c, backgroundIndex))}
                />
              </span>
            </Tip>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="iconSm"
                  disabled={disabled}
                  aria-label={`More options for ${label}`}
                >
                  <MoreHorizontal className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel className="flex items-center gap-1.5">
                  <Merge className="size-3.5" aria-hidden /> Merge into
                </DropdownMenuLabel>
                {others.length === 0 && <DropdownMenuItem disabled>No other colours</DropdownMenuItem>}
                {others.map((o) => (
                  <DropdownMenuItem
                    key={o.index}
                    onSelect={() => onChange(mergeInto(edits, v.index, o.index, resolved))}
                  >
                    <Chip color={o.color} crossed={!o.stitched} />
                    Colour {o.index + 1}
                    <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">
                      {pct(o.share)}
                    </span>
                  </DropdownMenuItem>
                ))}
                {v.recoloured && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => onChange(patchEdit(edits, v.index, { color: null }))}>
                      <RotateCcw /> Reset colour
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </li>
        );
      })}
    </ul>
  );
}
