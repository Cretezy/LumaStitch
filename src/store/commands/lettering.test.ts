// SPDX-License-Identifier: GPL-3.0-or-later
import { beforeEach, expect, it } from 'vitest';
import { DEFAULT_LETTERING } from '@/lettering/layout';
import { createDesign } from '@/model/factories';
import { parseProjectFile, serializeProject } from '@/model/schema';
import { translate } from '@/geom/matrix';
import { useDoc } from '../documentStore';
import { useUi } from '../uiStore';
import { deleteShapes, setShapeGeom, transformShapes } from './index';
import { selectedLetteringId, setLettering } from './lettering';

beforeEach(() => {
  useUi.getState().setSim({ active: false });
  useDoc.getState().load(createDesign(), 'test');
});
it('edits text as one undo step and round-trips its editable definition', () => {
  const id = setLettering({ ...DEFAULT_LETTERING, text: 'AV' }, '#123456');
  const before = useDoc.getState().design!;
  expect(selectedLetteringId()).toBe(id);
  setLettering({ ...DEFAULT_LETTERING, text: 'Test' }, '#123456', id);
  const after = useDoc.getState().design!;
  expect(after.lettering![id].options.text).toBe('Test');
  expect(parseProjectFile(serializeProject(after))).toEqual(after);
  useDoc.getState().undo();
  expect(useDoc.getState().design).toEqual(before);
  useDoc.getState().redo();
  expect(useDoc.getState().design).toEqual(after);
});
it('keeps whole-block transforms when text changes and detaches partial geometry edits', () => {
  const id = setLettering({ ...DEFAULT_LETTERING, text: 'AB' }, '#123456');
  transformShapes(useDoc.getState().design!.lettering![id].shapeIds, translate(23, 17));
  expect(useDoc.getState().design!.lettering![id].matrix).toEqual(translate(23, 17));
  setLettering({ ...DEFAULT_LETTERING, text: 'BA' }, '#123456', id);
  expect(useDoc.getState().design!.lettering![id].matrix).toEqual(translate(23, 17));
  const shapeId = useDoc.getState().design!.lettering![id].shapeIds[0];
  const geom = structuredClone(useDoc.getState().design!.shapes[shapeId].geom);
  geom.subpaths[0].nodes[0].p[0] += 1;
  setShapeGeom(shapeId, geom);
  expect(useDoc.getState().design!.lettering![id]).toBeUndefined();
  useDoc.getState().undo();
  expect(useDoc.getState().design!.lettering![id]).toBeDefined();
  deleteShapes([shapeId]);
  expect(useDoc.getState().design!.lettering![id]).toBeUndefined();
});
