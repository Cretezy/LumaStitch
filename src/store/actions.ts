// SPDX-License-Identifier: GPL-3.0-or-later
/** App-level actions shared by the menu bar, toolbar, context menus and keyboard shortcuts. */
import { offset as clipperOffset, offsetClosedStroke, offsetPolylines, makeValid } from '@/geom/clipper';
import { flattenGeom } from '@/geom/flatten';
import { rotateScreen, scale } from '@/geom/matrix';
import {
  booleanGeoms,
  combine,
  closePath,
  joinEndpoints,
  openPath,
  reverseGeom,
  simplifyGeom,
  splitSubpaths,
  type BooleanOp,
} from '@/geom/paperAdapter';
import { newId } from '@/lib/ids';
import { createDesign, createElement, hasClosedSubpath, shapeElements } from '@/model/factories';
import { polyShapeToGeom, transformGeomM } from '@/model/geomOps';
import { shapeSchema, threadSchema } from '@/model/schema';
import { z } from 'zod';
import { parseProjectFile, serializeProject } from '@/model/schema';
import type {
  Design,
  FabricId,
  Id,
  Matrix,
  PathGeom,
  SequenceEntry,
  Shape,
  StitchElement,
  Thread,
  Vec2,
} from '@/model/types';
import { createLibraryEntry, getPref, loadDesign, setPref } from '@/library/library';
import { flushAutosave } from '@/io/project/autosave';
import { ACCEPT_ANY, ACCEPT_PROJECT, fileKind, pickFile, safeFileName, saveFile } from '@/io/project/files';
import { optimizeSequence as optimizeSequenceLocal } from '@/engine/sequence/optimize';
import { fitDesign } from '@/canvas/CanvasView';
import { sim } from '@/simulator/controller';
import {
  addShapes,
  deleteShapes,
  duplicateShapes,
  reorderSequence,
  setShapeGeom,
  setShapeGeoms,
  setShapeProps,
  transformShapes,
  transformShapesEach,
} from './commands';
import { exec, useDoc } from './documentStore';
import { useUi } from './uiStore';
import { selectionBBox } from '@/tools/selection';

const toast = (m: string, k: 'info' | 'error' | 'success' = 'info') => useUi.getState().showToast(m, k);

// ---------------------------------------------------------------------------- designs

export async function openDesignById(id: string): Promise<boolean> {
  try {
    const d = await loadDesign(id);
    if (!d) {
      toast('That design could not be found.', 'error');
      return false;
    }
    await flushAutosave();
    sim.stop();
    useDoc.getState().load(d, id);
    useUi.getState().set({ screen: 'editor', tool: 'select', dragPreview: null });
    return true;
  } catch (err) {
    toast(`Could not open design: ${String(err)}`, 'error');
    return false;
  }
}

export async function newDesign(opts: { name?: string; fabric?: FabricId } = {}): Promise<void> {
  const fabric = opts.fabric ?? ((await getPref<FabricId>('lastFabric')) || 'woven');
  const d = createDesign({ name: opts.name ?? 'Untitled', fabric });
  const id = await createLibraryEntry(d);
  await setPref('lastFabric', fabric);
  await flushAutosave();
  sim.stop();
  useDoc.getState().load(d, id);
  useUi.getState().set({ screen: 'editor', tool: 'select' });
}

export async function goHome(): Promise<void> {
  await flushAutosave();
  sim.stop();
  useDoc.getState().close();
  useUi
    .getState()
    .set({ screen: 'home', selection: { shapeIds: [], elementIds: [], nodes: [] }, dialog: null });
}

/** Opens a design object as a new library entry. */
export async function openDesignObject(d: Design): Promise<void> {
  const id = await createLibraryEntry(d);
  await openDesignById(id);
}

// ---------------------------------------------------------------------------- files

export async function saveProject(saveAs = false): Promise<void> {
  const { design, designId } = useDoc.getState();
  if (!design) return;
  const blob = new Blob([serializeProject(design)], { type: 'application/json' });
  const r = await saveFile(blob, safeFileName(design.name, 'lumastitch'), {
    description: 'LumaStitch project',
    accept: ACCEPT_PROJECT,
    key: designId ?? undefined,
    saveAs,
  });
  if (r !== 'cancelled') toast(r === 'saved' ? 'Project saved.' : 'Project downloaded.', 'success');
}

