// SPDX-License-Identifier: GPL-3.0-or-later
/** One project in the home-screen library grid: thumbnail, name, edited date, size and stitch count. */
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Copy, Download, Ellipsis, FolderOpen, ImageOff, LoaderCircle, Pencil, Trash } from 'lucide-react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { DesignMeta } from '@/library/library';
import { cn } from '@/lib/utils';
import { absoluteTime, formatSize, formatStitches, relativeTime } from './format';

export interface DesignCardActions {
  onOpen: () => void;
  onRename: () => void;
  onDuplicate: () => void;
  onDownload: () => void;
  onDelete: () => void;
}

/** Shows a Blob as an <img>; the object URL is created in an effect and revoked on change/unmount. */
function BlobImage({ blob, className, onError }: { blob: Blob; className?: string; onError: () => void }) {
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const url = URL.createObjectURL(blob);
    if (ref.current) ref.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [blob]);
  return <img ref={ref} alt="" draggable={false} decoding="async" className={className} onError={onError} />;
}

interface MenuItem {
  key: string;
  label: string;
  icon: ReactNode;
  run: () => void;
  destructive?: boolean;
  separatorBefore?: boolean;
}

export function DesignCard({
  meta,
  now,
  opening,
  ...actions
}: { meta: DesignMeta; now: number; opening: boolean } & DesignCardActions) {
  const [broken, setBroken] = useState(false);
  const size = formatSize(meta.widthMm, meta.heightMm);
  const stitches = formatStitches(meta.stitches);
  const details = [size, stitches].filter(Boolean).join(' · ');

  const items: MenuItem[] = [
    { key: 'open', label: 'Open', icon: <FolderOpen />, run: actions.onOpen },
    { key: 'rename', label: 'Rename…', icon: <Pencil />, run: actions.onRename },
    { key: 'duplicate', label: 'Duplicate', icon: <Copy />, run: actions.onDuplicate },
    { key: 'download', label: 'Download project file', icon: <Download />, run: actions.onDownload },
    {
      key: 'delete',
      label: 'Delete…',
      icon: <Trash />,
      run: actions.onDelete,
      destructive: true,
      separatorBefore: true,
    },
  ];

  function onKeyDown(e: KeyboardEvent) {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'F2') {
      e.preventDefault();
      actions.onRename();
    } else if (e.key === 'Delete' || (e.key === 'Backspace' && (e.metaKey || e.ctrlKey))) {
      e.preventDefault();
      actions.onDelete();
    }
  }

  return (
    <li className="group relative">
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button
            type="button"
            onClick={actions.onOpen}
            onKeyDown={onKeyDown}
            disabled={opening}
            aria-keyshortcuts="F2 Delete"
            className={cn(
              'flex h-full w-full flex-col overflow-hidden rounded-lg border bg-card text-left text-card-foreground transition-[border-color,box-shadow]',
              'hover:border-primary/40 hover:shadow-md focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
              'disabled:cursor-progress',
            )}
          >
            <div className="relative grid aspect-[4/3] w-full shrink-0 place-items-center overflow-hidden bg-canvas">
              {meta.thumbnail && !broken ? (
                <BlobImage
                  blob={meta.thumbnail}
                  onError={() => setBroken(true)}
                  className="absolute inset-0 size-full object-contain p-3"
                />
              ) : (
                <ImageOff className="size-8 text-muted-foreground/50" aria-hidden />
              )}
              {opening && (
                <div className="absolute inset-0 grid place-items-center bg-background/60">
                  <LoaderCircle className="size-6 animate-spin text-primary" aria-label="Opening" />
                </div>
              )}
            </div>
            <div className="grid gap-0.5 border-t px-2.5 py-2">
              <span className="truncate text-sm font-medium" title={meta.name}>
                {meta.name || 'Untitled'}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                Edited{' '}
                <time dateTime={new Date(meta.updatedAt).toISOString()} title={absoluteTime(meta.updatedAt)}>
                  {relativeTime(meta.updatedAt, now)}
                </time>
              </span>
              <span className="truncate text-[11px] text-muted-foreground tabular-nums">
                {details || ' '}
              </span>
            </div>
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          {items.map((it) => [
            it.separatorBefore && <ContextMenuSeparator key={`${it.key}-sep`} />,
            <ContextMenuItem
              key={it.key}
              onSelect={it.run}
              className={cn(
                "[&_svg:not([class*='size-'])]:size-4",
                it.destructive && 'text-destructive focus:bg-destructive/10',
              )}
            >
              {it.icon}
              {it.label}
            </ContextMenuItem>,
          ])}
        </ContextMenuContent>
      </ContextMenu>

      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Actions for ${meta.name || 'Untitled'}`}
            className={cn(
              'absolute top-1.5 right-1.5 grid size-7 place-items-center rounded-md border bg-background/90 text-muted-foreground shadow-xs backdrop-blur-sm transition-opacity',
              'hover:bg-accent hover:text-accent-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
              'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100',
            )}
          >
            <Ellipsis className="size-4" aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {items.map((it) => [
            it.separatorBefore && <DropdownMenuSeparator key={`${it.key}-sep`} />,
            <DropdownMenuItem
              key={it.key}
              onSelect={it.run}
              variant={it.destructive ? 'destructive' : undefined}
            >
              {it.icon}
              {it.label}
            </DropdownMenuItem>,
          ])}
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}
