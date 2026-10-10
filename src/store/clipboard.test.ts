import { afterEach, expect, it, vi } from 'vitest';
import { createDesign, createElement, createShape, createThread } from '@/model/factories';
import { rectGeom } from '@/geom/shapes';
import { useDoc } from './documentStore';
import { useUi } from './uiStore';
import { cutSelection, paste } from './actions';

vi.mock('@/canvas/CanvasView', () => ({ fitDesign: vi.fn() }));
vi.mock('@/simulator/controller', () => ({ sim: { stop: vi.fn() } }));
vi.mock('@/io/project/autosave', () => ({ flushAutosave: vi.fn() }));

afterEach(() => vi.unstubAllGlobals());

it('cuts the copied shapes when selection changes while clipboard permission is pending', async () => {
  const d = createDesign();
  const a = createShape('Copied', rectGeom(0, 0, 5, 5));
  const b = createShape('Selected later', rectGeom(10, 0, 5, 5));
  d.shapes = { [a.id]: a, [b.id]: b };
  d.zOrder = [a.id, b.id];
  useDoc.getState().load(d, 'cut-review');
  useUi.getState().setSelection({ shapeIds: [a.id], elementIds: [], nodes: [] });
  let release!: () => void;
  vi.stubGlobal('navigator', {
    clipboard: {
      writeText: () =>
        new Promise<void>((r) => {
          release = r;
        }),
    },
  });
  const cutting = cutSelection();
  useUi.getState().setSelection({ shapeIds: [b.id], elementIds: [], nodes: [] });
  release();
  await cutting;
  expect(useDoc.getState().design!.shapes[b.id]).toBeDefined();
  expect(useDoc.getState().design!.shapes[a.id]).toBeUndefined();
  vi.unstubAllGlobals();
});

it('does not paste missing-thread shapes into a design opened while reading the clipboard', async () => {
  const d = createDesign();
  const t = createThread('#ff0000');
  d.threads[t.id] = t;
  const s = createShape('Pasted shape', rectGeom(0, 0, 5, 5));
  s.fill = createElement('fill', 'tatami', t.id);
  useDoc.getState().load(d, 'old-document');
  let release!: (text: string) => void;
  vi.stubGlobal('navigator', {
    clipboard: {
      readText: () =>
        new Promise<string>((r) => {
          release = r;
        }),
    },
  });
  const pasting = paste();
  useDoc.getState().load(createDesign(), 'new-document');
  release(JSON.stringify({ format: 'lumastitch-clip', shapes: [s], threads: [t] }));
  await pasting;
  const after = useDoc.getState().design!;
  expect(after.zOrder).toEqual([]);
  for (const shape of Object.values(after.shapes))
    if (shape.fill) expect(after.threads[shape.fill.threadId]).toBeDefined();
  vi.unstubAllGlobals();
});

it.each(['edit', 'switch'] as const)('cancels a pending cut after a document %s', async (change) => {
  const d = createDesign();
  const s = createShape('Original', rectGeom(0, 0, 5, 5));
  d.shapes[s.id] = s;
  d.zOrder.push(s.id);
  useDoc.getState().load(d, 'cut-source');
  useUi.getState().setSelection({ shapeIds: [s.id], elementIds: [], nodes: [] });
  let release!: () => void;
  vi.stubGlobal('navigator', {
    clipboard: {
      writeText: () =>
        new Promise<void>((r) => {
          release = r;
        }),
    },
  });
  const cutting = cutSelection();
  if (change === 'edit')
    useDoc.getState().exec('Rename', (draft) => {
      draft.shapes[s.id].name = 'Edited';
    });
  else useDoc.getState().load(structuredClone(d), 'cut-destination');
  const before = useDoc.getState().design;
  release();
  await cutting;
  expect(useDoc.getState().design).toBe(before);
});

it.each([false, true])(
  'pastes valid threads and supports undo, unless the document changed: %s',
  async (edit) => {
    const d = createDesign();
    const t = createThread('#ff0000');
    const s = createShape('Paste', rectGeom(0, 0, 5, 5));
    s.fill = createElement('fill', 'tatami', t.id);
    useDoc.getState().load(d, 'paste-destination');
    let release!: (text: string) => void;
    vi.stubGlobal('navigator', {
      clipboard: {
        readText: () =>
          new Promise<string>((r) => {
            release = r;
          }),
      },
    });
    const pasting = paste();
    if (edit)
      useDoc.getState().exec('Rename', (draft) => {
        draft.name = 'Edited';
      });
    const before = useDoc.getState().design;
    release(JSON.stringify({ format: 'lumastitch-clip', shapes: [s], threads: [t] }));
    await pasting;
    const after = useDoc.getState().design!;
    if (edit) expect(after).toBe(before);
    else {
      expect(after.zOrder).toHaveLength(1);
      const pasted = after.shapes[after.zOrder[0]];
      expect(after.threads[pasted.fill!.threadId].color).toBe(t.color);
      useDoc.getState().undo();
      expect(useDoc.getState().design).toBe(before);
    }
  },
);
