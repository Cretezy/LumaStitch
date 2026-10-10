// SPDX-License-Identifier: GPL-3.0-or-later
/** Dragging an element's start/end marker on the canvas (FR-2.6); one undo step on release. */
import { setElementProps } from '@/store/commands';
import { useToolState } from './toolState';
import type { CanvasPointerEvent, ToolContext } from './types';

let active = false;

/** Starts a marker drag if the pointer is on a start/end marker. Returns true when handled. */
export function markerDown(e: CanvasPointerEvent): boolean {
  const hit = e.hit;
  if (!hit || (hit.kind !== 'entry' && hit.kind !== 'exit')) return false;
  active = true;
  useToolState.setState({ marker: { elementId: hit.elementId, which: hit.kind, p: e.doc } });
  return true;
}

export function markerMove(e: CanvasPointerEvent, ctx: ToolContext): boolean {
  if (!active) return false;
  const m = useToolState.getState().marker;
  if (m) useToolState.setState({ marker: { ...m, p: ctx.snap(e.doc) } });
  return true;
}

export function markerUp(): boolean {
  if (!active) return false;
  active = false;
  const m = useToolState.getState().marker;
  useToolState.setState({ marker: null });
  if (m)
    setElementProps(
      [m.elementId],
      { [m.which]: m.p },
      m.which === 'entry' ? 'Move start point' : 'Move end point',
    );
  return true;
}

export function markerCancel(): void {
  active = false;
  useToolState.setState({ marker: null });
}
