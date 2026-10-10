// SPDX-License-Identifier: GPL-3.0-or-later
/** All keyboard shortcuts live here. Ignored while focus is in a text input. */
import { getTool } from '@/tools';
import { useDoc } from '@/store/documentStore';
import { useUi, type ToolId } from '@/store/uiStore';
import { moveElements, selectedElementIds } from '@/store/commands';
import * as A from '@/store/actions';
import { fitDesign, fitSelection, panBy, spaceHeld, zoomActual, zoomBy } from '@/canvas/CanvasView';
import { zoomAt } from '@/canvas/viewport';
import { sim } from '@/simulator/controller';
import { MOD } from './utils';

export interface Shortcut {
  keys: string;
  label: string;
  group: 'File' | 'Edit' | 'Object' | 'View' | 'Tools' | 'Simulate' | 'Sequence';
}

export const SHORTCUTS: Shortcut[] = [
  { keys: `${MOD}N`, label: 'New design', group: 'File' },
  { keys: `${MOD}O`, label: 'Open…', group: 'File' },
  { keys: `${MOD}I`, label: 'Import SVG or image…', group: 'File' },
  { keys: `${MOD}S`, label: 'Save project file', group: 'File' },
  { keys: `${MOD}⇧S`, label: 'Save project as…', group: 'File' },
  { keys: `${MOD}E`, label: 'Export machine file (.pes, DST, JEF, EXP, VP3)…', group: 'File' },
  { keys: `${MOD}Z`, label: 'Undo', group: 'Edit' },
  { keys: `${MOD}⇧Z`, label: 'Redo', group: 'Edit' },
  { keys: `${MOD}X / ${MOD}C / ${MOD}V`, label: 'Cut / copy / paste', group: 'Edit' },
  { keys: `${MOD}D`, label: 'Duplicate', group: 'Edit' },
  { keys: `${MOD}A`, label: 'Select all', group: 'Edit' },
  { keys: 'Delete', label: 'Delete selection (or nodes)', group: 'Edit' },
  { keys: '← ↑ → ↓', label: 'Nudge 0.1 mm (⇧: 1 mm)', group: 'Edit' },
  { keys: 'Esc', label: 'Cancel / deselect', group: 'Edit' },
  { keys: `${MOD}⇧H`, label: 'Hide / show selection', group: 'Object' },
  { keys: `${MOD}⇧L`, label: 'Lock / unlock selection', group: 'Object' },
  { keys: `${MOD}⇧A`, label: 'Auto-digitize…', group: 'Object' },
  { keys: '⇧C', label: 'Toggle smooth / corner node', group: 'Object' },
  { keys: `${MOD}[ / ${MOD}]`, label: 'Move element earlier / later', group: 'Sequence' },
  { keys: `${MOD}⇧[ / ${MOD}⇧]`, label: 'Move element to start / end', group: 'Sequence' },
  { keys: '1 / 2 / 3', label: 'Artwork / Stitches / Realistic view', group: 'View' },
  { keys: `${MOD}0`, label: 'Fit design', group: 'View' },
  { keys: `${MOD}1`, label: '100% (actual size)', group: 'View' },
  { keys: `${MOD}2`, label: 'Fit selection', group: 'View' },
  { keys: `${MOD}+ / ${MOD}−`, label: 'Zoom in / out', group: 'View' },
  { keys: 'Space + drag', label: 'Pan (also middle- or right-drag)', group: 'View' },
  { keys: 'Two-finger scroll', label: 'Pan (trackpad); pinch to zoom', group: 'View' },
  { keys: 'Mouse wheel', label: 'Zoom at the cursor (⇧ + wheel pans sideways)', group: 'View' },
  { keys: '← ↑ → ↓', label: 'Pan when nothing is selected (⇧: further)', group: 'View' },
  { keys: '= / −', label: 'Zoom in / out', group: 'View' },
  { keys: '0', label: 'Fit design', group: 'View' },
  { keys: 'V', label: 'Select', group: 'Tools' },
  { keys: 'A', label: 'Direct select (nodes)', group: 'Tools' },
  { keys: 'P', label: 'Pen', group: 'Tools' },
  { keys: 'M / L', label: 'Rectangle / ellipse', group: 'Tools' },
  { keys: 'H / Z', label: 'Hand / zoom', group: 'Tools' },
  { keys: 'G', label: 'Stitch angle', group: 'Tools' },
  { keys: 'T', label: 'Start / end point', group: 'Tools' },
  { keys: 'R', label: 'Simulate', group: 'Simulate' },
  { keys: 'Space', label: 'Play / pause', group: 'Simulate' },
  { keys: '← / →', label: 'Step one stitch', group: 'Simulate' },
  { keys: '⇧← / ⇧→', label: 'Previous / next element', group: 'Simulate' },
  { keys: 'Home / End', label: 'Start / end', group: 'Simulate' },
  { keys: '?', label: 'Keyboard shortcuts', group: 'View' },
];

