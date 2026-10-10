// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Drives the raster worker for the image import dialog (ARCHITECTURE §12.1):
 *
 *   load (target size) → quantize (colours, background; preview) → trace (settings; preview)
 *
 * Changes are debounced (~150 ms). Only one pipeline run talks to the worker at a time; a run
 * notices newer input after each await and stops, so stale results are never shown. The worker
 * caches every stage, so moving the detail slider only re-traces. The worker is created on mount
 * and terminated on unmount.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type * as Comlink from 'comlink';
import type { TraceSettings } from '@/model/types';
import type { ImageInfo, QuantizeResult, RasterApi, TracedShapes } from '@/raster/types';
import { createRasterClient, loadImage, terminateRasterClient } from '@/worker/rasterClient';

export type PipelinePhase = 'idle' | 'loading' | 'quantizing' | 'tracing' | 'ready' | 'error';

export interface PipelineInput {
  /** Image source (decoded again for every load, since the bitmap is transferred to the worker). */
  source: Blob | null;
  target: { width?: number; height?: number };
  trace: TraceSettings;
}

export interface PipelineState {
  phase: PipelinePhase;
  info: ImageInfo | null;
  quant: QuantizeResult | null;
  /** Preview trace for the current settings (null until the first one completes). */
  traced: TracedShapes | null;
  error: string | null;
}

const DEBOUNCE_MS = 150;

function targetKey(t: PipelineInput['target']): string {
  return t.width ? `w${t.width}` : t.height ? `h${t.height}` : '-';
}

export function useRasterPipeline(input: PipelineInput) {
  const [state, setState] = useState<PipelineState>({
    phase: 'idle',
    info: null,
    quant: null,
    traced: null,
    error: null,
  });
  const remoteRef = useRef<Comlink.Remote<RasterApi> | null>(null);
  const inputRef = useRef(input);
  const version = useRef(0);
  const loadedKey = useRef<string | null>(null);
  const loadedSource = useRef<Blob | null>(null);
  const quantKey = useRef<string | null>(null);
  const running = useRef<Promise<void> | null>(null);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const disposed = useRef(false);

  useEffect(() => {
    disposed.current = false;
    const remote = createRasterClient();
    remoteRef.current = remote;
    loadedKey.current = null;
    quantKey.current = null;
    return () => {
      disposed.current = true;
      if (timer.current) clearTimeout(timer.current);
      remoteRef.current = null;
      terminateRasterClient(remote);
    };
  }, []);

  const update = useCallback((p: Partial<PipelineState>) => {
    if (!disposed.current) setState((s) => ({ ...s, ...p }));
  }, []);

  /** Brings the worker up to date with the current input: load → quantize (→ preview trace). */
  const runOnce = useCallback(
    async (withPreviewTrace: boolean, rethrow = false) => {
      const remote = remoteRef.current;
      const inp = inputRef.current;
      if (!remote || !inp.source) return;
      const v = version.current;
      const stale = () => disposed.current || version.current !== v;
      try {
        const lk = targetKey(inp.target);
        if (loadedKey.current !== lk || loadedSource.current !== inp.source) {
          update({ phase: 'loading', error: null });
          const bitmap = await createImageBitmap(inp.source);
          if (stale()) {
            bitmap.close();
            return;
          }
          const info = await loadImage(remote, bitmap, inp.target);
          loadedKey.current = lk;
          loadedSource.current = inp.source;
          quantKey.current = null;
          update({ info });
          if (stale()) return;
        }
        const qk = `${inp.trace.colors}|${inp.trace.background}`;
        if (quantKey.current !== qk) {
          update({ phase: 'quantizing', error: null });
          const quant = await remote.quantize({
            colors: inp.trace.colors,
            preview: true,
            background: inp.trace.background,
          });
          quantKey.current = qk;
          update({ quant });
          if (stale()) return;
        }
        if (!withPreviewTrace) return;
        update({ phase: 'tracing', error: null });
        const traced = await remote.trace(inp.trace, true);
        if (stale()) return;
        update({ traced, phase: 'ready' });
      } catch (err) {
        loadedKey.current = null;
        quantKey.current = null;
        if (!stale()) update({ phase: 'error', error: err instanceof Error ? err.message : String(err) });
        if (rethrow) throw err;
      }
    },
    [update],
  );
  const pump = useCallback((): Promise<void> => {
    if (running.current) return running.current;
    const p = (async () => {
      try {
        while (dirty.current && !disposed.current) {
          dirty.current = false;
          await runOnce(true);
        }
      } finally {
        running.current = null;
      }
    })();
    running.current = p;
    return p;
  }, [runOnce]);

  // Schedule a run whenever the input changes.
  const key = JSON.stringify({ t: input.target, s: input.trace });
  useEffect(() => {
    inputRef.current = input;
    version.current++;
    if (!input.source) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      dirty.current = true;
      void pump();
    }, DEBOUNCE_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, input.source, pump]);

  /**
   * Full-resolution trace for the import: waits for any running preview work, makes sure the worker
   * has the current image/size loaded, then traces at full resolution.
   */
  const traceFull = useCallback(
    async (settings: TraceSettings): Promise<TracedShapes> => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      dirty.current = false;
      while (running.current) await running.current;
      const remote = remoteRef.current;
      if (!remote) throw new Error('The image digitizer is not running.');
      version.current++;
      await runOnce(false, true);
      return remote.trace(settings, false);
    },
    [runOnce],
  );

  return { ...state, traceFull };
}
