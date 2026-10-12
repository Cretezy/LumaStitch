import { expect, test } from '@playwright/test';
import { openApp, waitIdle } from './helpers';
import { readFile } from 'node:fs/promises';
import { unzipFiles } from '../src/library/zip';

test('editable satin lettering, undo, reload and batch machine export', async ({ page }) => {
  await openApp(page);
  await page.evaluate(async () => {
    await (window as any).__lumastitch.actions.newDesign({ name: 'Lettering test' });
  });
  await page.getByRole('menuitem', { name: 'Object', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Add lettering…', exact: true }).click();
  await page.getByLabel('Text', { exact: true }).fill('Stitch');
  await page.getByRole('button', { name: 'Add lettering', exact: true }).click();
  await waitIdle(page);
  const text = () =>
    page.evaluate(
      () => Object.values((window as any).__lumastitch.useDoc.getState().design.lettering)[0] as any,
    );
  expect((await text()).options.text).toBe('Stitch');
  await page.getByRole('menuitem', { name: 'Object', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Edit lettering…', exact: true }).click();
  await page.getByLabel('Text', { exact: true }).fill('Luma');
  await page.getByRole('button', { name: 'Update lettering' }).click();
  await waitIdle(page);
  expect((await text()).options.text).toBe('Luma');
  await page.keyboard.press('ControlOrMeta+z');
  expect((await text()).options.text).toBe('Stitch');
  await page.keyboard.press('ControlOrMeta+Shift+z');
  expect((await text()).options.text).toBe('Luma');
  await page.getByRole('menuitem', { name: 'Object', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Edit lettering…', exact: true }).click();
  await page.getByText('Batch names', { exact: true }).click();
  await page.getByLabel('One name per line (up to 100)').fill('Ada\nGrace');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download batch projects + PES' }).click();
  const file = await download;
  const entries = await unzipFiles(new Uint8Array(await readFile((await file.path())!)));
  const pes = entries.filter((e) => e.name.endsWith('.pes'));
  expect(pes).toHaveLength(2);
  for (const f of pes) expect(new TextDecoder().decode(f.data.slice(0, 8))).toBe('#PES0060');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.waitForTimeout(1600); // Autosave debounce is one second.
  await page.reload();
  await page.waitForFunction(() => (window as any).__lumastitch?.useDoc.getState().design?.lettering);
  expect((await text()).options.text).toBe('Luma');
});
