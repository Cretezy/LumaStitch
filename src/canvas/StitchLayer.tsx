// SPDX-License-Identifier: GPL-3.0-or-later
/** Canvas2D stitch layer (flat / realistic), including incremental simulator progress rendering. */
import { useEffect, useRef } from 'react';
import { usePlan } from '@/store/planStore';
import { useUi } from '@/store/uiStore';
import { selectedElementIds } from '@/store/commands';
import { useDoc } from '@/store/documentStore';
import { sim } from '@/simulator/controller';
import { blitTransformed, drawPlan, drawPrefixFlat, drawRealistic } from './stitchRenderer';
import type { Viewport } from '@/store/uiStore';

export function StitchLayer() {
  const ref = useRef<HTMLCanvasElement>(null);
  const plan = usePlan((s) => s.plan);
  const viewport = useUi((s) => s.viewport);
  const size = useUi((s) => s.canvasSize);
  const view = useUi((s) => s.view);
  const mode = useUi((s) => s.viewMode);
  const selection = useUi((s) => s.selection);
  const hover = useUi((s) => s.hover);
  const dragging = useUi((s) => s.dragPreview !== null);
  const simActive = useUi((s) => s.sim.active);
  const design = useDoc((s) => s.design);

  // Size the backing store.
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(size.width * dpr);
    c.height = Math.round(size.height * dpr);
  }, [size]);

  // Normal (editing) rendering. Viewport-only changes blit a transformed snapshot immediately and
  // re-render fully ~120 ms after the gesture ends (keeps pan/zoom at 60 fps on large designs).
  const snap = useRef<{ canvas: HTMLCanvasElement; vp: Viewport; key: unknown[] } | null>(null);
  const redrawTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c || simActive) return;
    const dpr = window.devicePixelRatio || 1;
    const ctx = c.getContext('2d')!;
    if (redrawTimer.current) clearTimeout(redrawTimer.current);
    if (!plan || mode === 'artwork') {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, c.width, c.height);
      snap.current = null;
      return;
    }
    const key = [plan, view, mode, selection, hover, size, design];
    const full = () => {
      const ids = design ? new Set(selectedElementIds(design)) : new Set<string>();
      drawPlan(ctx, plan, viewport, {
        mode: mode === 'realistic' ? 'realistic' : 'flat',
        jumps: view.jumps,
        needlePoints: view.needlePoints,
        underlayHighlight: view.underlay,
        highlight: ids,
        hover: hover?.elementId ?? null,
        dpr,
      });
      // Keep a snapshot for gesture-time transforms (none while the canvas has no size, e.g. hidden).
      if (!c.width || !c.height) {
        snap.current = null;
        return;
      }
      let sc = snap.current?.canvas;
      if (!sc || sc.width !== c.width || sc.height !== c.height) {
        sc = document.createElement('canvas');
        sc.width = c.width;
        sc.height = c.height;
      }
      const sctx = sc.getContext('2d')!;
      sctx.clearRect(0, 0, sc.width, sc.height);
      sctx.drawImage(c, 0, 0);
      snap.current = { canvas: sc, vp: viewport, key };
    };
    const prev = snap.current;
    const viewportOnly =
      prev &&
      prev.key.length === key.length &&
      prev.key.every((k, i) => k === key[i]) &&
      prev.vp !== viewport;
    // Small designs re-render directly; large ones use the snapshot while the viewport moves.
    if (viewportOnly && plan.flags.length > 20000) {
      blitTransformed(ctx, prev.canvas, prev.vp, viewport, dpr);
      redrawTimer.current = setTimeout(full, 120);
    } else full();
    return () => {
      if (redrawTimer.current) clearTimeout(redrawTimer.current);
    };
  }, [plan, viewport, size, view, mode, selection, hover, simActive, design]);

  // Simulator rendering: incremental forward drawing, full redraw on seek back / viewport change.
  useEffect(() => {
    const c = ref.current;
    if (!c || !simActive || !plan) return;
    const dpr = window.devicePixelRatio || 1;
    const ctx = c.getContext('2d')!;
    const realistic = mode === 'realistic';
    let drawn = -1;
    const draw = (target: number) => {
      target = Math.min(target, plan.flags.length - 1);
      if (drawn < 0 || target < drawn) {
        drawPlan(ctx, plan, viewport, {
          mode: realistic ? 'realistic' : 'flat',
          jumps: false,
          needlePoints: false,
          upTo: target,
          dpr,
        });
      } else if (target > drawn) {
        ctx.save();
        ctx.setTransform(
          viewport.zoom * dpr,
          0,
          0,
          viewport.zoom * dpr,
          viewport.pan[0] * dpr,
          viewport.pan[1] * dpr,
        );
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        if (realistic) drawRealistic(ctx, plan, viewport, target, null, drawn);
        else drawPrefixFlat(ctx, plan, viewport, target, drawn);
        ctx.restore();
      }
      drawn = target;
    };
    draw(Math.floor(sim.index));
    return sim.subscribe(draw);
  }, [simActive, plan, viewport, size, mode]);

  return (
    <canvas
      ref={ref}
      className="pointer-events-none absolute inset-0 size-full"
      style={{ opacity: dragging ? 0.35 : 1 }}
    />
  );
}
