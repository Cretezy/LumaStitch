import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { openApp, planStats, waitIdle } from './helpers';
import { unzipFiles } from '../src/library/zip';
test('pre-cut applique stages, partial coverage and numbered cutting export', async ({ page }) => {
  await openApp(page);
  const project = await readFile('docs/applique/before/before.lumastitch', 'utf8');
  await page.evaluate(async (project) => {
    const L = (window as any).__lumastitch;
    await L.actions.handleFile(new File([project], 'patches.lumastitch'));
    L.useUi.getState().setSelection({ shapeIds: ['lower'], elementIds: ['lower-fill'], nodes: [] });
  }, project);
  await waitIdle(page);
  expect((await planStats(page)).stops).toBe(4);
  await page.getByRole('switch', { name: 'Pre-cut fabric', exact: true }).click();
  await waitIdle(page);
  expect((await planStats(page)).stops).toBe(3);
  const before = await planStats(page);
  await page.getByRole('button', { name: 'Advanced', exact: true }).click();
  await page.getByRole('switch', { name: 'Omit covered satin', exact: true }).click();
  await waitIdle(page);
  expect((await planStats(page)).stitches).toBeLessThan(before.stitches);
  await page.keyboard.press('ControlOrMeta+z');
  await waitIdle(page);
  expect((await planStats(page)).stitches).toBe(before.stitches);
  await page.getByRole('menuitem', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Appliqué cutting export…' }).click();
  await page.getByRole('switch', { name: 'Mirror fabric pieces', exact: true }).click();
  await page.getByRole('button', { name: 'Prepare cutting package' }).click();
  await expect(page.getByRole('img', { name: 'Numbered appliqué cutting layout' })).toBeVisible();
  await expect(page.getByText(/2 fabric pieces ·/)).toBeVisible();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download cutting ZIP' }).click();
  const file = await downloaded,
    entries = await unzipFiles(new Uint8Array(await readFile((await file.path())!)));
  expect(entries.filter((e) => /^piece.*\.dxf$/.test(e.name))).toHaveLength(2);
  const manifest = JSON.parse(
    new TextDecoder().decode(entries.find((e) => e.name === 'manifest.json')!.data),
  );
  expect(manifest.options.mirror).toBe(true);
  expect(manifest.pieces[0].holes).toBe(1);
  expect(
    await page.evaluate(() => (window as any).__lumastitch.useDoc.getState().design.appliqueCut.mirror),
  ).toBe(true);
  await page.getByRole('button', { name: 'Close', exact: true }).first().click();
  await waitIdle(page);
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const id = (window as any).__lumastitch.useDoc.getState().designId;
          return await new Promise<boolean>((resolve, reject) => {
            const request = indexedDB.open('lumastitch-designs');
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
              const db = request.result;
              const get = db.transaction('designs').objectStore('designs').get(id);
              get.onsuccess = () => {
                resolve(get.result?.appliqueCut?.mirror);
                db.close();
              };
              get.onerror = () => reject(get.error);
            };
          });
        }),
      { timeout: 10000 },
    )
    .toBe(true);
  await page.reload();
  await page.waitForFunction(() => (window as any).__lumastitch?.useDoc.getState().design);
  expect(
    await page.evaluate(() => (window as any).__lumastitch.useDoc.getState().design.appliqueCut.mirror),
  ).toBe(true);
});
