// SPDX-License-Identifier: GPL-3.0-or-later
import { preview } from 'vite';
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
const server = await preview({ preview: { port: 4188, strictPort: true, host: '127.0.0.1' } });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light' });
  await page.goto('http://127.0.0.1:4188/?testHooks');
  await page.waitForFunction(() => window.__lumastitch);
  await page.evaluate(async (project) => {
    const L = window.__lumastitch;
    await L.actions.handleFile(new File([project], 'arabic.lumastitch'));
    L.useUi.getState().setSelection({ shapeIds: L.useDoc.getState().design.lettering.text.shapeIds, elementIds: [], nodes: [] });
  }, readFileSync('docs/opentype/arabic/arabic.lumastitch', 'utf8'));
  await page.getByRole('menuitem', { name: 'Object', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Edit lettering…', exact: true }).click();
  await page.getByLabel('Weight', { exact: true }).waitFor();
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'docs/opentype/font-editor.png' });
} finally { await browser.close(); await new Promise((resolve) => server.httpServer.close(resolve)); }
