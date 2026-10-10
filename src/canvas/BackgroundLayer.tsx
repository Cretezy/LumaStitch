// SPDX-License-Identifier: GPL-3.0-or-later
/** Fabric colour, grid, origin mark, design bounding box and its W×H dimension label. */
import { useEffect, useRef } from 'react';
import { useDoc } from '@/store/documentStore';
import { useUi } from '@/store/uiStore';
import { usePlan } from '@/store/planStore';
import { designBBox } from '@/store/commands';
import { isEmptyBBox } from '@/geom/polygon';
import { fmt } from '@/lib/utils';

function gridStep(zoom: number): number {
  // Minor grid step in mm so lines are ≥ 8 px apart.
  for (const s of [0.1, 0.5, 1, 5, 10, 50, 100]) if (s * zoom >= 8) return s;
  return 100;
}

const RULER = 18;

export function drawRulers(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  zoom: number,
  pan: [number, number],
  dark: boolean,
) {
  // Label step: a "nice" mm step so labels are ≥ 50 px apart.
  let step = 1;
  for (const s of [1, 2, 5, 10, 20, 50, 100, 200, 500]) {
    step = s;
    if (s * zoom >= 50) break;
  }
  const minor = step / (step % 5 === 0 ? 5 : 2);
  ctx.save();
  ctx.fillStyle = dark ? 'rgba(30,30,32,0.92)' : 'rgba(255,255,255,0.92)';
  ctx.fillRect(0, 0, w, RULER);
  ctx.fillRect(0, 0, RULER, h);
  ctx.strokeStyle = dark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.35)';
  ctx.fillStyle = dark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)';
  ctx.font = '9px Inter, system-ui, sans-serif';
  ctx.lineWidth = 1;
  ctx.beginPath();
  const x0 = Math.floor(-pan[0] / zoom / minor) * minor,
    x1 = (w - pan[0]) / zoom;
  for (let x = x0; x <= x1; x += minor) {
    const px = Math.round(x * zoom + pan[0]) + 0.5;
    if (px < RULER) continue;
    const major = Math.abs(x / step - Math.round(x / step)) < 1e-6;
    ctx.moveTo(px, RULER);
    ctx.lineTo(px, major ? 4 : 12);
    if (major) ctx.fillText(String(Math.round(x)), px + 2, 9);
  }
  const y0 = Math.floor(-pan[1] / zoom / minor) * minor,
    y1 = (h - pan[1]) / zoom;
  for (let y = y0; y <= y1; y += minor) {
    const py = Math.round(y * zoom + pan[1]) + 0.5;
    if (py < RULER) continue;
    const major = Math.abs(y / step - Math.round(y / step)) < 1e-6;
    ctx.moveTo(RULER, py);
    ctx.lineTo(major ? 4 : 12, py);
    if (major) {
      ctx.save();
      ctx.translate(9, py + 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(String(Math.round(y)), 0, 0);
      ctx.restore();
    }
  }
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, RULER + 0.5);
  ctx.lineTo(w, RULER + 0.5);
  ctx.moveTo(RULER + 0.5, 0);
  ctx.lineTo(RULER + 0.5, h);
  ctx.stroke();
  ctx.fillStyle = dark ? 'rgba(30,30,32,1)' : 'rgba(250,250,250,1)';
  ctx.fillRect(0, 0, RULER, RULER);
  ctx.restore();
}

