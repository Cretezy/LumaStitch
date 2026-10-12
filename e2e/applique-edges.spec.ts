import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { openApp, waitIdle } from './helpers';

test('chooses applique edges with preview, undo and persistence, then creates an open border', async ({
  page,
}) => {
  await openApp(page);
  const load = async (file: string, running = false) => {
    const project = JSON.parse(await readFile(file, 'utf8'));
    if (running) project.design.shapes.pocket.outline.type = 'running';
    await page.evaluate(async (project) => {
      const L = (window as any).__lumastitch;
      await L.actions.handleFile(new File([JSON.stringify(project)], 'pocket.lumastitch'));
      L.useUi.getState().setSelection({ shapeIds: ['pocket'], elementIds: [], nodes: [] });
    }, project);
    await waitIdle(page);
  };
  await load('docs/applique-edges/before/before.lumastitch');
  const stitches = () =>
    page.evaluate(() => (window as any).__lumastitch.usePlan.getState().plan.stats.stitches);
  const before = await stitches();
  await page.getByRole('menuitem', { name: 'Object', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Appliqué edge coverage…', exact: true }).click();
  await page.getByLabel('Omit contour 1, edge 1', { exact: true }).check();
  await page.getByRole('button', { name: 'Apply edge coverage' }).click();
  await waitIdle(page);
  expect(await stitches()).toBeLessThan(before - 150);
  await page.keyboard.press('ControlOrMeta+z');
  await waitIdle(page);
  expect(await stitches()).toBe(before);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await waitIdle(page);
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const id = (window as any).__lumastitch.useDoc.getState().designId;
        return await new Promise((resolve, reject) => {
          const r = indexedDB.open('lumastitch-designs');
          r.onerror = () => reject(r.error);
          r.onsuccess = () => {
            const db = r.result,
              q = db.transaction('designs').objectStore('designs').get(id);
            q.onsuccess = () => {
              resolve(q.result?.shapes?.pocket?.fill?.appliqueEdges?.omit);
              db.close();
            };
          };
        });
      }),
    )
    .toEqual([[0, 0]]);
  await page.reload();
  await page.waitForFunction(() => (window as any).__lumastitch?.useDoc.getState().design?.shapes?.pocket);
  await waitIdle(page);
  expect(await stitches()).toBeLessThan(before - 150);
  await load('docs/applique-edges/open-border/open-border.lumastitch', true);
  await page.getByRole('combobox', { name: 'Outline stitch type' }).click();
  await page.getByRole('option', { name: 'Appliqué border', exact: true }).click();
  await waitIdle(page);
  expect(await page.evaluate(() => (window as any).__lumastitch.usePlan.getState().plan.stats.stops)).toBe(2);
});
