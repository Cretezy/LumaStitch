// SPDX-License-Identifier: GPL-3.0-or-later
/** Latest StitchPlan from the engine worker; regenerated after every document change. */
import { create } from 'zustand';
import type { StitchPlan } from '@/engine/types';
import { engine } from '@/worker/engineClient';
import { useDoc } from './documentStore';

export interface PlanState {
  plan: StitchPlan | null;
  status: 'idle' | 'building' | 'error';
  error: string | null;
  /** Revision of the document the current plan was built from. */
  builtRevision: number;
  lastBuildMs: number;
}

export const usePlan = create<PlanState>(() => ({
  plan: null,
  status: 'idle',
  error: null,
  builtRevision: -1,
  lastBuildMs: 0,
}));

let timer: ReturnType<typeof setTimeout> | null = null;
let started = false;

/** Starts watching the document and regenerating the plan (debounced ~80 ms). */
export function startPlanSync(debounceMs = 80): void {
  if (started) return;
  started = true;
  const kick = () => {
    if (timer) clearTimeout(timer);
    const { design, revision } = useDoc.getState();
    if (!design) {
      usePlan.setState({ plan: null, status: 'idle', builtRevision: revision });
      return;
    }
    usePlan.setState({ status: 'building' });
    timer = setTimeout(async () => {
      const t0 = performance.now();
      try {
        const res = await engine().buildPlan(design, revision);
        if ('stale' in res) return;
        if (useDoc.getState().revision !== revision && usePlan.getState().builtRevision > revision) return;
        const latest = useDoc.getState().revision === revision;
        usePlan.setState({
          plan: res,
          status: latest ? 'idle' : 'building',
          error: null,
          builtRevision: revision,
          lastBuildMs: performance.now() - t0,
        });
      } catch (err) {
        console.error(err);
        usePlan.setState({ status: 'error', error: String(err) });
      }
    }, debounceMs);
  };
  useDoc.subscribe((s, prev) => {
    // Never show (or export) the previous design's stitches for a newly opened one.
    if (s.designId !== prev.designId) usePlan.setState({ plan: null, builtRevision: -1, error: null });
    if (s.revision !== prev.revision) kick();
  });
  kick();
}

/**
 * Resolves with the plan once it matches the current document revision, or null if generation
 * failed or timed out (callers must not use a stale plan for export).
 */
export function waitForPlan(timeoutMs = 20000): Promise<StitchPlan | null> {
  return new Promise((resolve) => {
    const check = () => {
      const p = usePlan.getState();
      const rev = useDoc.getState().revision;
      if (p.status === 'error') return null;
      if (p.builtRevision === rev && p.status !== 'building') return p.plan;
      return undefined;
    };
    const now = check();
    if (now !== undefined) return resolve(now);
    const t = setTimeout(() => {
      unsub();
      resolve(null);
    }, timeoutMs);
    const unsub = usePlan.subscribe(() => {
      const v = check();
      if (v !== undefined) {
        clearTimeout(t);
        unsub();
        resolve(v);
      }
    });
  });
}
