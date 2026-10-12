import { expect, test } from '@playwright/test';
import { importFile, openApp, waitIdle } from './helpers';

test('density worker visualization and optional sewing-field export warnings', async ({ page }) => {
  await openApp(page);
  await importFile(page, 'svg/basic-shapes.svg', 'image/svg+xml');
  await page.getByRole('dialog').getByRole('button', { name: 'Import', exact: true }).click();
  await waitIdle(page);
  await page.getByRole('menuitem', { name: 'View', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Needle density map' }).click();
  await expect(page.getByText(/^Peak .*penetrations\/mm²/)).toBeVisible();
  await page.getByLabel('Density radius').selectOption('2');
  await expect(page.getByText(/^Peak .*penetrations\/mm²/)).toBeVisible();
  await page.getByRole('menuitem', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Design settings…' }).click();
  await page.getByRole('switch', { name: 'Check hoop sewing field' }).click();
  await page.getByRole('textbox', { name: 'Hoop width' }).fill('10');
  await page.getByRole('textbox', { name: 'Hoop width' }).press('Enter');
  await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
  await expect(page.getByLabel('Design exceeds sewing field')).toBeVisible();
  await page.getByTestId('toolbar-export').click();
  await expect(page.getByRole('dialog').getByText(/fall outside the selected/)).toBeVisible();
});
