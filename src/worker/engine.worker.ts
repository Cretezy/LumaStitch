// SPDX-License-Identifier: GPL-3.0-or-later
/// <reference lib="webworker" />
import * as Comlink from 'comlink';
import { analyzeShapes } from '@/engine/autodigitize/classify';
import { buildPlanAsync, createPlanCache, planTransferables } from '@/engine/plan';
import { optimizeSequence } from '@/engine/sequence/optimize';
import type { EngineApi } from './engineApi';

const cache = createPlanCache();
let latest = 0;

const api: EngineApi = {
  async buildPlan(design, revision) {
    latest = Math.max(latest, revision);
    const plan = await buildPlanAsync(design, { revision, cache, isStale: () => latest > revision });
    if (!plan || latest > revision) return { stale: true };
    return Comlink.transfer(plan, planTransferables(plan));
  },
  async analyze(input) {
    return analyzeShapes(input.shapes, input.options);
  },
  async optimizeSequence(design, opts) {
    return optimizeSequence(design, opts);
  },
};

Comlink.expose(api);
