import { expect, test } from '@playwright/test';
import { openApp, waitIdle } from './helpers';
import { readFile } from 'node:fs/promises';
import { unzipFiles } from '../src/library/zip';

test('shapes portable OpenType text, imports fonts, exports batches and edits after reload', async ({
  page,
}) => {
  await openApp(page);
  await page.evaluate(async () => {
    await (window as any).__lumastitch.actions.newDesign({ name: 'OpenType' });
  });
  const open = async (edit = false) => {
    await page.getByRole('menuitem', { name: 'Object', exact: true }).click();
    await page
      .getByRole('menuitem', { name: edit ? 'Edit lettering…' : 'Add lettering…', exact: true })
      .click();
  };
  await open();
  await page.getByLabel('Font', { exact: true }).selectOption('Noto Sans Arabic');
  await expect(page.getByLabel('Weight', { exact: true })).toBeVisible();
  await page.getByLabel('Text', { exact: true }).fill('سَلَام');
  await page.getByLabel('Font size (mm per em)').fill('35');
  await page.getByLabel('Weight', { exact: true }).fill('600');
  await page.getByRole('button', { name: 'Add lettering', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await waitIdle(page);
  const info = () =>
    page.evaluate(() => {
      const d = (window as any).__lumastitch.useDoc.getState().design;
      const g = Object.values(d.lettering)[0] as any;
      return {
        text: g.options.text,
        font: g.options.openType.name,
        glyphs: g.options.openType.prepared.lines[0].glyphs.length,
        fill: d.shapes[g.shapeIds[0]].fill.type,
        data: g.options.openType.data.length,
      };
    });
  expect(await info()).toMatchObject({ text: 'سَلَام', fill: 'tatami' });
  expect((await info()).data).toBeGreaterThan(100000);
  await open(true);
  await page
    .getByLabel('Import TTF/OTF (up to 10 MB)')
    .setInputFiles('src/lettering/fonts/opentype/NotoSerif.ttf');
  await expect(page.getByLabel('Font', { exact: true })).toHaveValue('Noto Serif Regular');
  await page.getByLabel('Text', { exact: true }).fill('Luma');
  await page.getByText('Batch names', { exact: true }).click();
  await page.getByLabel('One name per line (up to 100)').fill('Ada\nGrace');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download batch projects + PES' }).click();
  const file = await download;
  const entries = await unzipFiles(new Uint8Array(await readFile((await file.path())!)));
  const projects = entries
    .filter((e) => e.name.endsWith('.lumastitch'))
    .map((e) => JSON.parse(new TextDecoder().decode(e.data)));
  expect(projects.map((p) => p.design.lettering.text.options.text)).toEqual(['Ada', 'Grace']);
  expect(projects[1].design.lettering.text.options.openType.prepared.lines[0].glyphs.length).toBeGreaterThan(
    3,
  );
  expect(entries.filter((e) => e.name.endsWith('.pes'))).toHaveLength(2);
  await page.getByRole('button', { name: 'Update lettering' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await waitIdle(page);
  expect((await info()).text).toBe('Luma');
  await page.keyboard.press('ControlOrMeta+z');
  expect((await info()).text).toBe('سَلَام');
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const L = (window as any).__lumastitch;
        return await new Promise<string>((resolve) => {
          const r = indexedDB.open('lumastitch-designs');
          r.onsuccess = () => {
            const db = r.result,
              q = db.transaction('designs').objectStore('designs').get(L.useDoc.getState().designId);
            q.onsuccess = () => {
              resolve(JSON.stringify(q.result?.lettering));
              db.close();
            };
          };
        });
      }),
    )
    .toContain('Luma');
  await page.reload();
  await page.waitForFunction(() => (window as any).__lumastitch?.useDoc.getState().design?.lettering);
  expect((await info()).text).toBe('Luma');
  await page.evaluate(() => {
    const L = (window as any).__lumastitch,
      d = L.useDoc.getState().design;
    L.useUi
      .getState()
      .setSelection({ shapeIds: (Object.values(d.lettering)[0] as any).shapeIds, elementIds: [], nodes: [] });
  });
  await open(true);
  await page.getByLabel('Text', { exact: true }).fill('AV');
  await page.getByRole('button', { name: 'Update lettering' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  expect((await info()).text).toBe('AV');
});
