import { expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const fixture = (rel: string) => fileURLToPath(new URL(`../tests/fixtures/${rel}`, import.meta.url));

/** Opens the app with test hooks; forces download fallback (no File System Access pickers in automation). */
export async function openApp(page: Page) {
  await page.addInitScript(() => {
    delete (window as any).showSaveFilePicker;
    delete (window as any).showOpenFilePicker;
  });
  await page.goto('/?testHooks');
  await page.waitForFunction(() => (window as any).__lumastitch);
}

/** Drops a fixture file onto the page via the app's file handler. */
export async function importFile(page: Page, rel: string, type: string) {
  const b64 = readFileSync(fixture(rel)).toString('base64');
  const name = rel.split('/').pop()!;
  await page.evaluate(
    async ({ b64, name, type }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      await (window as any).__lumastitch.actions.handleFile(new File([bytes], name, { type }), {
        intoCurrent: true,
      });
    },
    { b64, name, type },
  );
}

export async function planStats(page: Page) {
  return page.evaluate(async () => {
    const L = (window as any).__lumastitch;
    const plan = await L.waitForPlan();
    return { ...plan.stats, colors: plan.colorBlocks.length, bounds: plan.bounds, n: plan.flags.length };
  });
}

export async function waitIdle(page: Page) {
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const L = (window as any).__lumastitch;
          return (
            L.usePlan.getState().status === 'idle' &&
            L.usePlan.getState().builtRevision === L.useDoc.getState().revision
          );
        }),
      { timeout: 20000 },
    )
    .toBe(true);
}
