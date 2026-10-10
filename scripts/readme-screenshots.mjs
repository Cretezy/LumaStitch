// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Regenerates the README screenshots in docs/screenshots (WebP) from a production build.
 *
 *   npm run build && node scripts/readme-screenshots.mjs
 *
 * Needs Playwright's Chromium, and cwebp + ffmpeg on the PATH.
 */
import { chromium } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = join(root, 'docs/screenshots');
const tmp = mkdtempSync(join(tmpdir(), 'lumastitch-shots-'));
const PORT = 4179;
const BASE = `http://localhost:${PORT}`;

const server = spawn(
  process.execPath,
  [join(root, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort'],
  { cwd: root, stdio: 'ignore' },
);
for (let i = 0; ; i++) {
  try {
    if ((await fetch(BASE)).ok) break;
  } catch {
    /* not up yet */
  }
  if (i > 100) throw new Error('vite preview did not start');
  await new Promise((r) => setTimeout(r, 100));
}

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: 'light',
  acceptDownloads: true,
});
const page = await context.newPage();
await page.addInitScript(() => {
  delete window.showSaveFilePicker;
  delete window.showOpenFilePicker;
  // Headless Chromium never grants persistent storage; hide the library's warning about it.
  if (navigator.storage) navigator.storage.persisted = async () => true;
});

const L = (fn, arg) => page.evaluate(fn, arg);
const settle = (ms = 600) => page.waitForTimeout(ms);

/** Saves a screenshot as WebP. */
async function shot(name, opts = {}) {
  await L(() => window.__lumastitch.useUi.setState({ toast: null }));
  await page.mouse.move(1439, 899);
  await settle(300);
  const png = join(tmp, `${name}.png`);
  await page.screenshot({ path: png, ...opts });
  execFileSync('cwebp', ['-quiet', '-q', '88', '-m', '6', png, '-o', join(out, `${name}.webp`)]);
  console.log(`docs/screenshots/${name}.webp`);
}

async function importSvg(file) {
  const svg = readFileSync(file, 'utf8');
  await L(
    (svg) =>
      window.__lumastitch.actions.handleFile(
        new File([svg], 'Mountain badge.svg', { type: 'image/svg+xml' }),
        {
          intoCurrent: false,
        },
      ),
    svg,
  );
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Import', exact: true }).click();
  await dialog.waitFor({ state: 'hidden', timeout: 30000 });
  await L(() => window.__lumastitch.waitForPlan());
  await settle(1000);
}

await page.goto(`${BASE}/?testHooks`);
await page.waitForFunction(() => window.__lumastitch);

// 1. Editor: the badge in realistic view with a shape selected.
await importSvg(join(out, 'demo.svg'));
await L(() => {
  const { useDoc, useUi } = window.__lumastitch;
  const d = useDoc.getState().design;
  useUi.setState((u) => ({ viewMode: 'realistic', view: { ...u.view, jumps: false } }));
  const s = Object.values(d.shapes).find((x) => x.art.fill === '#457b9d' && x.fill);
  if (s) useUi.getState().setSelection({ shapeIds: [s.id], elementIds: [s.fill.id], nodes: [] });
});
await settle(1200);
await shot('editor');

// 2. Simulator part-way through.
await L(() => window.__lumastitch.useUi.getState().clearSelection());
await page.getByRole('button', { name: 'Simulate' }).first().click();
await settle(400);
// Seek by clicking the timeline at 70 % of its width.
const timeline = await page.getByRole('slider', { name: 'Simulation position' }).boundingBox();
await page.mouse.click(timeline.x + timeline.width * 0.7, timeline.y + timeline.height / 2);
await settle(800);
await shot('simulator');
await page.keyboard.press('Escape');
await settle(300);

// 3. Export dialog (PES with the machine colour preview).
await L(() => window.__lumastitch.useUi.getState().openDialog('export', { format: 'pes' }));
await page.getByRole('button', { name: /^Export \.pes$/ }).waitFor();
await settle(1200);
await shot('export');

// 4. Stitch-out animation, encoded by the app's own video export, converted to animated WebP.
await page.getByRole('tab', { name: 'Video' }).click();
await page.getByRole('radio', { name: 'Length' }).click();
const len = page.getByRole('textbox', { name: 'Video length in seconds' });
await len.fill('7');
await len.press('Enter');
await page.getByRole('radio', { name: 'HD', exact: true }).click();
const download = page.waitForEvent('download');
await page.getByRole('button', { name: /^Export (MP4|WebM)$/ }).click();
const videoFile = join(tmp, (await download).suggestedFilename());
await (await download).saveAs(videoFile);
const frames = join(tmp, 'frames');
mkdirSync(frames);
execFileSync('ffmpeg', [
  '-loglevel',
  'error',
  '-i',
  videoFile,
  '-vf',
  'fps=15,scale=560:-2:flags=lanczos',
  join(frames, '%04d.png'),
]);
const pngs = readdirSync(frames)
  .sort()
  .map((f) => join(frames, f));
execFileSync('img2webp', [
  '-loop',
  '0',
  '-lossy',
  '-q',
  '70',
  '-m',
  '6',
  '-d',
  '67',
  ...pngs,
  '-o',
  join(out, 'stitch-out.webp'),
]);
console.log('docs/screenshots/stitch-out.webp');
await page.getByRole('dialog').waitFor({ state: 'hidden' });

// 5. Image import: a flower drawn on a canvas, traced to thread colours.
await L(async () => {
  const c = new OffscreenCanvas(800, 800);
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 800, 800);
  g.strokeStyle = '#2d6a4f';
  g.lineWidth = 34;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(400, 420);
  g.bezierCurveTo(390, 560, 420, 660, 400, 760);
  g.stroke();
  g.fillStyle = '#40916c';
  for (const [x, y, r] of [
    [330, 610, -0.6],
    [470, 650, 0.6],
  ]) {
    g.save();
    g.translate(x, y);
    g.rotate(r);
    g.beginPath();
    g.ellipse(0, 0, 90, 38, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
  g.fillStyle = '#e63946';
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    g.beginPath();
    g.ellipse(400 + Math.cos(a) * 130, 330 + Math.sin(a) * 130, 110, 70, a, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = '#ffb703';
  g.beginPath();
  g.arc(400, 330, 95, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#fb8500';
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    g.beginPath();
    g.arc(400 + Math.cos(a) * 55, 330 + Math.sin(a) * 55, 12, 0, Math.PI * 2);
    g.fill();
  }
  const blob = await c.convertToBlob({ type: 'image/png' });
  await window.__lumastitch.actions.handleFile(new File([blob], 'Flower.png', { type: 'image/png' }), {
    intoCurrent: false,
  });
});
const imageDialog = page.getByRole('dialog');
await imageDialog.waitFor();
await settle(4000);
await shot('image-import');
await imageDialog
  .getByRole('button', { name: /^Import/ })
  .last()
  .click();
await imageDialog.waitFor({ state: 'hidden', timeout: 60000 });
await L(() => window.__lumastitch.waitForPlan());
await settle(1000);

// 6. Project library.
await L(() => window.__lumastitch.actions.goHome());
await settle(1500);
await shot('library', { clip: { x: 0, y: 0, width: 1440, height: 500 } });

await browser.close();
server.kill();
rmSync(tmp, { recursive: true, force: true });
