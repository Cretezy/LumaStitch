import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { importFile, openApp, planStats, waitIdle } from './helpers';

test('SVG → auto-digitize → export .pes → read back matches the app stats (acceptance 2, 4)', async ({
  page,
}) => {
  await openApp(page);
  await importFile(page, 'svg/illustrator.svg', 'image/svg+xml');
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Import SVG')).toBeVisible();
  await dialog.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 20000 });
  await waitIdle(page);
  const stats = await planStats(page);
  expect(stats.stitches).toBeGreaterThan(500);
  expect(stats.colors).toBe(3);

  await page.getByTestId('toolbar-export').click();
  const exp = page.getByRole('dialog');
  await expect(exp.getByText('Ready to export')).toBeVisible({ timeout: 20000 });
  const downloadPromise = page.waitForEvent('download');
  await exp.getByRole('button', { name: /Export \.pes/ }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.pes$/);
  const bytes = readFileSync((await download.path())!);

  const read = await page.evaluate(
    async (arr) => {
      const L = (window as any).__lumastitch;
      const r = L.pes.readPes(new Uint8Array(arr));
      const plan = await L.waitForPlan();
      // The command sequence the simulator plays, in 0.1 mm units.
      const sim: [number, number, number][] = [];
      for (let i = 0; i < plan.flags.length; i++) {
        const f = plan.flags[i];
        const cmd = f & 16 ? 4 : f & 4 ? 5 : f & 8 ? 3 : f & 2 ? 2 : f & 1 ? 1 : 0;
        if (cmd !== 4) sim.push([Math.round(plan.x[i] * 10) || 0, Math.round(plan.y[i] * 10) || 0, cmd]);
      }
      const rd = r.commands.filter((c: any) => c.cmd !== 4);
      const ox = rd[0].x - sim[0][0],
        oy = rd[0].y - sim[0][1];
      const same =
        rd.length === sim.length &&
        rd.every(
          (c: any, i: number) => c.x - ox === sim[i][0] && c.y - oy === sim[i][1] && c.cmd === sim[i][2],
        );
      return {
        stitches: r.stitchCount,
        colors: r.colors.length,
        changes: r.colorChangeCount,
        label: r.label,
        same,
        w: (r.bounds.maxX - r.bounds.minX) / 10,
        h: (r.bounds.maxY - r.bounds.minY) / 10,
      };
    },
    [...bytes],
  );
  expect(read.stitches).toBe(stats.stitches);
  expect(read.colors).toBe(stats.colors);
  expect(read.changes).toBe(stats.colorChanges);
  expect(read.same).toBe(true);
  expect(read.w).toBeCloseTo(stats.bounds.maxX - stats.bounds.minX, 0);
});

test('undo and redo restore the exact document', async ({ page }) => {
  await openApp(page);
  await importFile(page, 'svg/basic-shapes.svg', 'image/svg+xml');
  await page.getByRole('dialog').getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden({ timeout: 20000 });
  const snap = () =>
    page.evaluate(() => JSON.stringify((window as any).__lumastitch.useDoc.getState().design));
  const before = await snap();
  await page.evaluate(() => {
    const L = (window as any).__lumastitch;
    const d = L.useDoc.getState().design;
    L.useUi.getState().setSelection({ shapeIds: [d.zOrder[0]], elementIds: [], nodes: [] });
  });
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  const moved = await snap();
  expect(moved).not.toBe(before);
  await page.keyboard.press('ControlOrMeta+z');
  await page.keyboard.press('ControlOrMeta+z');
  expect(await snap()).toBe(before);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await page.keyboard.press('ControlOrMeta+Shift+z');
  expect(await snap()).toBe(moved);
});

test('reload restores the design and the library (acceptance 8)', async ({ page }) => {
  await openApp(page);
  await importFile(page, 'svg/basic-shapes.svg', 'image/svg+xml');
  await page.getByRole('dialog').getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden({ timeout: 20000 });
  await waitIdle(page);
  const canon = () =>
    page.evaluate(() => {
      const sort = (v: any): any =>
        Array.isArray(v)
          ? v.map(sort)
          : v && typeof v === 'object'
            ? Object.fromEntries(
                Object.keys(v)
                  .sort()
                  .map((k) => [k, sort(v[k])]),
              )
            : v;
      return JSON.stringify(sort((window as any).__lumastitch.useDoc.getState().design));
    });
  const before = await canon();
  await page.waitForTimeout(1600); // autosave
  await page.reload();
  await page.waitForFunction(() => (window as any).__lumastitch?.useDoc.getState().design);
  expect(await canon()).toBe(before);
  // Library lists it.
  await page.getByRole('button', { name: 'Project library' }).click();
  await expect(page.getByText('basic-shapes').first()).toBeVisible();
});

test('changing fill density updates the preview quickly (acceptance 5)', async ({ page }) => {
  await openApp(page);
  await importFile(page, 'svg/basic-shapes.svg', 'image/svg+xml');
  await page.getByRole('dialog').getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden({ timeout: 20000 });
  await waitIdle(page);
  const ms = await page.evaluate(async () => {
    const L = (window as any).__lumastitch;
    const d = L.useDoc.getState().design;
    const s = Object.values(d.shapes).find((x: any) => x.fill?.type === 'tatami') as any;
    const before = L.usePlan.getState().plan.stats.stitches;
    const t0 = performance.now();
    L.commands.setParams([s.fill.id], { density: 0.3 });
    await new Promise<void>((res) => {
      const unsub = L.usePlan.subscribe((st: any) => {
        if (st.builtRevision === L.useDoc.getState().revision && st.plan.stats.stitches !== before) {
          unsub();
          res();
        }
      });
    });
    return performance.now() - t0;
  });
  expect(ms).toBeLessThan(300);
});

