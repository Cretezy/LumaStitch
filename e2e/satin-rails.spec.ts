import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { openApp, waitIdle } from './helpers';
test('groups variable-width satin rails, supports undo/reload and restores separate editable columns', async ({
  page,
}) => {
  await openApp(page);
  await page.evaluate(
    async (project) => {
      const L = (window as any).__lumastitch;
      await L.actions.handleFile(new File([project], 'vine.lumastitch'));
      L.useUi
        .getState()
        .setSelection({ shapeIds: L.useDoc.getState().design.zOrder, elementIds: [], nodes: [] });
    },
    await readFile('docs/satin-rails/before/before.lumastitch', 'utf8'),
  );
  await waitIdle(page);
  const info = () =>
    page.evaluate(() => {
      const L = (window as any).__lumastitch,
        d = L.useDoc.getState().design;
      return {
        shapes: d.zOrder.length,
        groups: d.shapes[d.zOrder[0]].outline?.satinGroups,
        trims: L.usePlan.getState().plan.stats.trims,
      };
    });
  expect((await info()).trims).toBe(3);
  await page.getByRole('menuitem', { name: 'Object', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Group satin rails for routing', exact: true }).click();
  await waitIdle(page);
  expect((await info()).shapes).toBe(1);
  expect((await info()).trims).toBe(0);
  expect((await info()).groups).toHaveLength(7);
  await page.keyboard.press('ControlOrMeta+z');
  await waitIdle(page);
  expect((await info()).shapes).toBe(7);
  expect((await info()).trims).toBe(3);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await waitIdle(page);
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const id = (window as any).__lumastitch.useDoc.getState().designId;
        return await new Promise<number | undefined>((resolve, reject) => {
          const r = indexedDB.open('lumastitch-designs');
          r.onerror = () => reject(r.error);
          r.onsuccess = () => {
            const db = r.result,
              q = db.transaction('designs').objectStore('designs').get(id);
            q.onsuccess = () => {
              resolve(q.result?.shapes?.[q.result?.zOrder?.[0]]?.outline?.satinGroups?.length);
              db.close();
            };
          };
        });
      }),
    )
    .toBe(7);
  await page.reload();
  await page.waitForFunction(
    () => (window as any).__lumastitch?.useDoc.getState().design?.zOrder?.length === 1,
  );
  await waitIdle(page);
  expect((await info()).trims).toBe(0);
  await page.evaluate(() => {
    const L = (window as any).__lumastitch;
    L.useUi
      .getState()
      .setSelection({ shapeIds: L.useDoc.getState().design.zOrder, elementIds: [], nodes: [] });
  });
  await page.getByRole('menuitem', { name: 'Object', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Ungroup satin rails', exact: true }).click();
  await waitIdle(page);
  expect((await info()).shapes).toBe(7);
  expect((await info()).groups).toBeUndefined();
  expect((await info()).trims).toBe(3);
});