export async function openProjectText(text: string): Promise<void> {
  try {
    const d = parseProjectFile(text);
    await openDesignObject(d);
  } catch (err: any) {
    toast(err?.message ?? String(err), 'error');
  }
}

/** Routes any dropped / picked file: SVG, image, project or PES. */
export async function handleFile(file: File, opts: { intoCurrent?: boolean } = {}): Promise<void> {
  const kind = fileKind(file);
  const ui = useUi.getState();
  if (kind === 'project') {
    await openProjectText(await file.text());
    return;
  }
  if (kind === 'machine') {
    ui.set({ pendingFile: file });
    ui.openDialog('machineImport', { file, intoCurrent: !!opts.intoCurrent });
    return;
  }
  if (kind === 'svg' || kind === 'image') {
    // Import adds to the open design; Open (or no design open) starts a new one.
    if (!useDoc.getState().design || !opts.intoCurrent)
      await newDesign({ name: file.name.replace(/\.[^.]+$/, '') });
    ui.set({ pendingFile: file });
    ui.openDialog(kind === 'svg' ? 'import' : 'imageImport', { file });
    return;
  }
  toast(`Unsupported file: ${file.name}`, 'error');
}

export async function importFile(): Promise<void> {
  const f = await pickFile({ description: 'SVG, image or project', accept: ACCEPT_ANY });
  if (f) await handleFile(f, { intoCurrent: true });
}

export async function openFile(): Promise<void> {
  const f = await pickFile({ description: 'LumaStitch project, SVG or image', accept: ACCEPT_ANY });
  if (f) await handleFile(f, { intoCurrent: false });
}

// ---------------------------------------------------------------------------- selection & clipboard

export function selectAll(): void {
  const d = useDoc.getState().design;
  if (!d) return;
  useUi.getState().setSelection({
    shapeIds: d.zOrder.filter((id) => !d.shapes[id].hidden && !d.shapes[id].locked),
    elementIds: [],
    nodes: [],
  });
}

const clipSchema = z.object({
  format: z.literal('lumastitch-clip'),
  shapes: z.array(shapeSchema).max(5000),
  threads: z.array(threadSchema),
});

interface ClipData {
  shapes: Shape[];
  threads: Thread[];
}
let clipboard: ClipData | null = null;
const CLIP_MIME = 'web application/x-lumastitch';

export async function copySelection(): Promise<void> {
  const d = useDoc.getState().design;
  if (!d) return;
  const ids = useUi.getState().selection.shapeIds;
  if (!ids.length) return;
  const shapes = d.zOrder.filter((id) => ids.includes(id)).map((id) => structuredClone(d.shapes[id]));
  const tids = new Set<Id>();
  for (const s of shapes) for (const el of shapeElements(s)) tids.add(el.threadId);
  clipboard = { shapes, threads: [...tids].map((t) => d.threads[t]).filter(Boolean) };
  try {
    await navigator.clipboard?.writeText(JSON.stringify({ format: 'lumastitch-clip', ...clipboard }));
  } catch {
    /* clipboard permission denied: keep the in-memory copy */
  }
  void CLIP_MIME;
}

export async function cutSelection(): Promise<void> {
  const revision = useDoc.getState().revision;
  const ids = editableSelection();
  if (!ids.length) return;
  await copySelection();
  // Clipboard permission can outlive an edit or document switch. Never delete newer content.
  if (useDoc.getState().revision !== revision) return;
  deleteShapes(ids);
}

