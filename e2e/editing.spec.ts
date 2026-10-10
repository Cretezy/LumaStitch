import { expect, test, type Page } from '@playwright/test';
import { importFile, openApp, waitIdle } from './helpers';

async function setup(page: Page) {
  await openApp(page);
  await importFile(page, 'svg/basic-shapes.svg', 'image/svg+xml');
  await page.getByRole('dialog').getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden({ timeout: 20000 });
  await waitIdle(page);
}

/** Screen position (page coords) of a document point. */
async function toPage(page: Page, p: [number, number]) {
  const box = (await page.getByTestId('canvas').boundingBox())!;
  const v = await page.evaluate(() => (window as any).__lumastitch.useUi.getState().viewport);
  return { x: box.x + p[0] * v.zoom + v.pan[0], y: box.y + p[1] * v.zoom + v.pan[1] };
}

async function shapeByName(page: Page, name: string) {
  return page.evaluate((n) => {
    const d = (window as any).__lumastitch.useDoc.getState().design;
    return Object.values(d.shapes).find((s: any) => s.name === n) as any;
  }, name);
}

const bboxOf = (s: any) => {
  const xs = s.geom.subpaths.flatMap((sp: any) => sp.nodes.map((n: any) => n.p[0]));
  const ys = s.geom.subpaths.flatMap((sp: any) => sp.nodes.map((n: any) => n.p[1]));
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
};

test('select tool: click selects, drag moves (one undo step), handles scale', async ({ page }) => {
  await setup(page);
  await page
    .getByRole('radio', { name: 'Artwork' })
    .or(page.getByText('Artwork', { exact: true }))
    .first()
    .click();
  const box0 = bboxOf(await shapeByName(page, 'box'));
  const c = await toPage(page, [(box0.minX + box0.maxX) / 2, (box0.minY + box0.maxY) / 2]);
  await page.mouse.click(c.x, c.y);
  const sel = await page.evaluate(
    () => (window as any).__lumastitch.useUi.getState().selection.shapeIds.length,
  );
  expect(sel).toBe(1);
  // Drag by 5 mm to the right.
  const zoom = await page.evaluate(() => (window as any).__lumastitch.useUi.getState().viewport.zoom);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x + 2.5 * zoom, c.y, { steps: 4 });
  await page.mouse.move(c.x + 5 * zoom, c.y, { steps: 4 });
  await page.mouse.up();
  const box1 = bboxOf(await shapeByName(page, 'box'));
  expect(box1.minX - box0.minX).toBeCloseTo(5, 1);
  await page.keyboard.press('ControlOrMeta+z');
  const box2 = bboxOf(await shapeByName(page, 'box'));
  expect(box2.minX).toBeCloseTo(box0.minX, 6);
  // Scale with the east handle: drag right by 10 mm (width 20 → 30).
  const e = await toPage(page, [box2.maxX, (box2.minY + box2.maxY) / 2]);
  await page.mouse.move(e.x, e.y);
  await page.mouse.down();
  await page.mouse.move(e.x + 10 * zoom, e.y, { steps: 6 });
  await page.mouse.up();
  const box3 = bboxOf(await shapeByName(page, 'box'));
  expect(box3.maxX - box3.minX).toBeCloseTo(30, 0);
  expect(box3.minX).toBeCloseTo(box2.minX, 3);
});

test('marquee selects several shapes; Delete removes them; undo restores', async ({ page }) => {
  await setup(page);
  const n0 = await page.evaluate(
    () => Object.keys((window as any).__lumastitch.useDoc.getState().design.shapes).length,
  );
  const a = await toPage(page, [-48, -24]);
  const b = await toPage(page, [1, -4]);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
  const sel = await page.evaluate(
    () => (window as any).__lumastitch.useUi.getState().selection.shapeIds.length,
  );
  expect(sel).toBe(2);
  await page.keyboard.press('Delete');
  const n1 = await page.evaluate(
    () => Object.keys((window as any).__lumastitch.useDoc.getState().design.shapes).length,
  );
  expect(n1).toBe(n0 - 2);
  await page.keyboard.press('ControlOrMeta+z');
  const n2 = await page.evaluate(
    () => Object.keys((window as any).__lumastitch.useDoc.getState().design.shapes).length,
  );
  expect(n2).toBe(n0);
});

test('direct select: drag a node; double-click adds a node', async ({ page }) => {
  await setup(page);
  const box = await shapeByName(page, 'box');
  await page.evaluate(
    (id) =>
      (window as any).__lumastitch.useUi
        .getState()
        .setSelection({ shapeIds: [id], elementIds: [], nodes: [] }),
    box.id,
  );
  await page.keyboard.press('a');
  const n0 = box.geom.subpaths[0].nodes[0].p;
  const p = await toPage(page, n0);
  const zoom = await page.evaluate(() => (window as any).__lumastitch.useUi.getState().viewport.zoom);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x - 3 * zoom, p.y - 3 * zoom, { steps: 6 });
  await page.mouse.up();
  const moved = (await shapeByName(page, 'box')).geom.subpaths[0].nodes[0].p;
  expect(moved[0]).toBeCloseTo(n0[0] - 3, 1);
  expect(moved[1]).toBeCloseTo(n0[1] - 3, 1);
  // Double-click the middle of the bottom edge adds a node.
  const b = bboxOf(await shapeByName(page, 'box'));
  const mid = await toPage(page, [
    (box.geom.subpaths[0].nodes[2].p[0] + box.geom.subpaths[0].nodes[3].p[0]) / 2,
    b.maxY,
  ]);
  await page.mouse.dblclick(mid.x, mid.y);
  const count = (await shapeByName(page, 'box')).geom.subpaths[0].nodes.length;
  expect(count).toBe(5);
});

