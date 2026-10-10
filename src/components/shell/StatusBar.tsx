// SPDX-License-Identifier: GPL-3.0-or-later
import { AlertTriangle, Loader2, Minus, Plus } from 'lucide-react';
import { fitDesign, zoomActual, zoomBy } from '@/canvas/CanvasView';
import { useCursor } from '@/canvas/cursorStore';
import { PX_PER_MM_100 } from '@/canvas/viewport';
import { fmt, fmtInt, fmtTime } from '@/lib/utils';
import { usePlan } from '@/store/planStore';
import { useUi } from '@/store/uiStore';
import { Tip } from '@/components/ui/tooltip';

function Cursor() {
  const pos = useCursor((s) => s.pos);
  return (
    <span className="w-36 tabular-nums">
      X {pos ? fmt(pos[0]) : '–'} &nbsp;Y {pos ? fmt(pos[1]) : '–'} mm
    </span>
  );
}

export function StatusBar() {
  const plan = usePlan((s) => s.plan);
  const status = usePlan((s) => s.status);
  const zoom = useUi((s) => s.viewport.zoom);
  const set = useUi((s) => s.set);
  const st = plan?.stats;
  const b = plan?.bounds;
  const warnings = plan?.diagnostics.filter((d) => d.severity !== 'info').length ?? 0;
  const sep = <span className="text-border">·</span>;
  return (
    <footer className="flex h-7 items-center gap-2 border-t bg-background px-3 text-[11px] text-muted-foreground">
      <Cursor />
      {sep}
      <div className="flex items-center gap-0.5" role="group" aria-label="Zoom">
        <Tip label="Zoom out (−)">
          <button
            type="button"
            className="grid size-5 place-items-center rounded hover:bg-accent hover:text-foreground"
            onClick={() => zoomBy(0.8)}
            aria-label="Zoom out"
          >
            <Minus className="size-3" />
          </button>
        </Tip>
        <Tip label="Fit design (0 or ⌘0)">
          <button
            type="button"
            className="w-11 rounded py-0.5 text-center tabular-nums hover:bg-accent hover:text-foreground"
            onClick={() => fitDesign()}
            aria-label="Fit design"
          >
            {Math.round((zoom / PX_PER_MM_100) * 100)}%
          </button>
        </Tip>
        <Tip label="Zoom in (=)">
          <button
            type="button"
            className="grid size-5 place-items-center rounded hover:bg-accent hover:text-foreground"
            onClick={() => zoomBy(1.25)}
            aria-label="Zoom in"
          >
            <Plus className="size-3" />
          </button>
        </Tip>
        <Tip label="Actual size (⌘1)">
          <button
            type="button"
            className="ml-0.5 rounded px-1 py-0.5 hover:bg-accent hover:text-foreground"
            onClick={() => zoomActual()}
          >
            1:1
          </button>
        </Tip>
      </div>
      {sep}
      {status === 'building' && <Loader2 className="size-3 animate-spin" aria-label="Generating stitches" />}
      {st ? (
        <>
          <Tip label="Needle penetrations">
            <span className="tabular-nums">{fmtInt(st.stitches)} st</span>
          </Tip>
          {sep}
          <span>
            {plan.colorBlocks.length} colour{plan.colorBlocks.length === 1 ? '' : 's'}
          </span>
          {sep}
          <span>
            {st.trims} trim{st.trims === 1 ? '' : 's'}
          </span>
          {sep}
          <span>
            {st.colorChanges} change{st.colorChanges === 1 ? '' : 's'}
            {st.stops ? `, ${st.stops} stop${st.stops === 1 ? '' : 's'}` : ''}
          </span>
          {sep}
          <span className="tabular-nums">
            {b && st.stitches ? `${fmt(b.maxX - b.minX)} × ${fmt(b.maxY - b.minY)} mm` : '–'}
          </span>
          {sep}
          <Tip label="Estimated sewing time (machine speed, trims and colour changes)">
            <span className="tabular-nums">≈ {fmtTime(st.estSeconds)}</span>
          </Tip>
        </>
      ) : (
        <span>No stitches yet</span>
      )}
      <div className="ml-auto" />
      {warnings > 0 && (
        <button
          type="button"
          className="flex items-center gap-1 text-amber-600 hover:underline"
          onClick={() => set({ sidebarTab: 'issues' })}
        >
          <AlertTriangle className="size-3" /> {warnings}
        </button>
      )}
    </footer>
  );
}