export async function paste(): Promise<void> {
  const { design: d, revision } = useDoc.getState();
  if (!d) return;
  let data = clipboard;
  try {
    const text = await navigator.clipboard?.readText();
    if (text && text.includes('"lumastitch-clip"')) {
      // Untrusted: validate before it reaches the document or the engine.
      const parsed = clipSchema.safeParse(JSON.parse(text));
      if (parsed.success) data = parsed.data as ClipData;
    }
  } catch {
    /* ignore */
  }
  // Thread mappings and the destination must still describe the document we started with.
  if (useDoc.getState().revision !== revision) return;
  if (!data?.shapes?.length) return;
  const threadMap = new Map<Id, Id>();
  const threads: Thread[] = [];
  for (const t of data.threads) {
    const existing = Object.values(d.threads).find(
      (x) => x.color === t.color && (x.code ?? '') === (t.code ?? ''),
    );
    if (existing) threadMap.set(t.id, existing.id);
    else {
      const nt = { ...t, id: newId('t') };
      threads.push(nt);
      threadMap.set(t.id, nt.id);
    }
  }
  const fallback = (): Id => {
    let t =
      threads.find((x) => x.color === '#000000') ??
      Object.values(d.threads).find((x) => x.color === '#000000');
    if (!t) {
      t = { id: newId('t'), name: 'Black', color: '#000000' };
      threads.push(t);
    }
    return t.id;
  };
  const offsetM: Matrix = [1, 0, 0, 1, 2, 2]; // offset slightly so the paste is visible
  const shapes = data.shapes.map((s) => {
    const c: Shape = structuredClone(s);
    c.id = newId('s');
    c.geom = transformGeomM(c.geom, offsetM);
    if (c.fill && !hasClosedSubpath(c.geom)) c.fill = null;
    for (const el of shapeElements(c)) {
      el.id = newId('e');
      el.threadId = threadMap.get(el.threadId) ?? (d.threads[el.threadId] ? el.threadId : fallback());
      if (el.entry) el.entry = [el.entry[0] + 2, el.entry[1] + 2];
      if (el.exit) el.exit = [el.exit[0] + 2, el.exit[1] + 2];
      if (el.guides)
        el.guides = el.guides.map(
          ([a, b]) =>
            [
              [a[0] + 2, a[1] + 2],
              [b[0] + 2, b[1] + 2],
            ] as [Vec2, Vec2],
        );
    }
    return c;
  });
  addShapes('Paste', { shapes, threads });
}

/** Selected shapes that may be edited (locked shapes are excluded). */
export function editableSelection(): Id[] {
  const d = useDoc.getState().design;
  if (!d) return [];
  return useUi.getState().selection.shapeIds.filter((id) => d.shapes[id] && !d.shapes[id].locked);
}

export function duplicate(): void {
  duplicateShapes(useUi.getState().selection.shapeIds);
}

export function deleteSelection(): void {
  deleteShapes(editableSelection());
}

export function flip(axis: 'h' | 'v'): void {
  const d = useDoc.getState().design;
  const ids = editableSelection();
  if (!d || !ids.length) return;
  const b = selectionBBox(d, ids);
  if (!b) return;
  const cx = (b.minX + b.maxX) / 2,
    cy = (b.minY + b.maxY) / 2;
  transformShapes(
    ids,
    axis === 'h' ? scale(-1, 1, cx, cy) : scale(1, -1, cx, cy),
    axis === 'h' ? 'Flip horizontal' : 'Flip vertical',
  );
}

