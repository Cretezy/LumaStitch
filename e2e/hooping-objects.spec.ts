import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { openApp, waitIdle } from './helpers';
import { unzipFiles } from '../src/library/zip';
test('keeps fitting objects together through export, undo and project persistence', async ({ page }) => {
  await openApp(page);
  const project = JSON.parse(
    await readFile('docs/hooping-objects/source-panel/source-panel.lumastitch', 'utf8'),
  );
  project.design.multiHoop.keepObjects = false;
  await page.evaluate(async (p) => {
    await (window as any).__lumastitch.actions.handleFile(
      new File([JSON.stringify(p)], 'medallions.lumastitch'),
    );
  }, project);
  await waitIdle(page);
  await page.getByRole('menuitem', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Multi-hooping export…' }).click();
  await page.getByRole('button', { name: 'Calculate hoopings' }).click();
  await expect(page.getByText(/3 hoopings ·/)).toBeVisible();
  await page.getByRole('switch', { name: 'Keep whole objects when they fit' }).click();
  await expect(page.getByRole('button', { name: 'Download hooping ZIP' })).toBeDisabled();
  await page.getByRole('button', { name: 'Calculate hoopings' }).click();
  await expect(page.getByText(/2 objects kept whole/)).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download hooping ZIP' }).click();
  const files = await unzipFiles(new Uint8Array(await readFile((await (await download).path())!))),
    manifest = JSON.parse(new TextDecoder().decode(files.find((f) => f.name === 'manifest.json')!.data));
  expect(
    manifest.hoopings
      .flatMap((p: any) => p.wholeObjects)
      .map((p: any) => p.name)
      .sort(),
  ).toEqual(['Medallion 1', 'Medallion 2']);
  await page.getByRole('button', { name: 'Close', exact: true }).first().click();
  await page.evaluate(() => (window as any).__lumastitch.useDoc.getState().undo());
  expect(
    await page.evaluate(() => (window as any).__lumastitch.useDoc.getState().design.multiHoop.keepObjects),
  ).toBe(false);
  await page.evaluate(() => (window as any).__lumastitch.useDoc.getState().redo());
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const L = (window as any).__lumastitch,
          db = await new Promise<IDBDatabase>((resolve, reject) => {
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
        return JSON.stringify(value).includes('"keepObjects":true');
      }),
    )
    .toBe(true);
  await page.reload();
  await page.waitForFunction(() => (window as any).__lumastitch?.useDoc.getState().design);
  expect(
    await page.evaluate(() => (window as any).__lumastitch.useDoc.getState().design.multiHoop.keepObjects),
  ).toBe(true);
});
