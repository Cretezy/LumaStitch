// SPDX-License-Identifier: GPL-3.0-or-later
/** About LumaStitch: version, licence, privacy and third-party credits. */
import { ChevronRight, ExternalLink, ShieldCheck } from 'lucide-react';
import type { DialogProps } from '@/components/DialogHost';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { LogoMark } from '@/components/home/LogoMark';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

const REPO_URL = 'https://github.com/Cretezy/LumaStitch';

const APP_VERSION: string = import.meta.env.VITE_APP_VERSION ?? '0.1.0';

const CREDITS: { name: string; licence: string; use: string }[] = [
  { name: 'Ink/Stitch', licence: 'GPL-3.0', use: 'Thread palettes and stitch algorithm references' },
  { name: 'pyembroidery', licence: 'MIT', use: 'PES file format reference' },
  { name: 'Potrace', licence: 'GPL-2.0-or-later', use: 'Image tracing, via esm-potrace-wasm' },
  { name: 'Paper.js', licence: 'MIT', use: 'Vector path editing and boolean operations' },
  { name: 'Clipper2', licence: 'BSL-1.0', use: 'Polygon clipping and offsetting' },
  { name: 'Mediabunny', licence: 'MPL-2.0', use: 'Video encoding (MP4/WebM)' },
  { name: 'd3-delaunay', licence: 'ISC', use: 'Voronoi / Delaunay geometry' },
  { name: 'Radix UI & shadcn/ui', licence: 'MIT', use: 'Interface components' },
  { name: 'Lucide', licence: 'ISC', use: 'Icons' },
];

export default function AboutDialog({ open, onClose }: DialogProps) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="flex-row items-center gap-3">
          <LogoMark className="size-10" />
          <div className="grid gap-1">
            <DialogTitle>LumaStitch</DialogTitle>
            <DialogDescription>
              Version {APP_VERSION} · SVG &amp; images → machine embroidery (.pes)
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="grid gap-3 text-sm">
          <p className="text-muted-foreground">
            Free and open-source software, licensed under the{' '}
            <span className="font-medium text-foreground">GNU General Public License v3.0 or later</span>{' '}
            (GPL-3.0-or-later). It comes with no warranty; always test-stitch a design before production.
          </p>

          <p className="flex gap-2 rounded-md bg-muted px-2.5 py-2 text-xs">
            <ShieldCheck className="mt-px size-4 shrink-0 text-primary" aria-hidden />
            <span>
              <span className="font-medium">Private by design.</span> There is no account and no server. Your
              artwork and designs are processed and stored only in this browser, and never leave your computer
              unless you save or export a file.
            </span>
          </p>

          <Collapsible className="grid gap-1.5">
            <CollapsibleTrigger className="group flex items-center gap-1 justify-self-start text-xs font-medium tracking-wide text-muted-foreground uppercase hover:text-foreground">
              <ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
              Credits
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ul className="divide-y rounded-md border text-xs">
                {CREDITS.map((c) => (
                  <li key={c.name} className="flex items-baseline justify-between gap-3 px-2.5 py-1.5">
                    <span className="min-w-0">
                      <span className="font-medium">{c.name}</span>
                      <span className="text-muted-foreground"> · {c.use}</span>
                    </span>
                    <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{c.licence}</span>
                  </li>
                ))}
              </ul>
            </CollapsibleContent>
          </Collapsible>
        </div>

        <DialogFooter className="items-center sm:justify-between">
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
          >
            Source code on GitHub
            <ExternalLink className="size-3.5" aria-hidden />
          </a>
          <Button onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
