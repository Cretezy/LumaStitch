import { expect, test } from '@playwright/test';
import { importFile, openApp, waitIdle } from './helpers';

test('works offline after the first load, with no network requests while editing (acceptance 9)', async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  await openApp(page);
  // Wait until the service worker has precached the build and controls the page.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise((r) =>
        navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }),
      );
  });

  const external: string[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (
      !['localhost', '127.0.0.1'].includes(u.hostname) &&
      !u.protocol.startsWith('blob') &&
      !u.protocol.startsWith('data')
    )
      external.push(r.url());
  });
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => (window as any).__lumastitch);

  // Full editing workflow while offline, including lazily loaded dialogs, workers and thread charts.
  await importFile(page, 'svg/illustrator.svg', 'image/svg+xml');
  await page.getByRole('dialog').getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden({ timeout: 20000 });
  await waitIdle(page);
  const stitches = await page.evaluate(
    () => (window as any).__lumastitch.usePlan.getState().plan.stats.stitches,
  );
  expect(stitches).toBeGreaterThan(500);
  await page.getByRole('tab', { name: /Threads/ }).click();
  await page.getByRole('button', { name: 'Map' }).click();
  await expect(page.getByText(/Threads mapped/)).toBeVisible({ timeout: 10000 });
  await page.getByTestId('toolbar-export').click();
  await expect(page.getByRole('dialog').getByText('Ready to export')).toBeVisible({ timeout: 20000 });
  expect(external).toEqual([]);
  await context.setOffline(false);
});
