import { expect, test } from '@playwright/test';
import { importFile, openApp, waitIdle } from './helpers';

for (const ext of ['pes', 'dst', 'jef', 'exp', 'vp3']) {
  test(`editable ${ext.toUpperCase()} import preserves commands through editing and reload`, async ({
    page,
  }) => {
    await openApp(page);
    await importFile(
      page,
      ext === 'pes' ? 'pes/three_colors.v6.pes' : `formats/three_colors.${ext}`,
      'application/octet-stream',
    );
    await expect(page.getByRole('dialog').getByText(/needle penetrations/)).toBeVisible();
    await page.getByRole('button', { name: 'Import stitches', exact: true }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await waitIdle(page);
    const first = await page.evaluate(() => {
      const L = (window as any).__lumastitch;
      const d = L.useDoc.getState().design;
      const s = d.shapes[d.zOrder[0]];
      const idx = s.geom.subpaths[0].nodes.findIndex((n: any) => !n.command);
      L.useUi
        .getState()
        .setSelection({ shapeIds: [s.id], elementIds: [], nodes: [{ shapeId: s.id, sub: 0, idx }] });
      return { shapeId: s.id, idx };
    });
    const command = () =>
      page.evaluate(
        ({ shapeId, idx }) =>
          (window as any).__lumastitch.useDoc.getState().design.shapes[shapeId].geom.subpaths[0].nodes[idx]
            .command ?? 'stitch',
        first,
      );
    await page.getByLabel('Selected machine command').selectOption('jump');
    await expect.poll(command).toBe('jump');
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(command).toBe('stitch');
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect.poll(command).toBe('jump');
    await page.waitForTimeout(1600);
    await page.reload();
    await page.waitForFunction(() => (window as any).__lumastitch?.useDoc.getState().design);
    expect(await command()).toBe('jump');
  });
}
