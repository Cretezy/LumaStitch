// SPDX-License-Identifier: GPL-3.0-or-later
/** Build first; captures the actual density overlay and sewing-field UI. */
import { preview } from 'vite';
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

const server = await preview({ preview: { port: 4183, strictPort: true, host: '127.0.0.1' } });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
  await page.goto('http://127.0.0.1:4183/?testHooks');
  await page.waitForFunction(() => window.__lumastitch);
  const project = readFileSync('docs/inspection/fabric-calibration/fabric-calibration.lumastitch', 'utf8');
  await page.evaluate(async (project) => {
    await window.__lumastitch.actions.handleFile(new File([project], 'fabric-calibration.lumastitch'));
    await window.__lumastitch.waitForPlan();
    window.__lumastitch.useUi.getState().setView({ density: true });
  }, project);
  await page.getByText(/^Peak .*penetrations\/mm²/).waitFor();
  await page.getByRole('button', { name: 'Fit design', exact: true }).click();
  await page.mouse.move(1439, 899);
  await page.screenshot({ path: 'docs/inspection/density.png' });
  await page.getByRole('menuitem', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Design settings…' }).click();
  await page.getByRole('dialog').waitFor();
  await page.getByRole('switch', { name: 'Check hoop sewing field' }).waitFor();
  await page.waitForTimeout(250); // Let the dialog's opening animation finish before the still image.
  await page.screenshot({ path: 'docs/inspection/sewing-field.png' });
} finally { await browser.close(); await new Promise((resolve) => server.httpServer.close(resolve)); }
