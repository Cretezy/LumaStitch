// SPDX-License-Identifier: GPL-3.0-or-later
import type * as React from 'react';
import type { Design, Id, Vec2 } from '@/model/types';
import type { ToolId, UiState, Viewport } from '@/store/uiStore';

export type HitTarget =
  | { kind: 'shape'; shapeId: Id }
  | { kind: 'element'; shapeId: Id; elementId: Id }
  | { kind: 'handle'; handle: string }
  | { kind: 'node'; shapeId: Id; sub: number; idx: number }
  | { kind: 'ctrl'; shapeId: Id; sub: number; idx: number; which: 'in' | 'out' }
  | { kind: 'segment'; shapeId: Id }
  | { kind: 'entry' | 'exit'; elementId: Id }
  | { kind: 'guide'; elementId: Id; index: number; end: 0 | 1 }
  | { kind: 'railSplit'; elementId: Id; index: 0 | 1 };

export interface Mods {
  shift: boolean;
  alt: boolean;
  mod: boolean;
}

export interface CanvasPointerEvent {
  doc: Vec2;
  screen: Vec2;
  mods: Mods;
  hit: HitTarget | null;
  button: number;
  nativeEvent: PointerEvent | MouseEvent;
}

export interface ToolContext {
  design: Design;
  ui: UiState;
  viewport: Viewport;
  /** Snap a document point (grid / nodes) when snapping is on. */
  snap(pt: Vec2, exclude?: Set<Id>): Vec2;
  /** Hit test at a screen point (used during drags). */
  hitAt(screen: Vec2): HitTarget | null;
  /** Pixels → mm at the current zoom. */
  px(n: number): number;
}

export interface Tool {
  id: ToolId;
  label: string;
  cursor: string;
  shortcut?: string;
  onPointerDown?(e: CanvasPointerEvent, ctx: ToolContext): void;
  onPointerMove?(e: CanvasPointerEvent, ctx: ToolContext): void;
  onPointerUp?(e: CanvasPointerEvent, ctx: ToolContext): void;
  onDoubleClick?(e: CanvasPointerEvent, ctx: ToolContext): void;
  /** Return true if handled. */
  onKeyDown?(e: KeyboardEvent, ctx: ToolContext): boolean | void;
  onCancel?(): void;
  Overlay?: React.FC;
}