const TOOL_KEYS: Record<string, ToolId> = {
  v: 'select',
  a: 'direct',
  p: 'pen',
  m: 'rect',
  l: 'ellipse',
  h: 'hand',
  z: 'zoom',
  g: 'angle',
  t: 'entryExit',
};

function inTextField(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable) return true;
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type;
    return !['checkbox', 'radio', 'range', 'button', 'color'].includes(type);
  }
  return false;
}

/** Widgets that own their keyboard (sliders, menus, lists, tabs, sortable handles, dialogs). */
const KEY_OWNERS =
  '[role=slider],[role=menu],[role=menubar],[role=menuitem],[role=menuitemcheckbox],[role=menuitemradio],[role=listbox],[role=option],[role=tab],[role=tablist],[role=radiogroup],[role=radio],[role=switch],[role=checkbox],[role=combobox],[role=dialog],[aria-roledescription]';

function ownsKeys(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && typeof el.closest === 'function' && !!el.closest(KEY_OWNERS);
}

function isButtonLike(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && typeof el.closest === 'function' && !!el.closest('button,a[href],[role=button],summary');
}

function toolCtx() {
  const design = useDoc.getState().design;
  if (!design) return null;
  const ui = useUi.getState();
  return {
    design,
    ui,
    viewport: ui.viewport,
    px: (n: number) => n / ui.viewport.zoom,
    hitAt: () => null,
    snap: (p: [number, number]) => p,
  };
}

