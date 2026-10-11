import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { importFile, openApp, waitIdle } from './helpers';

test('save, apply and download a portable fabric calibration profile', async ({ page }) => {
  await openApp(page);
  await importFile(page, 'svg/basic-shapes.svg', 'image/svg+xml');
  await page.getByRole('dialog').getByRole('button', { name: 'Import', exact: true }).click();
  await waitIdle(page);
  await page.getByRole('menuitem', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Design settings…' }).click();
  await page.getByText('Custom fabric profiles', { exact: true }).click();
  await page.getByLabel('Profile name', { exact: true }).fill('Cotton sew-out A');
  await page.getByRole('textbox', { name: 'Profile fill spacing', exact: true }).fill('0.75');
  await page.getByRole('textbox', { name: 'Profile fill spacing', exact: true }).press('Enter');
  await page
    .getByRole('textbox', { name: 'Profile stabilizer', exact: true })
    .fill('Two layers of tear-away');
  await page.getByRole('button', { name: 'Save and apply profile', exact: true }).click();
  const profile = () =>
    page.evaluate(() => (window as any).__lumastitch.useDoc.getState().design.fabricProfile);
  await expect.poll(async () => (await profile())?.fillSpacing).toBe(0.75);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download profile JSON' }).click();
  const f = await download;
  expect(JSON.parse(await readFile((await f.path())!, 'utf8')).profiles[0]).toEqual(await profile());
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.keyboard.press('ControlOrMeta+z');
  expect(await profile()).toBeUndefined();
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect.poll(async () => (await profile())?.name).toBe('Cotton sew-out A');
  await page.waitForTimeout(1600);
  await page.reload();
  await page.waitForFunction(() => (window as any).__lumastitch?.useDoc.getState().design);
  expect((await profile()).fillSpacing).toBe(0.75);
  await page.getByRole('menuitem', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Design settings…' }).click();
  await page.getByText('Custom fabric profiles · Cotton sew-out A', { exact: true }).click();
  await page.getByLabel('Saved fabric profile', { exact: true }).selectOption('Cotton sew-out A');
  await expect(page.getByLabel('Profile name', { exact: true })).toHaveValue('Cotton sew-out A');
});
