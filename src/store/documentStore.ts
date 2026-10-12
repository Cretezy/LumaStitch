// SPDX-License-Identifier: GPL-3.0-or-later
/** The undoable document. Every change goes through exec(label, recipe). */
import { create } from 'zustand';
import { current, isDraft, produce, type Draft } from 'immer';
import { BaselineEditError, reflowLetteringBaselines } from '@/lettering/baseline';
import { checkInvariants } from '@/model/invariants';
import type { Design } from '@/model/types';
import { EMPTY_SELECTION, useUi, type Selection } from './uiStore';

export const HISTORY_LIMIT = 200;

export interface HistoryEntry {
  design: Design;
  selection: Selection;
  label: string;
}

export interface DocState {
  design: Design | null;
  /** Library id of the open design. */
  designId: string | null;
  past: HistoryEntry[];
  future: HistoryEntry[];
  /** Bumps on every change (incl. undo/redo/load). */
  revision: number;
  lastLabel: string;
  exec(
    label: string,
    recipe: (draft: Draft<Design>) => void,
    opts?: { selection?: Partial<Selection> },
  ): void;
  undo(): void;
  redo(): void;
  load(design: Design, id: string): void;
  close(): void;
}

const DEV = typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV;

export const useDoc = create<DocState>((set, get) => ({
  design: null,
  designId: null,
  past: [],
  future: [],
  revision: 0,
  lastLabel: '',
  exec(label, recipe, opts) {
    const { design, past, revision } = get();
    if (!design) return;
    if (useUi.getState().sim.active) {
      useUi.getState().showToast('Stop the simulation to edit the design.');
      return;
    }
    let next: Design;
    try {
      next = produce(design, (draft) => {
        recipe(draft);
        reflowLetteringBaselines(draft, design);
        // Editing individual letter paths detaches their text block; a whole-block transform
        // updates the saved matrix and keeps text editable. Never leave dangling text members.
        for (const [id, group] of Object.entries(draft.lettering ?? {})) {
          const old = design.lettering?.[id];
          const missing = group.shapeIds.some((sid) => !draft.shapes[sid]);
          const unchangedDefinition = old && JSON.stringify(old) === JSON.stringify(group);
          const editedGeometry =
            !missing &&
            unchangedDefinition &&
            group.shapeIds.some(
              (sid) =>
                sid !== group.baselineShapeId &&
                design.shapes[sid]?.geom !==
                  (isDraft(draft.shapes[sid].geom)
                    ? current(draft.shapes[sid].geom)
                    : draft.shapes[sid].geom),
            );
          if (missing || editedGeometry) delete draft.lettering![id];
        }
      });
    } catch (error) {
      if (!(error instanceof BaselineEditError)) throw error;
      useUi.getState().showToast(error.message, 'error');
      return;
    }
    if (next === design) {
      if (opts?.selection) useUi.getState().setSelection(opts.selection);
      return;
    }
    if (DEV) {
      const errs = checkInvariants(next);
      if (errs.length) console.error(`[invariants] after "${label}":`, errs);
    }
    const selection = useUi.getState().selection;
    const entry: HistoryEntry = { design, selection, label };
    const newPast =
      past.length >= HISTORY_LIMIT
        ? [...past.slice(past.length - HISTORY_LIMIT + 1), entry]
        : [...past, entry];
    set({ design: next, past: newPast, future: [], revision: revision + 1, lastLabel: label });
    if (opts?.selection) useUi.getState().setSelection(opts.selection);
  },
  undo() {
    const { past, future, design, revision } = get();
    if (!past.length || !design || useUi.getState().sim.active) return;
    const prev = past[past.length - 1];
    const sel = useUi.getState().selection;
    set({
      design: prev.design,
      past: past.slice(0, -1),
      future: [...future, { design, selection: sel, label: prev.label }],
      revision: revision + 1,
      lastLabel: 'Undo ' + prev.label,
    });
    useUi.getState().setSelection(prev.selection);
  },
  redo() {
    const { past, future, design, revision } = get();
    if (!future.length || !design || useUi.getState().sim.active) return;
    const next = future[future.length - 1];
    const sel = useUi.getState().selection;
    set({
      design: next.design,
      future: future.slice(0, -1),
      past: [...past, { design, selection: sel, label: next.label }],
      revision: revision + 1,
      lastLabel: 'Redo ' + next.label,
    });
    useUi.getState().setSelection(next.selection);
  },
  load(design, id) {
    set({ design, designId: id, past: [], future: [], revision: get().revision + 1, lastLabel: 'Open' });
    useUi.getState().set({ selection: EMPTY_SELECTION, importNotes: [] });
  },
  close() {
    set({ design: null, designId: null, past: [], future: [], revision: get().revision + 1 });
  },
}));

export const doc = () => useDoc.getState();
export const exec = (...args: Parameters<DocState['exec']>) => useDoc.getState().exec(...args);
