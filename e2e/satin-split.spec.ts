import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { openApp, waitIdle } from './helpers';
test('splits a satin column with preview, undo and project persistence', async ({ page }) => {
  await openApp(page);
  const project = await readFile('docs/satin-split/before/before.lumastitch', 'utf8');
  await page.evaluate(async (project) => {
    const L = (window as any).__lumastitch;
    await L.actions.handleFile(new File([project], 'ribbon.lumastitch'));
    L.useUi.getState().setSelection({ shapeIds: ['ribbon-0'], elementIds: ['ribbon-satin-0'], nodes: [] });
  }, project);
  const open = async () => {
    await page.getByRole('menuitem', { name: 'Object', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Split satin column…' }).click();
  };
  await open();
  await expect(page.getByRole('img', { name: 'Satin rails and split position' })).toBeVisible();
  await page.getByRole('spinbutton', { name: 'Position along column (%)' }).fill('45');
  await page.getByRole('button', { name: 'Split column', exact: true }).click();
  await waitIdle(page);
  const shapes = () =>
    page.evaluate(() => Object.values((window as any).__lumastitch.useDoc.getState().design.shapes) as any[]);
  const split = await shapes();
  expect(split).toHaveLength(2);
  expect(split.every((s) => s.outline.type === 'satinColumn' && s.outline.guides.length > 10)).toBe(true);
  expect(split[0].geom.subpaths[0].nodes.at(-1).p).toEqual(split[1].geom.subpaths[0].nodes[0].p);
  await page.keyboard.press('ControlOrMeta+z');
  await waitIdle(page);
  expect(await shapes()).toHaveLength(1);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await waitIdle(page);
  expect(await shapes()).toHaveLength(2);
  await page.waitForTimeout(1600);
  await page.reload();
  await page.waitForFunction(() => (window as any).__lumastitch?.useDoc.getState().design);
  await waitIdle(page);
  expect(await shapes()).toEqual(split);
});
