// SPDX-License-Identifier: GPL-3.0-or-later
/** Autosave: ~1 s after each change, write the open design (and a stitch thumbnail) to the library. */
import { renderPlanImage } from '@/canvas/stitchRenderer';
import type { StitchPlan } from '@/engine/types';
import { saveDesign, setPref, type DesignMeta } from '@/library/library';
import { useDoc } from '@/store/documentStore';
import { usePlan } from '@/store/planStore';

let timer: ReturnType<typeof setTimeout> | null = null;
let started = false;
let pending = false;

export async function planThumbnail(plan: StitchPlan | null, size = 240): Promise<Blob | undefined> {
  if (!plan || !plan.stats.stitches) return undefined;
  try {
    const c = renderPlanImage(plan, { width: size, height: size, padding: 12 });
    if ('convertToBlob' in c) return await c.convertToBlob({ type: 'image/png' });
    return await new Promise<Blob | undefined>((res) =>
      (c as HTMLCanvasElement).toBlob((b) => res(b ?? undefined), 'image/png'),
    );
  } catch {
    return undefined;
  }
}

export async function flushAutosave(): Promise<void> {
  if (timer) clearTimeout(timer);
  timer = null;
  const { design, designId, revision } = useDoc.getState();
  if (!design || !designId) return;
  pending = false;
  const p = usePlan.getState();
  const extra: Partial<DesignMeta> = {};
  if (p.plan && p.builtRevision === revision) {
    extra.thumbnail = await planThumbnail(p.plan);
    extra.stitches = p.plan.stats.stitches;
    extra.colors = p.plan.colorBlocks.length;
    extra.widthMm = p.plan.bounds.maxX - p.plan.bounds.minX;
    extra.heightMm = p.plan.bounds.maxY - p.plan.bounds.minY;
  }
  await saveDesign(designId, design, extra);
}

export function startAutosave(delayMs = 1000): void {
  if (started) return;
  started = true;
  useDoc.subscribe((s, prev) => {
    if (s.designId && s.designId !== prev.designId) void setPref('lastOpenId', s.designId);
    if (!s.designId && prev.designId) void setPref('lastOpenId', null);
    if (s.revision === prev.revision || !s.design || !s.designId) return;
    if (s.designId !== prev.designId) return; // just opened; nothing changed yet
    pending = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void flushAutosave(), delayMs);
  });
  // Refresh the thumbnail once the plan for the latest revision arrives.
  usePlan.subscribe((s, prev) => {
    if (
      s.builtRevision !== prev.builtRevision &&
      !pending &&
      useDoc.getState().designId &&
      s.builtRevision === useDoc.getState().revision
    ) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void flushAutosave(), delayMs);
    }
  });
  window.addEventListener('beforeunload', () => {
    if (pending) void flushAutosave();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && pending) void flushAutosave();
  });
}
