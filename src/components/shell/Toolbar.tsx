// SPDX-License-Identifier: GPL-3.0-or-later
import { Download, FileUp, Home, Pause, Play, Redo2, Sparkles, Undo2, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tip } from '@/components/ui/tooltip';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Separator } from '@/components/ui/separator';
import { MOD } from '@/lib/utils';
import * as A from '@/store/actions';
import { useDoc } from '@/store/documentStore';
import { usePlan } from '@/store/planStore';
import { useUi, type ViewMode } from '@/store/uiStore';
import { MenuBar } from './MenuBar';

export function Toolbar() {
  const ui = useUi();
  const name = useDoc((s) => s.design?.name ?? '');
  const canUndo = useDoc((s) => s.past.length > 0);
  const canRedo = useDoc((s) => s.future.length > 0);
  const building = usePlan((s) => s.status === 'building');
  const simActive = ui.sim.active;
  return (
    <header className="flex flex-col border-b bg-background">
      <div className="flex h-9 items-center gap-1 px-2">
        <Tip label="Project library">
          <Button variant="ghost" size="iconSm" onClick={() => void A.goHome()} aria-label="Project library">
            <Home />
          </Button>
        </Tip>
        <span className="mr-1 flex items-center gap-1.5 text-sm font-semibold tracking-tight">
          <span className="grid size-5 place-items-center rounded bg-primary text-[10px] font-bold text-primary-foreground">
            L
          </span>
          LumaStitch
        </span>
        <MenuBar />
        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          {building && <span className="animate-pulse">Generating stitches…</span>}
          <span className="max-w-64 truncate font-medium text-foreground" title={name}>
            {name}
          </span>
        </div>
      </div>
      <div className="flex h-11 items-center gap-1.5 border-t px-2">
        <Tip label={`Import SVG or image (${MOD}I)`}>
          <Button variant="outline" size="sm" onClick={() => void A.importFile()} disabled={simActive}>
            <FileUp /> Import
          </Button>
        </Tip>
        <Tip label={`Assign stitch types, settings, threads and order automatically (${MOD}⇧A)`}>
          <Button size="sm" onClick={() => ui.openDialog('autoDigitize')} disabled={simActive}>
            <Wand2 /> Auto-digitize
          </Button>
        </Tip>
        <Separator orientation="vertical" className="mx-1 !h-6" />
        <Tip label={`Undo (${MOD}Z)`}>
          <Button
            variant="ghost"
            size="iconSm"
            disabled={!canUndo || simActive}
            onClick={() => useDoc.getState().undo()}
            aria-label="Undo"
          >
            <Undo2 />
          </Button>
        </Tip>
        <Tip label={`Redo (${MOD}⇧Z)`}>
          <Button
            variant="ghost"
            size="iconSm"
            disabled={!canRedo || simActive}
            onClick={() => useDoc.getState().redo()}
            aria-label="Redo"
          >
            <Redo2 />
          </Button>
        </Tip>
        <Separator orientation="vertical" className="mx-1 !h-6" />
        <ToggleGroup
          type="single"
          value={ui.viewMode}
          onValueChange={(v) => v && ui.set({ viewMode: v as ViewMode })}
          aria-label="View mode"
        >
          <Tip label="Vector shapes (1)">
            <ToggleGroupItem value="artwork">Artwork</ToggleGroupItem>
          </Tip>
          <Tip label="Flat stitch lines over faded artwork (2)">
            <ToggleGroupItem value="stitches">Stitches</ToggleGroupItem>
          </Tip>
          <Tip label="Thread-like rendering (3)">
            <ToggleGroupItem value="realistic">
              <Sparkles className="size-3.5" /> Realistic
            </ToggleGroupItem>
          </Tip>
        </ToggleGroup>
        <Tip label="Animate the stitch-out exactly as exported (R)">
          <Button
            variant={simActive ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => A.toggleSimulate()}
            aria-pressed={simActive}
          >
            {simActive ? <Pause /> : <Play />} {simActive ? 'Stop simulating' : 'Simulate'}
          </Button>
        </Tip>
        <div className="ml-auto" />
        <Tip
          label={`Export a machine file (.pes by default; also DST, JEF, EXP, VP3), a preview or a worksheet (${MOD}E)`}
        >
          <Button size="sm" onClick={() => ui.openDialog('export')} data-testid="toolbar-export">
            <Download /> Export
          </Button>
        </Tip>
      </div>
    </header>
  );
}
