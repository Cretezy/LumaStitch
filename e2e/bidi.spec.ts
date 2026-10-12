import { expect, test } from '@playwright/test';
import { openApp, waitIdle } from './helpers';
import { readFile } from 'node:fs/promises';
import { unzipFiles } from '../src/library/zip';
test('edits mixed-direction text, switches paragraph direction and exports mixed-script batches', async ({
  page,
}) => {
  await openApp(page);
  await page.evaluate(async () => {
    await (window as any).__lumastitch.actions.newDesign({ name: 'Mixed scripts' });
  });
  const open = async (edit = false) => {
    await page.getByRole('menuitem', { name: 'Object', exact: true }).click();
    await page
      .getByRole('menuitem', { name: edit ? 'Edit lettering…' : 'Add lettering…', exact: true })
      .click();
  };
  const info = () =>
    page.evaluate(() => {
      const d = (window as any).__lumastitch.useDoc.getState().design,
        g = Object.values(d.lettering)[0] as any;
      return {
        text: g.options.text,
        font: g.options.openType.name,
        direction: g.options.openType.direction,
        clusters: g.options.openType.prepared.lines[0].glyphs.map((p: any) => p.cluster),
      };
    });
  await open();
  await page.getByLabel('Font', { exact: true }).selectOption('Noto Sans Arabic');
  await expect(page.getByLabel('Weight', { exact: true })).toBeVisible();
  await page.getByLabel('Text', { exact: true }).fill('ABC سلام 123');
  await page.getByLabel('Paragraph direction').selectOption('rtl');
  await page.getByRole('button', { name: 'Add lettering', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await waitIdle(page);
  expect((await info()).clusters.slice(0, 3)).toEqual([9, 10, 11]);
  await open(true);
  await page.getByLabel('Paragraph direction').selectOption('ltr');
  await page.getByRole('button', { name: 'Update lettering' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  expect((await info()).clusters.slice(0, 3)).toEqual([0, 1, 2]);
  await page.keyboard.press('ControlOrMeta+z');
  expect((await info()).direction).toBe('rtl');
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await open(true);
  await page.getByLabel('Font', { exact: true }).selectOption('Noto Sans Hebrew');
  await expect(page.getByLabel('Weight', { exact: true })).toBeVisible();
  await page.getByLabel('Text', { exact: true }).fill('Hello שָׁלוֹם (123)');
  await page.getByText('Batch names', { exact: true }).click();
  await page.getByLabel('One name per line (up to 100)').fill('Hello שלום 123\nABC שלום 456');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download batch projects + PES' }).click();
  const files = await unzipFiles(new Uint8Array(await readFile((await (await download).path())!)));
  expect(files.filter((f) => f.name.endsWith('.pes'))).toHaveLength(2);
  const projects = files
    .filter((f) => f.name.endsWith('.lumastitch'))
    .map((f) => JSON.parse(new TextDecoder().decode(f.data)));
  expect(projects.map((p) => p.design.lettering.text.options.text)).toEqual([
    'Hello שלום 123',
    'ABC שלום 456',
  ]);
  await page.getByRole('button', { name: 'Update lettering' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await waitIdle(page);
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
        return JSON.stringify(value).includes('Hello שָׁלוֹם (123)');
      }),
    )
    .toBe(true);
  await page.reload();
  await page.waitForFunction(() => (window as any).__lumastitch?.useDoc.getState().design?.lettering);
  expect((await info()).text).toBe('Hello שָׁלוֹם (123)');
});