test('boolean unite via the Path menu', async ({ page }) => {
  await setup(page);
  const ids = await page.evaluate(() => {
    const d = (window as any).__lumastitch.useDoc.getState().design;
    const names = ['dot', 'oval'];
    const ids = Object.values(d.shapes)
      .filter((s: any) => names.includes(s.name))
      .map((s: any) => s.id);
    (window as any).__lumastitch.useUi.getState().setSelection({ shapeIds: ids, elementIds: [], nodes: [] });
    return ids;
  });
  expect(ids.length).toBe(2);
  await page.getByRole('menuitem', { name: 'Path' }).click();
  await page.getByRole('menuitem', { name: 'Unite' }).click();
  const r = await page.evaluate(() => {
    const L = (window as any).__lumastitch;
    const d = L.useDoc.getState().design;
    return {
      n: Object.keys(d.shapes).length,
      sel: L.useUi.getState().selection.shapeIds.length,
      names: Object.values(d.shapes).map((s: any) => s.name),
    };
  });
  expect(r.n).toBe(7);
  expect(r.sel).toBe(1);
  await waitIdle(page);
});

test('simulator: R starts, keys step, Escape exits', async ({ page }) => {
  await setup(page);
  await page.keyboard.press('r');
  await expect(page.getByTestId('simulator-bar')).toBeVisible();
  await page.keyboard.press('End');
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  const idx = await page.evaluate(() => (window as any).__lumastitch.useUi.getState().sim.index);
  expect(idx).toBeGreaterThan(2);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('simulator-bar')).toBeHidden();
});

test('start marker can be dragged on the canvas (one undo step)', async ({ page }) => {
  await setup(page);
  const box = await shapeByName(page, 'box');
  await page.evaluate((s) => {
    const L = (window as any).__lumastitch;
    L.commands.setElementProps([s.fill.id], { entry: s.geom.subpaths[0].nodes[0].p });
    L.useUi.getState().setSelection({ shapeIds: [s.id], elementIds: [s.fill.id], nodes: [] });
  }, box);
  const start = box.geom.subpaths[0].nodes[0].p as [number, number];
  const p = await toPage(page, start);
  const zoom = await page.evaluate(() => (window as any).__lumastitch.useUi.getState().viewport.zoom);
  const past0 = await page.evaluate(() => (window as any).__lumastitch.useDoc.getState().past.length);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + 4 * zoom, p.y + 2 * zoom, { steps: 6 });
  await page.mouse.up();
  const r = await page.evaluate(() => {
    const L = (window as any).__lumastitch;
    const d = L.useDoc.getState().design;
    const s = Object.values(d.shapes).find((x: any) => x.name === 'box') as any;
    return { entry: s.fill.entry, past: L.useDoc.getState().past.length };
  });
  expect(r.entry[0]).toBeCloseTo(start[0] + 4, 0);
  expect(r.entry[1]).toBeCloseTo(start[1] + 2, 0);
  expect(r.past).toBe(past0 + 1);
});

test('navigation: wheel zooms, trackpad scroll and right-drag pan, keys pan and zoom', async ({ page }) => {
  await setup(page);
  const vp = () => page.evaluate(() => (window as any).__lumastitch.useUi.getState().viewport);
  const box = (await page.getByTestId('canvas').boundingBox())!;
  const cx = box.x + box.width / 2,
    cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  // Mouse wheel notch: zoom at the cursor.
  const v0 = await vp();
  await page.mouse.wheel(0, -100);
  const v1 = await vp();
  expect(v1.zoom).toBeGreaterThan(v0.zoom);
  // Trackpad-style scroll (fractional, two axes): pans without zooming.
  await page.mouse.wheel(12.5, 7.5);
  const v2 = await vp();
  expect(v2.zoom).toBeCloseTo(v1.zoom, 6);
  expect(v2.pan[0]).toBeCloseTo(v1.pan[0] - 12.5, 3);
  expect(v2.pan[1]).toBeCloseTo(v1.pan[1] - 7.5, 3);
  // Right-drag pans.
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(cx + 80, cy + 40, { steps: 5 });
  await page.mouse.up({ button: 'right' });
  const v3 = await vp();
  expect(v3.pan[0] - v2.pan[0]).toBeCloseTo(80, 0);
  expect(v3.pan[1] - v2.pan[1]).toBeCloseTo(40, 0);
  // Keys: arrows pan with nothing selected; = zooms; 0 fits.
  await page.evaluate(() => (window as any).__lumastitch.useUi.getState().clearSelection());
  await page.keyboard.press('ArrowLeft');
  const v4 = await vp();
  expect(v4.pan[0] - v3.pan[0]).toBeCloseTo(60, 3);
  await page.keyboard.press('=');
  expect((await vp()).zoom).toBeGreaterThan(v4.zoom);
  await page.keyboard.press('0');
  const v5 = await vp();
  await page.getByRole('button', { name: 'Zoom in' }).click();
  expect((await vp()).zoom).toBeGreaterThan(v5.zoom);
});
