import { expect, test } from '@playwright/test';
import { openApp, waitIdle } from './helpers';

test('flat 4-colour PNG logo at 90 mm → 4 threads, background unstitched, no gaps (acceptance 3)', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openApp(page);
  // Draw an anti-aliased 4-colour logo on white and import it as a PNG file.
  await page.evaluate(async () => {
    const c = new OffscreenCanvas(600, 400);
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 600, 400);
    ctx.fillStyle = '#d62828';
    ctx.beginPath();
    ctx.arc(170, 200, 130, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#003049';
    ctx.fillRect(140, 170, 330, 60);
    ctx.fillStyle = '#2a9d8f';
    ctx.beginPath();
    ctx.moveTo(380, 60);
    ctx.lineTo(560, 340);
    ctx.lineTo(330, 340);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#f4a261';
    ctx.beginPath();
    ctx.arc(170, 200, 45, 0, Math.PI * 2);
    ctx.fill();
    const blob = await c.convertToBlob({ type: 'image/png' });
    const file = new File([blob], 'logo.png', { type: 'image/png' });
    await (window as any).__lumastitch.actions.handleFile(file, { intoCurrent: true });
  });
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  // Width 90 mm.
  const width = dialog.getByLabel(/width/i).first();
  await width.fill('90');
  await width.press('Tab');
  await page.waitForTimeout(1500);
  await dialog
    .getByRole('button', { name: /^Import/ })
    .last()
    .click();
  await expect(dialog).toBeHidden({ timeout: 60_000 });
  await waitIdle(page);

  const r = await page.evaluate(async () => {
    const L = (window as any).__lumastitch;
    const d = L.useDoc.getState().design;
    const plan = await L.waitForPlan();
    const fills = Object.values(d.shapes).filter((s: any) => s.fill) as any[];
    const threads = new Set(fills.map((s) => d.threads[s.fill.threadId].color));
    // Coverage: rasterise the stitched regions and compare with the non-white pixels of the source.
    const W = 600,
      H = 400;
    const m = d.artwork.matrix; // px → mm
    const inv = (x: number, y: number) => {
      const det = m[0] * m[3] - m[1] * m[2];
      const xx = x - m[4],
        yy = y - m[5];
      return [(m[3] * xx - m[2] * yy) / det, (-m[1] * xx + m[0] * yy) / det];
    };
    const cov = new OffscreenCanvas(W, H);
    const cx = cov.getContext('2d')!;
    cx.fillStyle = '#000';
    for (const s of fills) {
      const p = new Path2D();
      for (const sp of s.geom.subpaths) {
        const n = sp.nodes;
        const P = (q: number[]) => inv(q[0], q[1]);
        const a = P(n[0].p);
        p.moveTo(a[0], a[1]);
        const seg = (u: any, v: any) => {
          const c1 = P([u.p[0] + (u.out?.[0] ?? 0), u.p[1] + (u.out?.[1] ?? 0)]);
          const c2 = P([v.p[0] + (v.in?.[0] ?? 0), v.p[1] + (v.in?.[1] ?? 0)]);
          const e = P(v.p);
          p.bezierCurveTo(c1[0], c1[1], c2[0], c2[1], e[0], e[1]);
        };
        for (let i = 1; i < n.length; i++) seg(n[i - 1], n[i]);
        if (sp.closed) {
          seg(n[n.length - 1], n[0]);
          p.closePath();
        }
      }
      cx.fill(p, s.geom.fillRule);
    }
    const covered = cx.getImageData(0, 0, W, H).data;
    // Reference: same drawing as the source logo (non-white = should be stitched).
    const ref = new OffscreenCanvas(W, H);
    const rc = ref.getContext('2d')!;
    rc.fillStyle = '#000';
    rc.beginPath();
    rc.arc(170, 200, 130, 0, Math.PI * 2);
    rc.fill();
    rc.fillRect(140, 170, 330, 60);
    rc.beginPath();
    rc.moveTo(380, 60);
    rc.lineTo(560, 340);
    rc.lineTo(330, 340);
    rc.closePath();
    rc.fill();
    const want = rc.getImageData(0, 0, W, H).data;
    let need = 0,
      miss = 0,
      extra = 0;
    for (let i = 3; i < want.length; i += 4) {
      // Ignore the 2 px anti-aliased fringe by only counting solid pixels.
      if (want[i] === 255) {
        need++;
        if (covered[i] < 128) miss++;
      } else if (want[i] === 0 && covered[i] > 200) extra++;
    }
    return {
      threads: threads.size,
      colorBlocks: plan.colorBlocks.length,
      artwork: d.artwork?.kind,
      widthMm: plan.bounds.maxX - plan.bounds.minX,
      growth: fills.every((s) => s.fill.params.cutoutGrowth > 0),
      missFrac: miss / need,
      extraFrac: extra / (W * H),
      stitches: plan.stats.stitches,
    };
  });
  expect(r.artwork).toBe('image');
  expect(r.threads).toBe(4);
  expect(r.colorBlocks).toBeGreaterThanOrEqual(4);
  // The 90 mm target is the whole image; the logo spans 520 of its 600 px.
  expect(r.widthMm).toBeGreaterThan(90 * (520 / 600) - 1.5);
  expect(r.widthMm).toBeLessThan(90 * (520 / 600) + 2);
  expect(r.growth).toBe(true);
  expect(r.missFrac).toBeLessThan(0.01);
  expect(r.extraFrac).toBeLessThan(0.01);
  expect(r.stitches).toBeGreaterThan(1500);
});
