/** Acceptance 7: undo and redo restore the exact previous document for every command. */
import { describe, expect, it } from 'vitest';
import { useDoc } from '@/store/documentStore';
import { useUi } from '@/store/uiStore';
import * as C from '@/store/commands';
import { createDesign, createElement, createShape, createThread } from '@/model/factories';
import { checkInvariants } from '@/model/invariants';
import { ellipseGeom, polylineGeom, rectGeom } from '@/geom/shapes';
import { rotateScreen, translate } from '@/geom/matrix';
import { applySvgImport } from '@/store/commands/importSvg';
import type { Design } from '@/model/types';

const snap = () => JSON.stringify(useDoc.getState().design);

describe('undo/redo', () => {
  it('every command undoes and redoes exactly, keeping invariants', () => {
    useDoc.getState().load(createDesign({ name: 'Undo test' }), 'test');
    const t = createThread('#aa0000');
    const t2 = createThread('#0000aa');
    const a = createShape('A', rectGeom(0, 0, 20, 10), { fill: '#aa0000' });
    a.fill = createElement('fill', 'tatami', t.id);
    const b = createShape('B', ellipseGeom(30, 5, 8), { fill: '#0000aa' });
    b.fill = createElement('fill', 'tatami', t2.id);
    const c = createShape(
      'C',
      polylineGeom([
        [0, 20],
        [30, 20],
      ]),
      { stroke: '#aa0000', strokeWidth: 2 },
    );
    c.outline = createElement('outline', 'running', t.id);

    const steps: [string, () => void][] = [
      ['addShapes', () => C.addShapes('Add', { shapes: [a, b, c], threads: [t, t2] })],
      ['transform', () => C.transformShapes([a.id], translate(3, 4))],
      ['rotate', () => C.transformShapes([b.id], rotateScreen(30, 30, 5))],
      ['setParams', () => C.setParams([a.fill!.id], { density: 0.3, angle: 10 })],
      ['resetParam', () => C.resetParam([a.fill!.id], 'density')],
      ['setElementType', () => C.setElementType([c.outline!.id], 'satin')],
      ['setElementEnabled on', () => C.setElementEnabled([a.id], 'outline', true)],
      ['setElementEnabled off', () => C.setElementEnabled([b.id], 'fill', false)],
      [
        'setElementProps',
        () => C.setElementProps([a.fill!.id], { tieIn: 'on', trimAfter: 'always', entry: [1, 1] }),
      ],
      ['arrange', () => C.arrange([a.id], 'front')],
      ['moveElements', () => C.moveElements([c.outline!.id], 'start')],
      ['insertStop', () => void C.insertStop(1, 'test')],
      [
        'removeStop',
        () => {
          const st = useDoc.getState().design!.sequence.find((e) => e.kind === 'stop')!;
          C.removeStop((st as { id: string }).id);
        },
      ],
      ['upsertThread', () => C.upsertThread({ ...t, color: '#cc3300', name: 'Rust' })],
      ['assignNewThread', () => C.assignNewThread([c.outline!.id], { name: 'Green', color: '#00aa00' })],
      ['deleteThread (merge)', () => C.deleteThread(t2.id, t.id)],
      ['duplicate', () => void C.duplicateShapes([a.id])],
      ['setShapeProps', () => C.setShapeProps([c.id], { hidden: true, name: 'Line' })],
      ['setShapeGeom', () => C.setShapeGeom(a.id, rectGeom(0, 0, 25, 12))],
      ['setDesignSettings', () => C.setDesignSettings({ trimThreshold: 5 })],
      ['setDesignProps', () => C.setDesignProps({ fabric: 'knit', name: 'Renamed' })],
      ['resizeDesign', () => C.resizeDesign(100)],
      [
        'svg import',
        () =>
          useDoc.getState().exec('Import SVG', (d) => {
            applySvgImport(
              d as Design,
              {
                shapes: [createShape('Imported', rectGeom(50, 50, 5, 5), { fill: '#123456' })],
                threads: [],
                warnings: [],
                artwork: {
                  kind: 'svg',
                  svg: '<svg/>',
                  matrix: [1, 0, 0, 1, 0, 0],
                  visible: true,
                  opacity: 0.35,
                },
                naturalSize: { width: 5, height: 5 },
                size: { width: 5, height: 5 },
              } as never,
            );
          }),
      ],
      ['deleteShapes', () => C.deleteShapes([b.id])],
      [
        'add unused thread',
        () => C.upsertThread({ id: 'unused', name: 'Spare', color: '#777777' }, 'Add thread'),
      ],
      ['purgeUnusedThreads', () => C.purgeUnusedThreads()],
    ];
    const history: string[] = [snap()];
    for (const [name, run] of steps) {
      run();
      const s = snap();
      expect(s, `${name} changed the document`).not.toBe(history[history.length - 1]);
      expect(checkInvariants(useDoc.getState().design!), name).toEqual([]);
      history.push(s);
    }
    for (let i = history.length - 2; i >= 0; i--) {
      useDoc.getState().undo();
      expect(snap(), `undo to step ${i}`).toBe(history[i]);
    }
    for (let i = 1; i < history.length; i++) {
      useDoc.getState().redo();
      expect(snap(), `redo to step ${i}`).toBe(history[i]);
    }
    expect(useUi.getState().selection).toBeTruthy();
  });

  it('history is capped at 200 entries', () => {
    useDoc.getState().load(createDesign(), 'cap');
    for (let i = 0; i < 230; i++) C.setDesignSettings({ trimThreshold: 1 + i * 0.01 });
    expect(useDoc.getState().past.length).toBe(200);
  });
});
