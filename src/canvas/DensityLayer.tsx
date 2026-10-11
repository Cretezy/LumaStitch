// SPDX-License-Identifier: GPL-3.0-or-later
import { useEffect, useRef, useState } from 'react';
import * as Comlink from 'comlink';
import type { DensityMap, penetrationDensity } from '@/engine/density';
import { useUi } from '@/store/uiStore';
import { usePlan } from '@/store/planStore';

export function DensityLayer() {
  const enabled = useUi((s) => s.view.density);
  const sim = useUi((s) => s.sim.active);
  return enabled && !sim ? <DensityInspection /> : null;
}
function DensityInspection() {
  const plan = usePlan((s) => s.plan);
  const size = useUi((s) => s.canvasSize);
  const viewport = useUi((s) => s.viewport);
  const [radius, setRadius] = useState(1);
  const [result, setResult] = useState<{ plan: typeof plan; data: DensityMap } | null>(null);
  const [error, setError] = useState('');
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!plan) return;
    let alive = true;
    const worker = new Worker(new URL('../worker/density.worker.ts', import.meta.url), { type: 'module' });
    const api = Comlink.wrap<{ penetrationDensity: typeof penetrationDensity }>(worker);
    void api
      .penetrationDensity({ x: plan.x, y: plan.y, flags: plan.flags }, radius)
      .then((data) => {
        if (alive) {
          setResult({ plan, data });
          setError('');
        }
      })
      .catch((e) => {
        if (alive) setError(String(e));
      });
    return () => {
      alive = false;
      worker.terminate();
    };
  }, [plan, radius]);
  const map = result?.plan === plan && result?.data.radius === radius ? result.data : null;
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = size.width * dpr;
    c.height = size.height * dpr;
    const ctx = c.getContext('2d')!;
    ctx.scale(dpr, dpr);
    if (!map || !plan) return;
    // Fixed quantitative bins, expressed as penetrations/mm²; never auto-normalize a hotspot away.
    for (let band = 0; band < 3; band++) {
      ctx.fillStyle = ['#15803d', '#d97706', '#dc2626'][band];
      ctx.beginPath();
      for (let i = 0; i < map.counts.length; i++) {
        if (!map.counts[i]) continue;
        const density = map.counts[i] / (Math.PI * radius * radius);
        if ((density < 5 ? 0 : density < 10 ? 1 : 2) !== band) continue;
        const x = plan.x[i] * viewport.zoom + viewport.pan[0],
          y = plan.y[i] * viewport.zoom + viewport.pan[1];
        if (x < -3 || y < -3 || x > size.width + 3 || y > size.height + 3) continue;
        ctx.rect(x - 1.5, y - 1.5, 3, 3);
      }
      ctx.fill();
    }
  }, [map, plan, radius, viewport, size]);
  return (
    <>
      <canvas
        ref={canvas}
        className="pointer-events-none absolute inset-0 h-full w-full"
        aria-label="Stitch penetration density map"
      />
      <div
        className="absolute right-3 bottom-3 z-20 max-w-72 rounded-md border bg-background/95 p-3 text-xs shadow"
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <strong>Needle density</strong>
        <label className="mt-2 flex items-center gap-2">
          Radius{' '}
          <select
            aria-label="Density radius"
            className="rounded border bg-background p-1"
            value={radius}
            onChange={(e) => setRadius(Number(e.target.value))}
          >
            {[0.5, 1, 2, 3].map((r) => (
              <option key={r} value={r}>
                {r} mm
              </option>
            ))}
          </select>
        </label>
        <p className="mt-2">
          {error ||
            (map
              ? `Peak ${(map.maximum / (Math.PI * radius * radius)).toFixed(1)} penetrations/mm² (${map.maximum} in radius)`
              : 'Calculating…')}
        </p>
        <p className="mt-1">
          <span className="text-green-700">■ &lt;5</span> · <span className="text-amber-700">■ 5–10</span> ·{' '}
          <span className="text-red-600">■ ≥10 /mm²</span>
        </p>
        <p className="mt-1 text-muted-foreground">
          Includes ties and underlay, including the center point. Colors indicate concentration; fabric and
          thread determine acceptable density.
        </p>
      </div>
    </>
  );
}
