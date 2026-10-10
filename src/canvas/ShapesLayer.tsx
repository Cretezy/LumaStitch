// SPDX-License-Identifier: GPL-3.0-or-later
/** SVG shape layer: artwork rendering in Artwork view; transparent hit areas in stitch views. */
import { memo, useEffect, useRef } from 'react';
import type { Design, Matrix, Shape } from '@/model/types';
import { useDoc } from '@/store/documentStore';
import { useUi, type DragPreview } from '@/store/uiStore';
import { geomToD } from './pathD';

function paintOf(design: Design, s: Shape) {
  const fillThread = s.fill ? design.threads[s.fill.threadId] : null;
  const outThread = s.outline ? design.threads[s.outline.threadId] : null;
  return {
    fill: s.fill ? (fillThread?.color ?? s.art.fill ?? '#999') : 'none',
    stroke: s.outline
      ? (outThread?.color ?? s.art.stroke ?? '#333')
      : s.fill
        ? 'none'
        : (s.art.stroke ?? '#888'),
    strokeWidth: s.outline
      ? typeof s.outline.params.width === 'number'
        ? (s.outline.params.width as number)
        : (s.art.strokeWidth ?? 0.5)
      : (s.art.strokeWidth ?? 0.3),
  };
}

const ShapePath = memo(function ShapePath({
  shape,
  design,
  mode,
  transform,
}: {
  shape: Shape;
  design: Design;
  mode: 'artwork' | 'stitches' | 'realistic';
  transform?: Matrix;
}) {
  const d = geomToD(shape.geom);
  const p = paintOf(design, shape);
  const art = mode === 'artwork';
  const tf = transform ? `matrix(${transform.join(' ')})` : undefined;
  return (
    <g transform={tf}>
      <path
        d={d}
        data-hit="shape"
        data-id={shape.id}
        fillRule={shape.geom.fillRule}
        fill={art ? p.fill : p.fill === 'none' ? 'none' : p.fill}
        fillOpacity={art ? 1 : 0.12}
        stroke={p.stroke}
        strokeOpacity={art ? 1 : 0.15}
        strokeWidth={p.strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
        style={{ cursor: shape.locked ? 'not-allowed' : undefined }}
      />
      {/* Wider invisible hit area for thin/open paths. */}
      <path
        d={d}
        data-hit="shape"
        data-id={shape.id}
        fill="none"
        stroke="transparent"
        strokeWidth={8}
        vectorEffect="non-scaling-stroke"
      />
    </g>
  );
});

/** Above this many visible shapes the layer is drawn on a canvas instead of as SVG elements. */
export const CANVAS_SHAPES_THRESHOLD = 2500;

const pathCache = new WeakMap<object, Path2D>();
function path2d(geom: Shape['geom']): Path2D {
  let p = pathCache.get(geom);
  if (!p) pathCache.set(geom, (p = new Path2D(geomToD(geom))));
  return p;
}

/** Canvas2D rendering of the shapes for very large designs (hit testing is geometric; see shapeHit.ts). */
function CanvasShapes({ design, mode }: { design: Design; mode: 'artwork' | 'stitches' | 'realistic' }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const viewport = useUi((s) => s.viewport);
  const size = useUi((s) => s.canvasSize);
  const preview = useUi((s) => s.dragPreview) as DragPreview;
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(size.width * dpr);
    c.height = Math.round(size.height * dpr);
    const ctx = c.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    const art = mode === 'artwork';
    for (const id of design.zOrder) {
      const s = design.shapes[id];
      if (!s || s.hidden) continue;
      const m = preview?.kind === 'transform' && preview.shapeIds.includes(id) ? preview.matrix : null;
      const geom = preview?.kind === 'nodes' && preview.shapeId === id ? preview.geom : s.geom;
      ctx.setTransform(
        viewport.zoom * dpr,
        0,
        0,
        viewport.zoom * dpr,
        viewport.pan[0] * dpr,
        viewport.pan[1] * dpr,
      );
      if (m) ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
      const p = paintOf(design, s);
      const path = path2d(geom);
      if (p.fill !== 'none') {
        ctx.globalAlpha = art ? 1 : 0.12;
        ctx.fillStyle = p.fill;
        ctx.fill(path, s.geom.fillRule);
      }
      if (p.stroke !== 'none') {
        ctx.globalAlpha = art ? 1 : 0.15;
        ctx.strokeStyle = p.stroke;
        ctx.lineWidth = p.strokeWidth;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.stroke(path);
      }
    }
    ctx.globalAlpha = 1;
  }, [design, mode, viewport, size, preview]);
  return <canvas ref={ref} className="pointer-events-none absolute inset-0 size-full" />;
}

export function useCanvasShapes(): boolean {
  return useDoc((s) => (s.design ? s.design.zOrder.length > CANVAS_SHAPES_THRESHOLD : false));
}

export function ShapesLayer() {
  const design = useDoc((s) => s.design);
  const viewport = useUi((s) => s.viewport);
  const mode = useUi((s) => s.viewMode);
  const preview = useUi((s) => s.dragPreview) as DragPreview;
  const canvasMode = useCanvasShapes();
  if (!design) return null;
  if (canvasMode) return <CanvasShapes design={design} mode={mode} />;
  const tset = preview?.kind === 'transform' ? new Set(preview.shapeIds) : null;
  return (
    <svg className="absolute inset-0 size-full overflow-visible">
      <g transform={`matrix(${viewport.zoom} 0 0 ${viewport.zoom} ${viewport.pan[0]} ${viewport.pan[1]})`}>
        {design.zOrder.map((id) => {
          const s = design.shapes[id];
          if (!s || s.hidden) return null;
          if (preview?.kind === 'nodes' && preview.shapeId === id) {
            return <ShapePath key={id} shape={{ ...s, geom: preview.geom }} design={design} mode={mode} />;
          }
          return (
            <ShapePath
              key={id}
              shape={s}
              design={design}
              mode={mode}
              transform={
                tset?.has(id) ? (preview!.kind === 'transform' ? preview!.matrix : undefined) : undefined
              }
            />
          );
        })}
      </g>
    </svg>
  );
}
