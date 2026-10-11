import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { openApp, waitIdle } from './helpers';
test('creates lettering on a path and reflows a dragged baseline node with undo and persistence', async ({
  page,
}) => {
  await openApp(page);
  const file = JSON.parse(await readFile('docs/lettering-path/curve/curve.lumastitch', 'utf8')),
    g = file.design.lettering.text,
    sid = g.baselineShapeId;
  file.design.shapes = { [sid]: file.design.shapes[sid] };
  file.design.zOrder = [sid];
  file.design.sequence = [];
  delete file.design.lettering;
  await page.evaluate(
    async ({ project, sid }) => {
      const L = (window as any).__lumastitch;
      await L.actions.handleFile(new File([project], 'baseline.lumastitch'));
      L.useUi.getState().setSelection({ shapeIds: [sid], elementIds: [], nodes: [] });
    },
    { project: JSON.stringify(file), sid },
  );
  await page.getByRole('menuitem', { name: 'Object', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Add lettering on path…' }).click();
  await page.getByRole('textbox', { name: 'Text', exact: true }).fill('Luma');
  await page.getByRole('button', { name: 'Add lettering', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await waitIdle(page);
  const get = () =>
    page.evaluate(() => {
      const d = (window as any).__lumastitch.useDoc.getState().design;
      const [id, g] = Object.entries(d.lettering)[0] as [string, any];
      return { id, g, letter: d.shapes[g.shapeIds[0]].geom, baseline: d.shapes[g.baselineShapeId].geom };
    });
  const before = await get();
  expect(before.g.baselineShapeId).not.toBe(sid);
  await page.getByRole('menuitem', { name: 'Object', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Edit lettering baseline', exact: true }).click();
  await page.waitForFunction(() => (window as any).__lumastitch.useUi.getState().tool === 'direct');
  const box = (await page.getByTestId('canvas').boundingBox())!,
    v = await page.evaluate(() => (window as any).__lumastitch.useUi.getState().viewport),
    p = before.baseline.subpaths[0].nodes[1].p;
  await page.mouse.move(box.x + p[0] * v.zoom + v.pan[0], box.y + p[1] * v.zoom + v.pan[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + p[0] * v.zoom + v.pan[0], box.y + (p[1] + 4) * v.zoom + v.pan[1], {
    steps: 6,
  });
  await page.mouse.up();
  await waitIdle(page);
  const after = await get();
  expect(after.g.options.text).toBe('Luma');
  expect(after.baseline.subpaths[0].nodes[0].p).toEqual(before.baseline.subpaths[0].nodes[0].p);
  expect(after.baseline.subpaths[0].nodes[2].p).toEqual(before.baseline.subpaths[0].nodes[2].p);
  expect(after.letter).not.toEqual(before.letter);
  expect(after.baseline.subpaths[0].nodes[1].p[1]).toBeCloseTo(p[1] + 4, 1);
  await page.keyboard.press('ControlOrMeta+z');
  await waitIdle(page);
  expect((await get()).letter).toEqual(before.letter);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await waitIdle(page);
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const L = (window as any).__lumastitch,
            id = L.useDoc.getState().designId;
          return await new Promise<string>((resolve, reject) => {
            const r = indexedDB.open('lumastitch-designs');
            r.onerror = () => reject(r.error);
            r.onsuccess = () => {
              const db = r.result,
                q = db.transaction('designs').objectStore('designs').get(id);
              q.onsuccess = () => {
                resolve(JSON.stringify(q.result?.lettering));
                db.close();
              };
            };
          });
        }),
      { timeout: 10000 },
    )
    .toBe(JSON.stringify({ [after.id]: after.g }));
  await page.reload();
  await page.waitForFunction(() => (window as any).__lumastitch?.useDoc.getState().design);
  await waitIdle(page);
  expect((await get()).g).toEqual(after.g);
});