test('auto-digitize keeps outlines whole when fills are clipped, and keeps compound shapes together', async ({
  page,
}) => {
  await openApp(page);
  await importFile(page, 'svg/overlap-outline.svg', 'image/svg+xml');
  await page.getByRole('dialog').getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden({ timeout: 20000 });
  await waitIdle(page);
  const r = await page.evaluate(() => {
    const d = (window as any).__lumastitch.useDoc.getState().design;
    const shapes = Object.values(d.shapes) as any[];
    const bbox = (s: any) => {
      const xs = s.geom.subpaths.flatMap((sp: any) => sp.nodes.map((n: any) => n.p[0]));
      return Math.max(...xs) - Math.min(...xs);
    };
    const discOutline = shapes.find((s) => s.outline && s.name.startsWith('disc'));
    const letters = shapes.filter((s) => s.name.startsWith('letters'));
    return {
      discOutlineWidth: discOutline ? bbox(discOutline) : 0,
      discOutlineSubpaths: discOutline?.geom.subpaths.length,
      discFill: shapes.some((s) => s.name.startsWith('disc') && s.fill),
      letters: letters.length,
      lettersHaveOutline: letters.some((s) => s.outline),
      lettersSubpaths: letters[0]?.geom.subpaths.length,
    };
  });
  // The outline follows the whole original circle (30 mm wide), not the clipped fill.
  expect(r.discOutlineWidth).toBeGreaterThan(29.5);
  expect(r.discOutlineSubpaths).toBe(1);
  expect(r.discFill).toBe(true);
  // Compound path with no overlaps stays one shape with its outline (splitting parts is opt-in).
  expect(r.letters).toBe(1);
  expect(r.lettersHaveOutline).toBe(true);
  expect(r.lettersSubpaths).toBe(2);
  // With "Split separate parts", each letter becomes its own shape and keeps its outline.
  const split = await page.evaluate(async () => {
    const L = (window as any).__lumastitch;
    await L.autoDigitize({ splitParts: true });
    const shapes = Object.values(L.useDoc.getState().design.shapes) as any[];
    const letters = shapes.filter((s) => s.name.startsWith('letters'));
    return {
      n: letters.length,
      outlines: letters.every((s) => s.outline),
      subpaths: letters.map((s) => s.geom.subpaths.length),
    };
  });
  expect(split).toEqual({ n: 2, outlines: true, subpaths: [1, 1] });
});

test('exports DST, JEF, EXP, VP3 and the PDF worksheet from the dialog', async ({ page }) => {
  await openApp(page);
  await importFile(page, 'svg/illustrator.svg', 'image/svg+xml');
  await page.getByRole('dialog').getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden({ timeout: 20000 });
  await waitIdle(page);
  const stitches = await page.evaluate(
    () => (window as any).__lumastitch.usePlan.getState().plan.stats.stitches,
  );
  for (const fmt of ['dst', 'jef', 'exp', 'vp3', 'pdf'] as const) {
    await page.evaluate(
      (f) => (window as any).__lumastitch.useUi.getState().openDialog('export', { format: f }),
      fmt,
    );
    const dialog = page.getByRole('dialog');
    const button = dialog.getByRole('button', { name: fmt === 'pdf' ? 'Export PDF' : `Export .${fmt}` });
    await expect(button).toBeEnabled({ timeout: 20000 });
    const dl = page.waitForEvent('download');
    await button.click();
    const download = await dl;
    expect(download.suggestedFilename().toLowerCase()).toMatch(new RegExp(`\\.${fmt}$`));
    const bytes = readFileSync((await download.path())!);
    if (fmt === 'pdf') expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    if (fmt === 'dst') {
      expect(bytes.subarray(0, 3).toString('latin1')).toBe('LA:');
      // The DST header records the stitch count after "ST:".
      expect(bytes.subarray(0, 512).toString('latin1')).toMatch(/ST:\s*\d+/);
    }
    if (fmt === 'vp3') expect(bytes.subarray(0, 6).toString('latin1')).toBe('%vsm%\0');
    expect(bytes.length).toBeGreaterThan(fmt === 'exp' ? stitches : 200);
    await expect(page.getByRole('dialog')).toBeHidden({ timeout: 10000 });
  }
});

test('exports a stitch-out video at a chosen speed', async ({ page }) => {
  await openApp(page);
  await importFile(page, 'svg/basic-shapes.svg', 'image/svg+xml');
  await page.getByRole('dialog').getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden({ timeout: 20000 });
  await waitIdle(page);
  await page.evaluate(() =>
    (window as any).__lumastitch.useUi.getState().openDialog('export', { format: 'video' }),
  );
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('radio', { name: 'Speed' }).click();
  const speed = dialog.getByRole('textbox', { name: 'Speed relative to the machine' });
  await speed.fill('100');
  await speed.press('Enter');
  await expect(dialog.getByTestId('video-timing')).toContainText('Video length');
  await dialog.getByRole('radio', { name: 'HD', exact: true }).click();
  const button = dialog.getByRole('button', { name: /^Export (MP4|WebM)$/ });
  await expect(button).toBeEnabled({ timeout: 20000 });
  const dl = page.waitForEvent('download');
  await button.click();
  const download = await dl;
  const name = download.suggestedFilename();
  expect(name).toMatch(/\.(mp4|webm)$/);
  const bytes = readFileSync((await download.path())!);
  if (name.endsWith('.mp4')) expect(bytes.subarray(4, 8).toString('latin1')).toBe('ftyp');
  else expect([...bytes.subarray(0, 4)]).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
  expect(bytes.length).toBeGreaterThan(5000);
  await expect(dialog).toBeHidden({ timeout: 10000 });
});
