// SPDX-License-Identifier: GPL-3.0-or-later
/** Non-undoable UI state: selection, tool, viewport, view options, simulator, dialogs. */
import { create } from 'zustand';
import type { Id, Matrix, Vec2 } from '@/model/types';

export type ToolId =
  | 'select'
  | 'direct'
  | 'pen'
  | 'rect'
  | 'ellipse'
  | 'hand'
  | 'zoom'
  | 'angle'
  | 'entryExit'
  | 'satinDirection';
export type ViewMode = 'artwork' | 'stitches' | 'realistic';
export type SidebarTab = 'inspector' | 'sequence' | 'threads' | 'issues';
export type DialogId =
  | 'satinSplit'
  | 'hooping'
  | 'import'
  | 'imageImport'
  | 'autoDigitize'
  | 'export'
  | 'designSettings'
  | 'shortcuts'
  | 'myThreads'
  | 'newDesign'
  | 'about'
  | 'lettering'
  | 'machineImport'
  | null;

export interface NodeRef {
  shapeId: Id;
  sub: number;
  idx: number;
}

export interface Selection {
  shapeIds: Id[];
  /** Selected elements (fill/outline). When empty, element-level UI uses all elements of selected shapes. */
  elementIds: Id[];
  nodes: NodeRef[];
}

export const EMPTY_SELECTION: Selection = { shapeIds: [], elementIds: [], nodes: [] };

export interface Viewport {
  /** CSS px per mm. */
  zoom: number;
  /** Screen offset of the document origin, CSS px. */
  pan: Vec2;
}

export interface ViewOptions {
  jumps: boolean;
  needlePoints: boolean;
  density: boolean;
  grid: boolean;
  dimensions: boolean;
  backdrop: boolean;
  underlay: boolean;
  rulers: boolean;
  snap: boolean;
}

export type DragPreview =
  | { kind: 'transform'; shapeIds: Id[]; matrix: Matrix }
  | { kind: 'nodes'; shapeId: Id; geom: import('@/model/types').PathGeom }
  | null;

export interface SimState {
  active: boolean;
  playing: boolean;
  speed: number; // multiplier; Infinity = max
  index: number; // current command index (integer part)
  stopAtColorChange: boolean;
}

export interface UiState {
  screen: 'home' | 'editor';
  selection: Selection;
  tool: ToolId;
  prevTool: ToolId | null;
  viewport: Viewport;
  canvasSize: { width: number; height: number };
  viewMode: ViewMode;
  view: ViewOptions;
  sidebarTab: SidebarTab;
  dragPreview: DragPreview;
  hover: { elementId?: Id; shapeId?: Id } | null;
  sim: SimState;
  dialog: DialogId;
  dialogData: any;
  /** Pending file passed into an import dialog. */
  pendingFile: File | null;
  toast: { id: number; message: string; kind: 'info' | 'error' | 'success' } | null;
  entryExitMode: 'entry' | 'exit';
  marquee: { a: Vec2; b: Vec2 } | null;
  /** Skipped/approximated features from the last import (shown in the Issues panel). */
  importNotes: { code: string; message: string }[];
  set(p: Partial<UiState>): void;
  setSelection(sel: Partial<Selection>): void;
  clearSelection(): void;
  setTool(t: ToolId): void;
  setViewport(v: Partial<Viewport>): void;
  setView(v: Partial<ViewOptions>): void;
  setSim(s: Partial<SimState>): void;
  openDialog(d: DialogId, data?: any): void;
  closeDialog(): void;
  showToast(message: string, kind?: 'info' | 'error' | 'success'): void;
}

const VIEW_KEY = 'lumastitch.view';

function loadView(): { view: ViewOptions; viewMode: ViewMode } {
  const def: ViewOptions = {
    jumps: true,
    needlePoints: false,
    density: false,
    grid: true,
    dimensions: true,
    backdrop: true,
    underlay: false,
    rulers: true,
    snap: false,
  };
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(VIEW_KEY) : null;
    if (raw) {
      const p = JSON.parse(raw);
      return { view: { ...def, ...(p.view ?? {}) }, viewMode: p.viewMode ?? 'stitches' };
    }
  } catch {
    /* ignore */
  }
  return { view: def, viewMode: 'stitches' };
}

function saveView(view: ViewOptions, viewMode: ViewMode) {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify({ view, viewMode }));
  } catch {
    /* ignore */
  }
}

let toastId = 0;
const initialView = loadView();

export const useUi = create<UiState>((set, get) => ({
  screen: 'home',
  selection: EMPTY_SELECTION,
  tool: 'select',
  prevTool: null,
  viewport: { zoom: 4, pan: [400, 300] },
  canvasSize: { width: 800, height: 600 },
  viewMode: initialView.viewMode,
  view: initialView.view,
  sidebarTab: 'inspector',
  dragPreview: null,
  hover: null,
  sim: { active: false, playing: false, speed: 1, index: 0, stopAtColorChange: false },
  dialog: null,
  dialogData: null,
  pendingFile: null,
  toast: null,
  entryExitMode: 'entry',
  marquee: null,
  importNotes: [],
  set: (p) => {
    set(p);
    if (p.viewMode) saveView(get().view, p.viewMode);
  },
  setSelection: (sel) => set((s) => ({ selection: { ...s.selection, ...sel } })),
  clearSelection: () => set({ selection: EMPTY_SELECTION }),
  setTool: (t) => set((s) => ({ tool: t, prevTool: s.tool })),
  setViewport: (v) => set((s) => ({ viewport: { ...s.viewport, ...v } })),
  setView: (v) => {
    set((s) => ({ view: { ...s.view, ...v } }));
    saveView(get().view, get().viewMode);
  },
  setSim: (s) => set((st) => ({ sim: { ...st.sim, ...s } })),
  openDialog: (d, data) => set({ dialog: d, dialogData: data ?? null }),
  closeDialog: () => set({ dialog: null, dialogData: null, pendingFile: null }),
  showToast: (message, kind = 'info') => set({ toast: { id: ++toastId, message, kind } }),
}));

export const ui = () => useUi.getState();
