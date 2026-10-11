// SPDX-License-Identifier: GPL-3.0-or-later
/** node scripts/stitch-examples.mjs [source-root] [output-directory]
 * Needs Playwright Chromium and ffmpeg. Uses the app's actual engine, exporters and renderer.
 */
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

const root = resolve(process.argv[2] ?? '.');
const out = resolve(process.argv[3] ?? 'docs/stitch-examples/after');
const tmp = mkdtempSync(join(tmpdir(), 'lumastitch-examples-'));
const server = await createServer({
  root,
  configFile: false,
  resolve: { alias: { '@': join(root, 'src') } },
  server: { port: 0, host: '127.0.0.1', watch: null, hmr: false, ws: false },
  optimizeDeps: { include: ['mediabunny', 'zustand', 'react', 'immer', 'nanoid'] },
});
server.middlewares.use('/__stitch_examples', (_req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.end('<!doctype html><title>Stitch examples</title>');
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__stitch_examples`);
  const { stitchExamples } = await server.ssrLoadModule('/tests/routing/stitch-examples.ts');
  const { buildPlan } = await server.ssrLoadModule('/src/engine/plan.ts');
  const { optimizeSequence } = await server.ssrLoadModule('/src/engine/sequence/optimize.ts');
  const { serializeProject } = await server.ssrLoadModule('/src/model/schema.ts');
  const { exportSvg } = await server.ssrLoadModule('/src/io/export/svg.ts');
  const { pesFormat } = await server.ssrLoadModule('/src/io/export/pesFormat.ts');
  const { dstFormat } = await server.ssrLoadModule('/src/io/export/machineFormats.ts');
  const metrics = [];
  for (const { name, design } of stitchExamples()) {
    const dir = join(out, name);
    mkdirSync(dir, { recursive: true });
    design.sequence = optimizeSequence(design);
    const plan = buildPlan(design);
    if (plan.diagnostics.some((d) => d.severity === 'error'))
      throw new Error(JSON.stringify(plan.diagnostics));
    const project = JSON.parse(serializeProject(design));
    project.savedAt = '2026-10-11T00:00:00.000Z';
    writeFileSync(join(dir, `${name}.lumastitch`), JSON.stringify(project, null, 2) + '\n');
    writeFileSync(join(dir, `${name}.svg`), exportSvg(design));
    writeFileSync(join(dir, `${name}.pes`), pesFormat.write(plan, design, { version: 6 }));
    writeFileSync(join(dir, `${name}.dst`), dstFormat.write(plan, design, {}));
    let jumpMm = 0,
      travelMm = 0;
    for (let i = 1; i < plan.flags.length; i++) {
      if (plan.flags[i] & 30) continue;
      const length = Math.hypot(plan.x[i] - plan.x[i - 1], plan.y[i] - plan.y[i - 1]);
      if (plan.flags[i] & 1) jumpMm += length;
      else if (plan.flags[i] & 128) travelMm += length;
    }
    metrics.push({
      name,
      ...plan.stats,
      jumpMm,
      travelMm,
      bounds: plan.bounds,
      diagnostics: plan.diagnostics,
    });
    const plain = {
      ...plan,
      x: [...plan.x],
      y: [...plan.y],
      flags: [...plan.flags],
      element: [...plan.element],
    };
    await page.evaluate(async (plain) => {
      const { createStitchOutRenderer } = await import('/src/io/export/video.ts');
      const plan = {
        ...plain,
        x: Float32Array.from(plain.x),
        y: Float32Array.from(plain.y),
        flags: Uint8Array.from(plain.flags),
        element: Uint32Array.from(plain.element),
      };
      window.exampleRenderer = createStitchOutRenderer(plan, {
        width: 560,
        height: 560,
        padding: 36,
        mode: 'realistic',
        background: '#f7f4ec',
        needle: true,
      });
    }, plain);
    const frames = join(tmp, name);
    mkdirSync(frames);
    for (let frame = 0; frame <= 96; frame++) {
      const png = await page.evaluate(async (progress) => {
        const r = window.exampleRenderer;
        r.render(progress);
        const blob = await r.canvas.convertToBlob({ type: 'image/png' });
        return await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result.split(',')[1]);
          reader.readAsDataURL(blob);
        });
      }, frame / 96);
      writeFileSync(join(frames, `${String(frame).padStart(4, '0')}.png`), Buffer.from(png, 'base64'));
    }
    copyFileSync(join(frames, '0096.png'), join(dir, 'preview.png'));
    execFileSync('ffmpeg', [
      '-y',
      '-loglevel',
      'error',
      '-framerate',
      '12',
      '-i',
      join(frames, '%04d.png'),
      '-filter_complex',
      '[0:v]tpad=stop_mode=clone:stop_duration=2,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a',
      '-loop',
      '0',
      join(dir, 'stitch-out.gif'),
    ]);
    console.log(
      `${name}: ${plan.stats.stitches} stitches, ${plan.stats.trims} trims, ${jumpMm.toFixed(2)} mm jumps`,
    );
  }
  writeFileSync(join(out, 'metrics.json'), JSON.stringify(metrics, null, 2) + '\n');
} finally {
  await browser?.close();
  await server.close();
  rmSync(tmp, { recursive: true, force: true });
}
