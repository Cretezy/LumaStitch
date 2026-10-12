import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { openApp, waitIdle } from './helpers';

test('reviews recognition candidates, converts selectively, undoes and persists editable objects', async ({
  page,
}) => {
  await openApp(page);
  const project = await readFile('docs/recognition/before/before.lumastitch', 'utf8');
  await page.evaluate(async (project) => {
    const L = (window as any).__lumastitch;
    await L.actions.handleFile(new File([project], 'imported.lumastitch'));
    L.useUi
      .getState()
      .setSelection({ shapeIds: L.useDoc.getState().design.zOrder, elementIds: [], nodes: [] });
  }, project);
  const info = () =>
    page.evaluate(() => {
      const d = (window as any).__lumastitch.useDoc.getState().design;
      return Object.values(d.shapes).map((s: any) => (s.fill ?? s.outline).type);
    });
  const open = async () => {
    await page.getByRole('menuitem', { name: 'Object', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Recognize stitches…', exact: true }).click();
    await expect(page.getByRole('img', { name: 'Imported stitches and inferred objects' })).toBeVisible();
  };
  await open();
  await expect(page.getByRole('checkbox')).toHaveCount(2);
  await page.getByRole('checkbox', { name: /Tatami fill/ }).uncheck();
  await page.getByRole('button', { name: 'Convert 1 object', exact: true }).click();
  await waitIdle(page);
  expect((await info()).filter((t) => t !== 'manual')).toEqual(['satinColumn']);
  await page.keyboard.press('ControlOrMeta+z');
  await waitIdle(page);
  expect((await info()).every((t) => t === 'manual')).toBe(true);
  await open();
  await page.getByRole('button', { name: 'Convert 2 objects', exact: true }).click();
  await waitIdle(page);
  expect((await info()).filter((t) => t !== 'manual')).toEqual(['satinColumn', 'tatami']);
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const L = (window as any).__lumastitch;
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const r = indexedDB.open('lumastitch-designs');
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(r.error);
        });
        const value = await new Promise<any>((resolve, reject) => {
          const r = db.transaction('designs').objectStore('designs').get(L.useDoc.getState().designId);
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(r.error);
        });
        db.close();
        return JSON.stringify(value).includes('satinColumn') && JSON.stringify(value).includes('tatami');
      }),
    )
    .toBe(true);
  await page.reload();
  await page.waitForFunction(() => (window as any).__lumastitch?.useDoc.getState().design);
  await waitIdle(page);
  expect((await info()).filter((t) => t !== 'manual')).toEqual(['satinColumn', 'tatami']);
});
