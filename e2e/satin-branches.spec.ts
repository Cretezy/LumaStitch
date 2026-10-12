import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { openApp, planStats, waitIdle } from './helpers';
test('satin branches toggle continuously, undo and persist', async ({ page }) => {
  await openApp(page);
  const project = await readFile('docs/satin-branches/before/before.lumastitch', 'utf8');
  await page.evaluate(async (project) => {
    const L = (window as any).__lumastitch;
    await L.actions.handleFile(new File([project], 'fern.lumastitch'));
    L.useUi.getState().setSelection({ shapeIds: ['fern'], elementIds: ['fern-satin'], nodes: [] });
  }, project);
  await waitIdle(page);
  const before = await planStats(page);
  expect(before.trims).toBeGreaterThan(5);
  await page.getByRole('button', { name: 'Advanced', exact: true }).click();
  await page.getByRole('switch', { name: 'Connect satin branches' }).click();
  await waitIdle(page);
  expect((await planStats(page)).trims).toBe(0);
  await page.keyboard.press('ControlOrMeta+z');
  await waitIdle(page);
  expect((await planStats(page)).trims).toBe(before.trims);
  await page.getByRole('switch', { name: 'Connect satin branches' }).click();
  await waitIdle(page);
  await page.waitForTimeout(1600);
  await page.reload();
  await page.waitForFunction(() => (window as any).__lumastitch?.useDoc.getState().design);
  await waitIdle(page);
  expect((await planStats(page)).trims).toBe(0);
});
