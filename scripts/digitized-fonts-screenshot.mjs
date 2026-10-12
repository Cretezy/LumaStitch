// SPDX-License-Identifier: GPL-3.0-or-later
import { preview } from 'vite';
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
const server = await preview({ preview: { port: 4184, strictPort: true, host: '127.0.0.1' } });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1500 }, colorScheme: 'light' });
  await page.goto('http://127.0.0.1:4184/?testHooks');
  await page.waitForFunction(() => window.__lumastitch);
  await page.evaluate(async project => {
    const L = window.__lumastitch;
    await L.actions.handleFile(new File([project], 'script.lumastitch'));
    L.useUi.getState().setSelection({ shapeIds: L.useDoc.getState().design.lettering.text.shapeIds, elementIds: [], nodes: [] });
  }, readFileSync('docs/digitized-fonts/script/script.lumastitch', 'utf8'));
  await page.getByRole('menuitem', { name: 'Object', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Edit lettering…', exact: true }).click();
  await page.getByRole('button', { name: 'Update lettering', exact: true }).waitFor();
  await page.screenshot({ path: 'docs/digitized-fonts/editor.png' });
} finally {
  await browser.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}
