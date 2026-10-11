// SPDX-License-Identifier: GPL-3.0-or-later
import * as Comlink from 'comlink';
import type { inspectFont, prepareOpenType } from './shapeFont';
export type FontApi = { inspectFont: typeof inspectFont; prepareOpenType: typeof prepareOpenType };
/** Font parsing is isolated from the editor and bounded by a timeout. */
export async function withFontWorker<T>(work: (api: Comlink.Remote<FontApi>) => Promise<T>): Promise<T> {
  const worker = new Worker(new URL('../worker/lettering.worker.ts', import.meta.url), { type: 'module' });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work(Comlink.wrap<FontApi>(worker)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Font processing exceeded 30 seconds. Try a simpler font or shorter text.')),
          30_000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
    worker.terminate();
  }
}