export function rotateSelection(deg: number): void {
  const d = useDoc.getState().design;
  const ids = editableSelection();
  if (!d || !ids.length) return;
  const b = selectionBBox(d, ids);
  if (!b) return;
  transformShapes(ids, rotateScreen(deg, (b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2), 'Rotate');
}

export function toggleHidden(): void {
  const d = useDoc.getState().design;
  const ids = useUi.getState().selection.shapeIds;
  if (!d || !ids.length) return;
  const hide = !ids.every((id) => d.shapes[id]?.hidden);
  setShapeProps(ids, { hidden: hide }, hide ? 'Hide' : 'Show');
}

export function showAll(): void {
  const d = useDoc.getState().design;
  if (!d) return;
  setShapeProps(
    Object.keys(d.shapes).filter((id) => d.shapes[id].hidden),
    { hidden: false },
    'Show all',
  );
}

export function toggleLocked(): void {
  const d = useDoc.getState().design;
  const ids = useUi.getState().selection.shapeIds;
  if (!d || !ids.length) return;
  const lock = !ids.every((id) => d.shapes[id]?.locked);
  setShapeProps(ids, { locked: lock }, lock ? 'Lock' : 'Unlock');
  if (lock) useUi.getState().clearSelection();
}

export function unlockAll(): void {
  const d = useDoc.getState().design;
  if (!d) return;
  setShapeProps(
    Object.keys(d.shapes).filter((id) => d.shapes[id].locked),
    { locked: false },
    'Unlock all',
  );
}

// ---------------------------------------------------------------------------- booleans & path ops

function cloneElementFresh(el: StitchElement | null): StitchElement | null {
  if (!el) return null;
  return { ...structuredClone(el), id: newId('e') };
}

interface ReplaceGroup {
  inputIds: Id[];
  results: Shape[];
  /** Results take this shape's zOrder slot. */
  zSlotOf: Id;
}

/** Replaces input shapes by result shapes (one undo step for all groups). Results take a zOrder slot and the first input's sequence slot. */
function replaceShapeGroups(label: string, groups: ReplaceGroup[]): void {
  if (!groups.length) return;
  exec(
    label,
    (d) => {
      for (const { inputIds, results, zSlotOf } of groups) {
        const els = new Set<Id>();
        for (const sid of inputIds) for (const el of shapeElements(d.shapes[sid] as Shape)) els.add(el.id);
        const firstSeq = d.sequence.findIndex((e) => e.kind === 'element' && els.has(e.elementId));
        const zi = d.zOrder.indexOf(zSlotOf);
        const before = d.zOrder.slice(0, zi).filter((id) => !inputIds.includes(id));
        const after = d.zOrder.slice(zi + 1).filter((id) => !inputIds.includes(id));
        for (const sid of inputIds) delete d.shapes[sid];
        for (const r of results) d.shapes[r.id] = r;
        d.zOrder = [...before, ...results.map((r) => r.id), ...after];
        const entries: SequenceEntry[] = [];
        for (const r of results)
          for (const el of shapeElements(r)) entries.push({ kind: 'element', elementId: el.id });
        const kept: SequenceEntry[] = [];
        d.sequence.forEach((e, i) => {
          if (i === firstSeq) kept.push(...entries);
          if (e.kind === 'element' && els.has(e.elementId)) return;
          kept.push(e);
        });
        if (firstSeq < 0) kept.push(...entries);
        d.sequence = kept;
      }
    },
    { selection: { shapeIds: groups.flatMap((g) => g.results.map((r) => r.id)), elementIds: [], nodes: [] } },
  );
}

function replaceShapes(label: string, inputIds: Id[], results: Shape[], zSlotOf: Id): void {
  replaceShapeGroups(label, [{ inputIds, results, zSlotOf }]);
}

export function booleanOp(op: BooleanOp): void {
  if (hasSelectedMachineProgram()) return;
  const d = useDoc.getState().design;
  if (!d) return;
  const sel = editableSelection();
  const ids = d.zOrder.filter((id) => sel.includes(id) && hasClosedSubpath(d.shapes[id].geom));
  if (ids.length < 2) {
    toast('Select two or more closed shapes.');
    return;
  }
  let geoms: PathGeom[];
  try {
    geoms = booleanGeoms(
      op,
      ids.map((id) => d.shapes[id].geom),
    );
  } catch (err) {
    toast(`Boolean operation failed: ${String(err)}`, 'error');
    return;
  }
  // Settings: topmost for unite/intersect/exclude/divide; back shape for subtract.
  const src = op === 'subtract' ? d.shapes[ids[0]] : d.shapes[ids[ids.length - 1]];
  const zSlot = op === 'subtract' ? ids[0] : ids[ids.length - 1];
  const results: Shape[] = geoms
    .filter((g) => g.subpaths.length)
    .map((g, i) => ({
      id: newId('s'),
      name: geoms.length > 1 ? `${src.name} (${i + 1})` : src.name,
      geom: g,
      art: { ...src.art },
      fill:
        cloneElementFresh(src.fill) ??
        (src.outline ? createElement('fill', 'tatami', src.outline.threadId) : null),
      outline: cloneElementFresh(src.outline),
    }));
  if (!results.length) {
    replaceShapes(op[0].toUpperCase() + op.slice(1), ids, [], zSlot);
    toast('The result is empty.');
    return;
  }
  replaceShapes(op[0].toUpperCase() + op.slice(1), ids, results, zSlot);
}

export function combineSelection(): void {
  if (hasSelectedMachineProgram()) return;
  const d = useDoc.getState().design;
  if (!d) return;
  const sel = editableSelection();
  const ids = d.zOrder.filter((id) => sel.includes(id));
  if (ids.length < 2) return;
  const top = d.shapes[ids[ids.length - 1]];
  const g = combine(ids.map((id) => d.shapes[id].geom));
  const r: Shape = {
    id: newId('s'),
    name: top.name,
    geom: g,
    art: { ...top.art },
    fill: hasClosedSubpath(g) ? cloneElementFresh(top.fill) : null,
    outline: cloneElementFresh(top.outline),
  };
  replaceShapes('Combine', ids, [r], ids[ids.length - 1]);
}

export function breakApart(): void {
  if (hasSelectedMachineProgram()) return;
  const d = useDoc.getState().design;
  if (!d) return;
  const groups: ReplaceGroup[] = [];
  for (const id of editableSelection()) {
    const s = d.shapes[id];
    const parts = splitSubpaths(s.geom);
    if (parts.length < 2) continue;
    groups.push({
      inputIds: [id],
      zSlotOf: id,
      results: parts.map((g, i) => ({
        id: newId('s'),
        name: `${s.name} (${i + 1})`,
        geom: g,
        art: { ...s.art },
        fill: hasClosedSubpath(g) ? cloneElementFresh(s.fill) : null,
        outline: cloneElementFresh(s.outline),
      })),
    });
  }
  replaceShapeGroups('Break apart', groups);
}

/** Applies a geometry transform to every editable selected shape as one undo step. */
function hasSelectedMachineProgram(): boolean {
  const d = useDoc.getState().design;
  if (!d || !editableSelection().some((id) => d.shapes[id].outline?.params.preserveCommands === true))
    return false;
  toast(
    'This operation changes machine command order. Disable Preserve commands in Advanced settings first, or edit individual needle nodes.',
  );
  return true;
}

function mapSelectedGeoms(label: string, fn: (s: Shape) => PathGeom | null): void {
  if (hasSelectedMachineProgram()) return;
  const d = useDoc.getState().design;
  if (!d) return;
  const changes: [Id, PathGeom][] = [];
  for (const id of editableSelection()) {
    const g = fn(d.shapes[id]);
    if (g) changes.push([id, g]);
  }
  setShapeGeoms(changes, label);
}

export function reversePaths(): void {
  mapSelectedGeoms('Reverse direction', (s) => reverseGeom(s.geom));
}

export function simplifyPaths(tolerance = 0.1): void {
  mapSelectedGeoms('Simplify', (s) => simplifyGeom(s.geom, tolerance));
}

/** Offsets closed shapes by `delta` mm (negative = inset); curves are refitted. */
export function offsetPaths(delta: number): void {
  let emptied = 0;
  mapSelectedGeoms('Offset path', (s) => {
    const poly = makeValid(flattenGeom(s.geom).rings, s.geom.fillRule);
    if (!poly.length) return null;
    const g = polyShapeToGeom(clipperOffset(poly, delta, 'round'));
    if (!g.subpaths.length) {
      emptied++;
      return null;
    }
    return simplifyGeom(g, 0.05);
  });
  if (emptied) toast('The offset would remove the whole shape; it was left unchanged.');
}

/** Converts each selected stroke into a filled shape (stroke → shape). */
export function outlineStroke(): void {
  if (hasSelectedMachineProgram()) return;
  const d = useDoc.getState().design;
  if (!d) return;
  const groups: ReplaceGroup[] = [];
  for (const id of editableSelection()) {
    const s = d.shapes[id];
    const w =
      (typeof s.outline?.params.width === 'number'
        ? (s.outline.params.width as number)
        : s.art.strokeWidth) ?? 1;
    const flat = flattenGeom(s.geom);
    let poly = offsetPolylines(flat.polylines, w / 2, 'round', 'round');
    if (flat.rings.length) {
      const closed = offsetClosedStroke(flat.rings, w / 2);
      poly = poly.length ? [...poly, ...closed] : closed;
    }
    if (!poly.length) continue;
    const g = simplifyGeom(
      polyShapeToGeom(
        makeValid(
          poly.flatMap((p) => [p.outer, ...p.holes]),
          'nonzero',
        ),
      ),
      0.05,
    );
    const threadId = s.outline?.threadId ?? s.fill?.threadId;
    if (!threadId) continue;
    groups.push({
      inputIds: [id],
      zSlotOf: id,
      results: [
        {
          id: newId('s'),
          name: `${s.name} (outline)`,
          geom: g,
          art: { fill: s.art.stroke ?? d.threads[threadId]?.color },
          fill: createElement('fill', 'tatami', threadId),
          outline: null,
        },
      ],
    });
  }
  replaceShapeGroups('Outline stroke', groups);
}

export function closeOrOpenPath(close: boolean): void {
  const nodes = useUi.getState().selection.nodes;
  mapSelectedGeoms(close ? 'Close path' : 'Open path', (s) => {
    let g = s.geom;
    const node = nodes.find((n) => n.shapeId === s.id);
    g.subpaths.forEach((sp, i) => {
      if (close && !sp.closed) g = closePath(g, i);
      if (!close && sp.closed && (!node || node.sub === i))
        g = openPath(g, i, node?.sub === i ? node.idx : undefined);
    });
    return g === s.geom ? null : g;
  });
}

export function joinSelectedEndpoints(): void {
  if (hasSelectedMachineProgram()) return;
  const d = useDoc.getState().design;
  if (!d) return;
  const nodes = useUi.getState().selection.nodes;
  if (nodes.length !== 2 || nodes[0].shapeId !== nodes[1].shapeId) {
    toast('Select two end nodes of the same shape (direct-select tool).');
    return;
  }
  const s = d.shapes[nodes[0].shapeId];
  const end = (n: (typeof nodes)[0]) => ({
    subpathIndex: n.sub,
    end: n.idx === 0 ? ('start' as const) : ('end' as const),
  });
  setShapeGeom(s.id, joinEndpoints(s.geom, end(nodes[0]), end(nodes[1])), 'Join endpoints');
}

// ---------------------------------------------------------------------------- align

export function align(how: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom'): void {
  const d = useDoc.getState().design;
  const ids = useUi.getState().selection.shapeIds;
  if (!d || ids.length < 2) return;
  const all = selectionBBox(d, ids)!;
  const moves: [Id, Matrix][] = [];
  for (const id of ids) {
    const b = selectionBBox(d, [id]);
    if (!b) continue;
    let dx = 0,
      dy = 0;
    if (how === 'left') dx = all.minX - b.minX;
    if (how === 'right') dx = all.maxX - b.maxX;
    if (how === 'hcenter') dx = (all.minX + all.maxX) / 2 - (b.minX + b.maxX) / 2;
    if (how === 'top') dy = all.minY - b.minY;
    if (how === 'bottom') dy = all.maxY - b.maxY;
    if (how === 'vcenter') dy = (all.minY + all.maxY) / 2 - (b.minY + b.maxY) / 2;
    if (Math.abs(dx) > 1e-9 || Math.abs(dy) > 1e-9) moves.push([id, [1, 0, 0, 1, dx, dy]]);
  }
  transformShapesEach(moves, 'Align');
}

export function distribute(axis: 'h' | 'v'): void {
  const d = useDoc.getState().design;
  const ids = useUi.getState().selection.shapeIds;
  if (!d || ids.length < 3) return;
  const items = ids.map((id) => ({ id, b: selectionBBox(d, [id])! })).filter((x) => x.b);
  const c = (b: (typeof items)[0]['b']) => (axis === 'h' ? (b.minX + b.maxX) / 2 : (b.minY + b.maxY) / 2);
  items.sort((a, b) => c(a.b) - c(b.b));
  const first = c(items[0].b),
    last = c(items[items.length - 1].b);
  const moves: [Id, Matrix][] = [];
  items.forEach((it, i) => {
    const target = first + ((last - first) * i) / (items.length - 1);
    const delta = target - c(it.b);
    if (Math.abs(delta) > 1e-9)
      moves.push([it.id, axis === 'h' ? [1, 0, 0, 1, delta, 0] : [1, 0, 0, 1, 0, delta]]);
  });
  transformShapesEach(moves, 'Distribute');
}

// ---------------------------------------------------------------------------- sequence

export async function optimizeSequence(): Promise<void> {
  const d = useDoc.getState().design;
  if (!d) return;
  const seq = optimizeSequenceLocal(d);
  reorderSequence(seq, 'Optimize order');
  toast('Sewing order optimised.', 'success');
}

// ---------------------------------------------------------------------------- view & simulate

export function toggleSimulate(): void {
  const ui = useUi.getState();
  if (ui.sim.active) sim.stop();
  else {
    ui.set({ dragPreview: null, marquee: null });
    sim.start();
  }
}

export { fitDesign };

// ---------------------------------------------------------------------------- backdrop

/**
 * Re-imports the shapes from the SVG artwork backdrop (FR-1.7), replacing every shape, then
 * auto-digitizes them. One undo step for the replacement plus one for auto-digitize.
 */
export async function reimportFromBackdrop(): Promise<void> {
  const d = useDoc.getState().design;
  if (!d?.artwork || d.artwork.kind !== 'svg') return;
  const { importSvg } = await import('@/io/svg-import');
  const { applySvgImport } = await import('./commands/importSvg');
  const { invert, compose } = await import('@/geom/matrix');
  const { transformGeomM } = await import('@/model/geomOps');
  const result = importSvg(d.artwork.svg, {});
  // Map the fresh import (centred at natural size) onto where the backdrop is now.
  const m = compose(d.artwork.matrix as Matrix, invert(result.artwork.matrix));
  for (const s of result.shapes) s.geom = transformGeomM(s.geom, m);
  const artwork = d.artwork;
  let ids: Id[] = [];
  exec('Re-import from backdrop', (draft) => {
    draft.shapes = {};
    draft.zOrder = [];
    draft.sequence = draft.sequence.filter((e) => e.kind === 'stop');
    ids = applySvgImport(draft, result, { replaceArtwork: false });
    draft.artwork = artwork as never;
  });
  const { autoDigitize } = await import('./commands/autoDigitize');
  await autoDigitize({ shapeIds: ids });
}

// ---------------------------------------------------------------------------- stitch settings clipboard

let settingsClip: {
  role: 'fill' | 'outline';
  type: StitchElement['type'];
  params: StitchElement['params'];
  tieIn: StitchElement['tieIn'];
  tieOut: StitchElement['tieOut'];
  trimAfter: StitchElement['trimAfter'];
} | null = null;

/** Copies the stitch type and settings of the first selected element (FR-2.7). */
export function copyStitchSettings(): void {
  const d = useDoc.getState().design;
  if (!d) return;
  const ids = selectedElementIdsLocal(d);
  const el = ids.map((id) => findEl(d, id)).find(Boolean);
  if (!el) {
    toast('Select a fill or outline to copy its settings.');
    return;
  }
  settingsClip = {
    role: el.role,
    type: el.type,
    params: structuredClone(el.params),
    tieIn: el.tieIn,
    tieOut: el.tieOut,
    trimAfter: el.trimAfter,
  };
  toast(`Copied ${el.role} settings.`);
}

export function pasteStitchSettings(): void {
  const d = useDoc.getState().design;
  const clip = settingsClip;
  if (!d || !clip) return;
  const targets = selectedElementIdsLocal(d).filter((id) => findEl(d, id)?.role === clip.role);
  if (!targets.length) {
    toast(`Select ${clip.role === 'fill' ? 'a fill' : 'an outline'} to paste onto.`);
    return;
  }
  exec('Paste stitch settings', (draft) => {
    for (const s of Object.values(draft.shapes)) {
      const el = clip.role === 'fill' ? s.fill : s.outline;
      if (!el || !targets.includes(el.id)) continue;
      el.type = clip.type;
      el.params = structuredClone(clip.params);
      el.tieIn = clip.tieIn;
      el.tieOut = clip.tieOut;
      el.trimAfter = clip.trimAfter;
      el.userEdited = true;
    }
  });
}

export function hasStitchSettingsClip(): boolean {
  return settingsClip !== null;
}

function findEl(d: Design, id: Id): StitchElement | null {
  for (const s of Object.values(d.shapes)) {
    if (s.fill?.id === id) return s.fill;
    if (s.outline?.id === id) return s.outline;
  }
  return null;
}

function selectedElementIdsLocal(d: Design): Id[] {
  const sel = useUi.getState().selection;
  if (sel.elementIds.length) return sel.elementIds;
  return sel.shapeIds.flatMap((sid) => shapeElements(d.shapes[sid]).map((e) => e.id));
}