export function BackgroundLayer() {
  const ref = useRef<HTMLCanvasElement>(null);
  const viewport = useUi((s) => s.viewport);
  const size = useUi((s) => s.canvasSize);
  const view = useUi((s) => s.view);
  const design = useDoc((s) => s.design);
  const plan = usePlan((s) => s.plan);
  const viewMode = useUi((s) => s.viewMode);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(size.width * dpr);
    c.height = Math.round(size.height * dpr);
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const dark = document.documentElement.classList.contains('dark');
    ctx.fillStyle = viewMode === 'artwork' ? (dark ? '#2a2a2e' : '#f4f4f5') : view.fabricColor;
    ctx.fillRect(0, 0, size.width, size.height);
    const { zoom, pan } = viewport;
    if (view.grid) {
      const step = gridStep(zoom);
      const major = step * 10;
      const x0 = Math.floor(-pan[0] / zoom / step) * step;
      const y0 = Math.floor(-pan[1] / zoom / step) * step;
      const x1 = (size.width - pan[0]) / zoom,
        y1 = (size.height - pan[1]) / zoom;
      for (const [s, alpha] of [
        [step, 0.06],
        [major, 0.13],
      ] as const) {
        ctx.beginPath();
        const sx0 = Math.floor(x0 / s) * s,
          sy0 = Math.floor(y0 / s) * s;
        for (let x = sx0; x <= x1; x += s) {
          const px = Math.round(x * zoom + pan[0]) + 0.5;
          ctx.moveTo(px, 0);
          ctx.lineTo(px, size.height);
        }
        for (let y = sy0; y <= y1; y += s) {
          const py = Math.round(y * zoom + pan[1]) + 0.5;
          ctx.moveTo(0, py);
          ctx.lineTo(size.width, py);
        }
        ctx.strokeStyle = dark ? `rgba(255,255,255,${alpha})` : `rgba(0,0,0,${alpha})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
    // Origin mark.
    ctx.strokeStyle = dark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.moveTo(pan[0] - 8, pan[1] + 0.5);
    ctx.lineTo(pan[0] + 8, pan[1] + 0.5);
    ctx.moveTo(pan[0] + 0.5, pan[1] - 8);
    ctx.lineTo(pan[0] + 0.5, pan[1] + 8);
    ctx.stroke();

    if (view.dimensions && design) {
      // Prefer stitch bounds (what gets sewn); fall back to shape bounds.
      let b = plan && plan.stats.stitches > 0 && viewMode !== 'artwork' ? plan.bounds : designBBox(design);
      if (isEmptyBBox(b)) b = designBBox(design);
      if (!isEmptyBBox(b)) {
        const x = b.minX * zoom + pan[0],
          y = b.minY * zoom + pan[1];
        const w = (b.maxX - b.minX) * zoom,
          h = (b.maxY - b.minY) * zoom;
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = 'rgba(79,70,229,0.7)';
        ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w), Math.round(h));
        ctx.setLineDash([]);
        const label = `${fmt(b.maxX - b.minX)} × ${fmt(b.maxY - b.minY)} mm`;
        ctx.font = '11px Inter, system-ui, sans-serif';
        const tw = ctx.measureText(label).width;
        const lx = x + w / 2 - tw / 2 - 6,
          ly = y - 22;
        ctx.fillStyle = 'rgba(79,70,229,0.9)';
        ctx.beginPath();
        ctx.roundRect(lx, ly, tw + 12, 17, 4);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.fillText(label, lx + 6, ly + 12.5);
      }
    }
  }, [viewport, size, view, design, plan, viewMode]);

  return <canvas ref={ref} className="pointer-events-none absolute inset-0 size-full" />;
}

/** Rulers along the top and left edges (above all other layers). */
export function RulersLayer() {
  const ref = useRef<HTMLCanvasElement>(null);
  const viewport = useUi((s) => s.viewport);
  const size = useUi((s) => s.canvasSize);
  const show = useUi((s) => s.view.rulers);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(size.width * dpr);
    c.height = Math.round(size.height * dpr);
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);
    if (show)
      drawRulers(
        ctx,
        size.width,
        size.height,
        viewport.zoom,
        viewport.pan,
        document.documentElement.classList.contains('dark'),
      );
  }, [viewport, size, show]);
  return <canvas ref={ref} className="pointer-events-none absolute inset-0 size-full" />;
}
