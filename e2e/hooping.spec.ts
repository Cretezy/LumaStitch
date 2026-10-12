import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { openApp } from './helpers';
import { unzipFiles } from '../src/library/zip';

test('multi-hooping preview and numbered machine package preserve layout settings', async ({ page }) => {
  await openApp(page);
  const project = await readFile('docs/hooping/source-banner/source-banner.lumastitch', 'utf8');
  await page.evaluate(async (project) => {
    await (window as any).__lumastitch.actions.handleFile(new File([project], 'banner.lumastitch'));
  }, project);
  await page.getByRole('menuitem', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Multi-hooping export…' }).click();
  await page.getByRole('button', { name: 'Calculate hoopings' }).click();
  await expect(
    page.getByRole('img', { name: 'Numbered hooping layout with shared registration marks' }),
  ).toBeVisible();
  await expect(page.getByText(/3 hoopings ·/)).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download hooping ZIP' }).click();
  const file = await download,
    entries = await unzipFiles(new Uint8Array(await readFile((await file.path())!)));
  expect(entries.filter((e) => e.name.endsWith('.pes'))).toHaveLength(3);
  expect(entries.filter((e) => e.name.endsWith('.lumastitch'))).toHaveLength(4);
  const manifest = JSON.parse(
    new TextDecoder().decode(entries.find((e) => e.name === 'manifest.json')!.data),
  );
  expect(manifest.hoopings.map((p: any) => p.number)).toEqual([1, 2, 3]);
  await page.getByRole('button', { name: 'Close', exact: true }).first().click();
  await page.waitForTimeout(1600);
  await page.reload();
  await page.waitForFunction(() => (window as any).__lumastitch?.useDoc.getState().design);
  expect(await page.evaluate(() => (window as any).__lumastitch.useDoc.getState().design.multiHoop)).toEqual({
    width: 100,
    height: 100,
    margin: 3,
    overlap: 12,
  });
});
