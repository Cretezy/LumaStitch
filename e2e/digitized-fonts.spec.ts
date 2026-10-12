import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { unzipFiles } from '../src/library/zip';
import { openApp, waitIdle } from './helpers';
test('switches digitized styles with size limits, monograms, licensed batches, undo and persistence', async ({
  page,
}) => {
  await openApp(page);
  await page.evaluate(async () => (window as any).__lumastitch.actions.newDesign({ name: 'Font styles' }));
  const open = async (edit = false) => {
    await page.getByRole('menuitem', { name: 'Object', exact: true }).click();
    await page
      .getByRole('menuitem', { name: edit ? 'Edit lettering…' : 'Add lettering…', exact: true })
      .click();
  };
  const options = () =>
    page.evaluate(
      () =>
        (Object.values((window as any).__lumastitch.useDoc.getState().design.lettering)[0] as any).options,
    );
  await open();
  await page.getByLabel('Font', { exact: true }).selectOption('geneva-rounded');
  await expect(page.getByLabel('Capital height (mm)')).toHaveValue('10.5');
  await page.getByLabel('Text', { exact: true }).fill('ABC');
  await page.getByRole('button', { name: 'Add lettering', exact: true }).click();
  await waitIdle(page);
  expect((await options()).font).toBe('geneva-rounded');
  await open(true);
  await page.getByLabel('Font', { exact: true }).selectOption('chopin');
  await expect(page.getByLabel('Capital height (mm)')).toHaveValue('30.64');
  await page.getByRole('checkbox', { name: /Three-letter monogram/ }).check();
  await expect(page.getByLabel('Capital height (mm)')).toHaveValue('40.86');
  await page.getByText('Batch names', { exact: true }).click();
  await page.getByLabel('One name per line (up to 100)').fill('ABC\nXYZ');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download batch projects + PES' }).click();
  const entries = await unzipFiles(new Uint8Array(await readFile((await (await download).path())!)));
  expect(entries.filter((e) => e.name.endsWith('.pes'))).toHaveLength(2);
  expect(new TextDecoder().decode(entries.find((e) => e.name === 'licenses/chopin.txt')!.data)).toContain(
    'Célia Imbert Sabater',
  );
  await page.getByRole('button', { name: 'Update lettering', exact: true }).click();
  await waitIdle(page);
  expect((await options()).font).toBe('chopin');
  await page.keyboard.press('ControlOrMeta+z');
  expect((await options()).font).toBe('geneva-rounded');
  await page.keyboard.press('ControlOrMeta+Shift+z');
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
        return JSON.stringify(value).includes('chopin');
      }),
    )
    .toBe(true);
  await page.reload();
  await page.waitForFunction(() => (window as any).__lumastitch?.useDoc.getState().design?.lettering);
  expect((await options()).font).toBe('chopin');
  expect((await options()).height).toBe(40.86);
});
