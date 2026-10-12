import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { openApp, waitIdle } from './helpers';
import { unzipFiles } from '../src/library/zip';

test('edits hoop positions and rotations, validates coverage, exports and retains settings through undo and reload', async ({
  page,
}) => {
  await openApp(page);
  const project = JSON.parse(
    await readFile('docs/hooping-placements/source-ribbon/source-ribbon.lumastitch', 'utf8'),
  );
  delete project.design.multiHoop;
  await page.evaluate(async (p) => {
    await (window as any).__lumastitch.actions.handleFile(new File([JSON.stringify(p)], 'ribbon.lumastitch'));
  }, project);
  await waitIdle(page);
  await page.getByRole('menuitem', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Multi-hooping export…' }).click();
  await page.getByRole('button', { name: 'Calculate hoopings' }).click();
  await expect(page.getByText(/9 hoopings ·/)).toBeVisible();
  await page.getByRole('button', { name: 'Optimize field angle' }).click();
  await expect(page.getByText(/3 hoopings ·/)).toBeVisible();
  await page.getByRole('button', { name: 'Use automatic grid' }).click();
  await page.getByRole('button', { name: 'Calculate hoopings' }).click();
  await expect(page.getByText(/9 hoopings ·/)).toBeVisible();
  await page.getByRole('button', { name: 'Edit calculated placements' }).click();
  for (let i = 9; i > 3; i--)
    await page.getByRole('button', { name: `Remove hoop ${i}`, exact: true }).click();
  const values = [
    [28, 28, 45],
    [85, 85, 40],
    [142, 142, 50],
  ];
  for (let i = 0; i < 3; i++)
    for (const [j, key] of ['x', 'y', 'angle'].entries()) {
      const input = page.getByRole('textbox', { name: `Hoop ${i + 1} ${key}`, exact: true });
      await input.fill(String(values[i][j]));
      await input.press('Enter');
    }
  const preview = page.getByRole('img', { name: 'Editable hoop placements over design artwork' });
  await expect(preview).toBeVisible();
  await expect.poll(() => preview.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  const x = page.getByRole('textbox', { name: 'Hoop 1 x', exact: true });
  await x.fill('50');
  await x.press('Enter');
  await page.getByRole('button', { name: 'Calculate hoopings' }).click();
  await expect(page.getByRole('alert')).toContainText(/outside every hoop/);
  await expect(page.getByRole('button', { name: 'Download hooping ZIP' })).toBeDisabled();
  await x.fill('28');
  await x.press('Enter');
  await page.getByRole('button', { name: 'Calculate hoopings' }).click();
  await expect(page.getByText(/3 hoopings ·/)).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download hooping ZIP' }).click();
  const entries = await unzipFiles(new Uint8Array(await readFile((await (await download).path())!)));
  const manifest = JSON.parse(
    new TextDecoder().decode(entries.find((e) => e.name === 'manifest.json')!.data),
  );
  expect(manifest.hoopings.map((p: any) => p.clockwiseDegrees)).toEqual([45, 40, 50]);
  expect(manifest.hoopings.map((p: any) => p.registrationParent)).toEqual([null, 1, 2]);
  await page.getByRole('button', { name: 'Close', exact: true }).first().click();
  await page.evaluate(() => (window as any).__lumastitch.useDoc.getState().undo());
  expect(
    await page.evaluate(() => (window as any).__lumastitch.useDoc.getState().design.multiHoop.placements),
  ).toBeUndefined();
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
        return JSON.stringify(value).includes('"angle":50');
      }),
    )
    .toBe(true);
  await page.reload();
  await page.waitForFunction(() => (window as any).__lumastitch?.useDoc.getState().design);
  expect(
    await page.evaluate(() =>
      (window as any).__lumastitch.useDoc.getState().design.multiHoop.placements.map((p: any) => p.angle),
    ),
  ).toEqual([45, 40, 50]);
});
