// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * A stitch plan drawn into a canvas that fills its parent. The full design is drawn with
 * renderPlanImage; a prefix (playback) with drawPlan({ upTo }) plus a needle marker.
 */
import { useEffect, useRef, useState } from 'react';
import { drawPlan, renderPlanImage } from '@/canvas/stitchRenderer';
import type { StitchPlan } from '@/engine/types';
import type { Viewport } from '@/store/uiStore';
import { cn } from '@/lib/utils';

export interface PlanCanvasProps {
  plan: StitchPlan;
  mode?: 'flat' | 'realistic';
  /** Draw commands 0..upTo only (playback). Omit for the whole design. */
  upTo?: number;
  background?: string;
  /** Padding around the design, CSS px. */
  padding?: number;
  className?: string;
  label: string;
}

/** Same fit as renderPlanImage, so a prefix lines up with the full rendering. */
function fitViewport(plan: StitchPlan, width: number, height: number, pad: number): Viewport {
  const b = plan.bounds;
  const bw = Math.max(1, b.maxX - b.minX);
  const bh = Math.max(1, b.maxY - b.minY);
  const zoom = Math.max(1e-6, Math.min((width - pad * 2) / bw, (height - pad * 2) / bh));
  return {
    zoom,
    pan: [width / 2 - ((b.minX + b.maxX) / 2) * zoom, height / 2 - ((b.minY + b.maxY) / 2) * zoom],
  };
}

export function PlanCanvas({
  plan,
  mode = 'flat',
  upTo,
  background,
  padding = 12,
  className,
  label,
}: PlanCanvasProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<{ w: number; h: number; dpr: number }>({ w: 0, h: 0, dpr: 1 });

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      setSize((s) =>
        s.w === r.width && s.h === r.height && s.dpr === dpr ? s : { w: r.width, h: r.height, dpr },
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.w < 2 || size.h < 2) return;
    const W = Math.round(size.w * size.dpr);
    const H = Math.round(size.h * size.dpr);
    if (canvas.width !== W) canvas.width = W;
    if (canvas.height !== H) canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const pad = padding * size.dpr;
    const full = upTo === undefined || upTo >= plan.flags.length - 1;
    if (full) {
      const img = renderPlanImage(plan, {
        width: W,
        height: H,
        mode,
        padding: pad,
        ...(background ? { background } : {}),
      });
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(img, 0, 0);
      return;
    }
    const vp = fitViewport(plan, W, H, pad);
    drawPlan(ctx, plan, vp, {
      mode,
      jumps: false,
      needlePoints: false,
      upTo,
      dpr: 1,
      ...(background ? { background } : {}),
    });
    // Needle marker at the current position.
    const i = Math.max(0, Math.min(upTo, plan.flags.length - 1));
    if (plan.flags.length) {
      const cx = plan.x[i] * vp.zoom + vp.pan[0];
      const cy = plan.y[i] * vp.zoom + vp.pan[1];
      const r = 7 * size.dpr;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.lineWidth = 1.5 * size.dpr;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.55, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = '#e11d48';
      ctx.beginPath();
      ctx.moveTo(cx - r, cy);
      ctx.lineTo(cx + r, cy);
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx, cy + r);
      ctx.stroke();
      ctx.restore();
    }
  }, [plan, mode, upTo, background, padding, size]);

  return (
    <div ref={wrapRef} className={cn('relative overflow-hidden', className)}>
      <canvas ref={canvasRef} role="img" aria-label={label} className="absolute inset-0 size-full" />
    </div>
  );
}
