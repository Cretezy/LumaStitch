// SPDX-License-Identifier: GPL-3.0-or-later
/** Transient drawing state of tools, rendered by the overlay. */
import { create } from 'zustand';
import type { Node, Vec2 } from '@/model/types';

export interface ToolDrawState {
  pen: { nodes: Node[]; hover: Vec2 | null; dragging: boolean } | null;
  box: { kind: 'rect' | 'ellipse'; a: Vec2; b: Vec2 } | null;
  line: { a: Vec2; b: Vec2; label?: string } | null;
  /** A start/end marker being dragged. */
  marker: { elementId: string; which: 'entry' | 'exit'; p: Vec2 } | null;
}

export const useToolState = create<ToolDrawState>(() => ({ pen: null, box: null, line: null, marker: null }));
