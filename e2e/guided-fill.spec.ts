import { expect, test } from '@playwright/test';
import { openApp, waitIdle } from './helpers';
import { readFileSync } from 'node:fs';
import type { Design, Shape } from '../src/model/types';

test('make a guided fill from editable geometry, change strategy, undo and reload', async ({ page }) => {
  await openApp(page);
  const design: Design = JSON.parse(
    readFileSync('docs/guided-fill/guided-parallel/guided-parallel.lumastitch', 'utf8'),
  ).design;
  const guidePath = design.shapes.guided.geom.subpaths.find((p) => !p.closed)!;
  design.shapes.guided.geom.subpaths = design.shapes.guided.geom.subpaths.filter((p) => p.closed);
  design.shapes.guided.fill!.type = 'tatami';
  const guide: Shape = {
    id: 'guide',
    name: 'Guide',
    geom: { fillRule: 'nonzero', subpaths: [guidePath] },
    art: { stroke: '#286e86' },
    fill: null,
    outline: {
      ...design.shapes.guided.fill!,
      id: 'guide-outline',
      role: 'outline',
      type: 'running',
      params: {},
    },
  };
  design.shapes[guide.id] = guide;
  design.zOrder.push(guide.id);
  design.sequence.push({ kind: 'element', elementId: guide.outline!.id });
  await page.evaluate(async (design) => {
    const L = (window as any).__lumastitch;
    await L.actions.openDesignObject(design);
    L.useUi.getState().setSelection({ shapeIds: design.zOrder });
  }, design);
  await page.getByRole('menuitem', { name: 'Object', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Make guided fill', exact: true }).click();
  await waitIdle(page);
  const snapshot = () =>
    page.evaluate(() => {
      const d = (window as any).__lumastitch.useDoc.getState().design;
      return d.zOrder.map((id: string) => ({
        type: d.shapes[id].fill?.type,
        paths: d.shapes[id].geom.subpaths.length,
        mode: d.shapes[id].fill?.params.guideMode,
      }));
    });
  expect(await snapshot()).toEqual([{ type: 'guidedFill', paths: 3, mode: 'parallel' }]);
  await page.keyboard.press('ControlOrMeta+z');
  expect((await snapshot()).length).toBe(2);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await waitIdle(page);
  await expect(page.getByText('Guide strategy', { exact: true })).toBeVisible();
  await page.waitForTimeout(1600);
  await page.reload();
  await page.waitForFunction(() => (window as any).__lumastitch?.useDoc.getState().design);
  expect(await snapshot()).toEqual([{ type: 'guidedFill', paths: 3, mode: 'parallel' }]);
});
