// SPDX-License-Identifier: GPL-3.0-or-later
import { useState } from 'react';
import { AlertTriangle, ListOrdered, Palette, SlidersHorizontal, Upload } from 'lucide-react';
import { CanvasView } from '@/canvas/CanvasView';
import { Inspector } from '@/components/inspector/Inspector';
import { IssuesPanel } from '@/components/panels/IssuesPanel';
import { SequencePanel } from '@/components/panels/SequencePanel';
import { ThreadsPanel } from '@/components/panels/ThreadsPanel';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SimulatorBar } from '@/simulator/SimulatorBar';
import { handleFile } from '@/store/actions';
import { usePlan } from '@/store/planStore';
import { useUi, type SidebarTab } from '@/store/uiStore';
import { DesignSizeField } from './DesignSizeField';
import { StatusBar } from './StatusBar';
import { ToolPalette } from './ToolPalette';
import { Toolbar } from './Toolbar';

function Sidebar() {
  const tab = useUi((s) => s.sidebarTab);
  const simActive = useUi((s) => s.sim.active);
  const set = useUi((s) => s.set);
  const issues = usePlan((s) => s.plan?.diagnostics.filter((d) => d.severity !== 'info').length ?? 0);
  return (
    <aside className="flex w-80 shrink-0 flex-col border-l bg-background" aria-label="Sidebar">
      <div inert={simActive} className={simActive ? 'opacity-60' : undefined}>
        <DesignSizeField />
      </div>
      <Tabs
        value={tab}
        onValueChange={(v) => set({ sidebarTab: v as SidebarTab })}
        className="min-h-0 flex-1 gap-0"
      >
        <TabsList className="mx-2 mt-2 mb-1 w-[calc(100%-1rem)]">
          <TabsTrigger value="inspector">
            <SlidersHorizontal /> Inspector
          </TabsTrigger>
          <TabsTrigger value="sequence">
            <ListOrdered /> Sequence
          </TabsTrigger>
          <TabsTrigger value="threads">
            <Palette /> Threads
          </TabsTrigger>
          <TabsTrigger value="issues" aria-label={`Issues (${issues})`}>
            <AlertTriangle className={issues ? 'text-amber-600' : undefined} />
            {issues > 0 && <span className="tabular-nums">{issues}</span>}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="inspector" className="min-h-0 overflow-y-auto" inert={simActive}>
          <Inspector />
        </TabsContent>
        <TabsContent value="sequence" className="min-h-0">
          <SequencePanel />
        </TabsContent>
        <TabsContent value="threads" className="min-h-0" inert={simActive}>
          <ThreadsPanel />
        </TabsContent>
        <TabsContent value="issues" className="min-h-0 overflow-y-auto">
          <IssuesPanel />
        </TabsContent>
      </Tabs>
    </aside>
  );
}

export function AppShell() {
  const simActive = useUi((s) => s.sim.active);
  const [drag, setDrag] = useState(false);
  return (
    <div
      className="flex h-full flex-col"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDrag(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node))
          setDrag(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const f = e.dataTransfer.files?.[0];
        if (f) void handleFile(f, { intoCurrent: true });
      }}
    >
      <Toolbar />
      <div className="flex min-h-0 flex-1">
        <ToolPalette />
        <main className="relative flex min-w-0 flex-1 flex-col bg-canvas">
          <CanvasView />
          {drag && (
            <div className="pointer-events-none absolute inset-3 grid place-items-center rounded-xl border-2 border-dashed border-primary bg-primary/5 text-sm font-medium text-primary">
              <span className="flex items-center gap-2">
                <Upload className="size-4" /> Drop an SVG, image or project file
              </span>
            </div>
          )}
        </main>
        <Sidebar />
      </div>
      {simActive && <SimulatorBar />}
      <StatusBar />
    </div>
  );
}
