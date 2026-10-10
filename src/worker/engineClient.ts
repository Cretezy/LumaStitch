// SPDX-License-Identifier: GPL-3.0-or-later
import * as Comlink from 'comlink';
import type { EngineApi } from './engineApi';

let instance: Comlink.Remote<EngineApi> | null = null;

/** Lazily-created singleton engine worker. */
export function engine(): Comlink.Remote<EngineApi> {
  if (!instance) {
    const worker = new Worker(new URL('./engine.worker.ts', import.meta.url), {
      type: 'module',
      name: 'engine',
    });
    instance = Comlink.wrap<EngineApi>(worker);
  }
  return instance;
}