export function handleKeyDown(e: KeyboardEvent): void {
  const ui = useUi.getState();
  if (ui.dialog) return; // dialogs handle their own keys
  if (e.defaultPrevented || inTextField(e.target)) return;
  const mod = e.metaKey || e.ctrlKey;
  // Non-modifier keys belong to the focused widget when it handles keys itself; Space/Enter
  // activate focused buttons.
  if (!mod && ownsKeys(e.target)) return;
  if (!mod && (e.key === ' ' || e.key === 'Enter') && isButtonLike(e.target)) return;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const editor = ui.screen === 'editor' && !!useDoc.getState().design;
  const done = () => {
    e.preventDefault();
    e.stopPropagation();
  };

  // File shortcuts work everywhere (except while simulating).
  if (mod && !ui.sim.active) {
    if (key === 'n') return (done(), void ui.openDialog('newDesign'));
    if (key === 'o') return (done(), void A.openFile());
    if (key === 'i') return (done(), void A.importFile());
  }
  if (!editor) return;

  // Simulator keys.
  if (ui.sim.active) {
    if (key === ' ') return (done(), sim.toggle());
    if (key === 'ArrowRight') return (done(), e.shiftKey ? sim.element(1) : sim.step(1));
    if (key === 'ArrowLeft') return (done(), e.shiftKey ? sim.element(-1) : sim.step(-1));
    if (key === 'Home') return (done(), sim.seek(0));
    if (key === 'End') return (done(), sim.seek(Number.MAX_SAFE_INTEGER));
    if (key === 'Escape' || (!mod && key === 'r')) return (done(), A.toggleSimulate());
  }

  if (mod) {
    if (key === 's') return (done(), void A.saveProject(e.shiftKey));
    if (key === 'e') return (done(), ui.openDialog('export'));
    if (ui.sim.active) return; // editing is disabled while simulating
    if (key === 'z') return (done(), e.shiftKey ? useDoc.getState().redo() : useDoc.getState().undo());
    if (key === 'y') return (done(), useDoc.getState().redo());
    if (key === 'c') return (done(), void A.copySelection());
    if (key === 'x') return (done(), void A.cutSelection());
    if (key === 'v') return (done(), void A.paste());
    if (key === 'd') return (done(), A.duplicate());
    if (key === 'a' && e.shiftKey) return (done(), ui.openDialog('autoDigitize'));
    if (key === 'a') return (done(), A.selectAll());
    if (key === 'h' && e.shiftKey) return (done(), A.toggleHidden());
    if (key === 'l' && e.shiftKey) return (done(), A.toggleLocked());
    if (key === '0') return (done(), fitDesign());
    if (key === '1') return (done(), zoomActual());
    if (key === '2') return (done(), fitSelection());
    if (key === '=' || key === '+')
      return (
        done(),
        ui.setViewport(zoomAt(ui.viewport, 1.25, [ui.canvasSize.width / 2, ui.canvasSize.height / 2]))
      );
    if (key === '-')
      return (
        done(),
        ui.setViewport(zoomAt(ui.viewport, 0.8, [ui.canvasSize.width / 2, ui.canvasSize.height / 2]))
      );
    if (key === '[' || key === ']' || e.code === 'BracketLeft' || e.code === 'BracketRight') {
      const up = key === '[' || e.code === 'BracketLeft';
      const ids = selectedElementIds();
      done();
      moveElements(ids, e.shiftKey ? (up ? 'start' : 'end') : up ? 'up' : 'down');
      return;
    }
    return;
  }
  if (ui.sim.active) return;

  // Tool-specific keys first.
  const ctx = toolCtx();
  if (ctx && getTool(ui.tool).onKeyDown?.(e, ctx as any)) return done();

  if (key === ' ') {
    spaceHeld.current = true;
    return done();
  }
  // Navigation: arrows pan when they aren't moving a selection; = / − zoom; 0 fits the design.
  const panStep = e.shiftKey ? 240 : 60;
  if (key === 'ArrowLeft') return (done(), panBy(panStep, 0));
  if (key === 'ArrowRight') return (done(), panBy(-panStep, 0));
  if (key === 'ArrowUp') return (done(), panBy(0, panStep));
  if (key === 'ArrowDown') return (done(), panBy(0, -panStep));
  if (key === '=' || key === '+') return (done(), zoomBy(1.25));
  if (key === '-' || key === '_') return (done(), zoomBy(0.8));
  if (key === '0') return (done(), fitDesign());
  if (key === '?') return (done(), ui.openDialog('shortcuts'));
  if (key === 'r') return (done(), A.toggleSimulate());
  if (key === '1') return (done(), ui.set({ viewMode: 'artwork' }));
  if (key === '2') return (done(), ui.set({ viewMode: 'stitches' }));
  if (key === '3') return (done(), ui.set({ viewMode: 'realistic' }));
  if (TOOL_KEYS[key] && !e.altKey) {
    getTool(ui.tool).onCancel?.();
    return (done(), ui.setTool(TOOL_KEYS[key]));
  }
}

export function installKeymap(): () => void {
  const down = (e: KeyboardEvent) => handleKeyDown(e);
  const up = (e: KeyboardEvent) => {
    if (e.key === ' ') spaceHeld.current = false;
  };
  const blur = () => (spaceHeld.current = false);
  window.addEventListener('keydown', down);
  window.addEventListener('keyup', up);
  window.addEventListener('blur', blur);
  return () => {
    window.removeEventListener('keydown', down);
    window.removeEventListener('keyup', up);
    window.removeEventListener('blur', blur);
  };
}
