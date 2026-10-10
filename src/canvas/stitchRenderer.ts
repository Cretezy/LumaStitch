// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Canvas2D stitch rendering. Flat mode draws one Path2D per colour block in document units;
 * realistic mode draws each stitch as a thick, shaded thread. Also used for PNG export and thumbnails.
 */
import { F, NO_ELEMENT, type StitchPlan } from '@/engine/types';
import { parseHex, toHex } from '@/threads/color';
import type { Id } from '@/model/types';
import type { Viewport } from '@/store/uiStore';

const MOVE = F.JUMP | F.TRIM | F.COLOR_CHANGE | F.STOP | F.END;

export interface PlanPaths {
  blocks: { color: string; path: Path2D; underlay: Path2D }[];
  jumps: Path2D;
  byElement: Map<number, Path2D>;
}

const pathCache = new WeakMap<StitchPlan, PlanPaths>();

/** True if command i is a penetration that should be connected to the previous point by a thread. */
function isStitchSegment(plan: StitchPlan, i: number): boolean {
  const f = plan.flags[i];
  if (f & MOVE) return false;
  if (i === 0) return false;
  const pf = plan.flags[i - 1];
  // The penetration right after a jump starts a new thread line (no segment from before the jump... the jump itself).
  return !(pf & (F.TRIM | F.COLOR_CHANGE | F.STOP | F.END));
}

export function planPaths(plan: StitchPlan): PlanPaths {
  let p = pathCache.get(plan);
  if (p) return p;
  const blocks: PlanPaths['blocks'] = [];
  const jumps = new Path2D();
  const byElement = new Map<number, Path2D>();
  const { x, y, flags, element } = plan;
  for (const b of plan.colorBlocks) {
    const path = new Path2D();
    const underlay = new Path2D();
    let pen = false;
    for (let i = b.start; i < b.end; i++) {
      const f = flags[i];
      if (f & F.JUMP) {
        if (i > 0) {
          jumps.moveTo(x[i - 1], y[i - 1]);
          jumps.lineTo(x[i], y[i]);
        }
        pen = false;
        continue;
      }
      if (f & MOVE) {
        pen = false;
        continue;
      }
      if (!pen) {
        path.moveTo(x[i], y[i]);
        pen = true;
        continue;
      }
      path.lineTo(x[i], y[i]);
      if (f & F.UNDERLAY) {
        underlay.moveTo(x[i - 1], y[i - 1]);
        underlay.lineTo(x[i], y[i]);
      }
      const e = element[i];
      if (e !== NO_ELEMENT) {
        let ep = byElement.get(e);
        if (!ep) byElement.set(e, (ep = new Path2D()));
        ep.moveTo(x[i - 1], y[i - 1]);
        ep.lineTo(x[i], y[i]);
      }
    }
    blocks.push({ color: b.color, path, underlay });
  }
  p = { blocks, jumps, byElement };
  pathCache.set(plan, p);
  return p;
}

export interface DrawOptions {
  mode: 'flat' | 'realistic';
  jumps: boolean;
  needlePoints: boolean;
  underlayHighlight?: boolean;
  /** Element ids to emphasise (selection/hover). */
  highlight?: Set<Id>;
  hover?: Id | null;
  /** Dim everything except highlighted elements. */
  dimOthers?: boolean;
  /** Draw only commands with index ≤ upTo (simulator). */
  upTo?: number;
  dpr: number;
  /** Background fill; omitted = transparent. */
  background?: string;
}

function shade(hex: string, f: number): string {
  const [r, g, b] = parseHex(hex);
  if (f < 0) return toHex([r * (1 + f), g * (1 + f), b * (1 + f)]);
  return toHex([r + (255 - r) * f, g + (255 - g) * f, b + (255 - b) * f]);
}

/** Thread line width on screen in flat mode. */
function flatWidth(zoom: number): number {
  return Math.max(0.35 * zoom, 1) / zoom;
}

/** Draw the whole plan (or a prefix) with the given viewport. Canvas size must be css×dpr. */
export function drawPlan(
  ctx: CanvasRenderingContext2D,
  plan: StitchPlan,
  vp: Viewport,
  o: DrawOptions,
): void {
  const { dpr } = o;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (o.background) {
    ctx.fillStyle = o.background;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  } else ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.setTransform(vp.zoom * dpr, 0, 0, vp.zoom * dpr, vp.pan[0] * dpr, vp.pan[1] * dpr);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const upTo = o.upTo ?? plan.flags.length;
  const full = upTo >= plan.flags.length - 1;
  const dim = o.dimOthers && o.highlight && o.highlight.size > 0;
  if (o.mode === 'realistic') drawRealistic(ctx, plan, vp, upTo, dim ? o.highlight! : null);
  else if (full) {
    const paths = planPaths(plan);
    // Round caps/joins are expensive with ~100k segments; butt/miter look the same at thread width.
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'miter';
    ctx.lineWidth = flatWidth(vp.zoom);
    ctx.globalAlpha = dim ? 0.25 : 1;
    for (const b of paths.blocks) {
      ctx.strokeStyle = b.color;
      ctx.stroke(b.path);
    }
    if (o.underlayHighlight) {
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(255,0,180,0.8)';
      ctx.lineWidth = flatWidth(vp.zoom) * 0.8;
      for (const b of paths.blocks) ctx.stroke(b.underlay);
    }
    ctx.globalAlpha = 1;
    if (dim) {
      ctx.lineWidth = flatWidth(vp.zoom);
      plan.elementIds.forEach((id, idx) => {
        if (!o.highlight!.has(id)) return;
        const p = paths.byElement.get(idx);
        if (!p) return;
        const r = plan.elementRanges.find((er) => er.elementId === id);
        const blk = r ? plan.colorBlocks.find((b) => r.start >= b.start && r.start < b.end) : null;
        ctx.strokeStyle = blk?.color ?? '#000';
        ctx.stroke(p);
      });
    }
  } else {
    drawPrefixFlat(ctx, plan, vp, upTo);
  }
  // Highlight outline for selection/hover.
  const paths = planPaths(plan);
  const outline = (id: Id, color: string, w: number) => {
    const idx = plan.elementIds.indexOf(id);
    const p = idx >= 0 ? paths.byElement.get(idx) : undefined;
    if (!p) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = w / vp.zoom;
    ctx.globalAlpha = 0.22;
    ctx.stroke(p);
    ctx.globalAlpha = 1;
  };
  if (o.hover && !(o.highlight?.has(o.hover) ?? false)) outline(o.hover, '#6366f1', 6);
  if (o.highlight && !dim) for (const id of o.highlight) outline(id, '#4f46e5', 5);

  if (o.jumps) {
    ctx.setLineDash([4 / vp.zoom, 3 / vp.zoom]);
    ctx.strokeStyle = 'rgba(80,80,80,0.6)';
    ctx.lineWidth = 1 / vp.zoom;
    if (full) ctx.stroke(paths.jumps);
    else {
      ctx.beginPath();
      for (let i = 1; i <= upTo; i++)
        if (plan.flags[i] & F.JUMP) {
          ctx.moveTo(plan.x[i - 1], plan.y[i - 1]);
          ctx.lineTo(plan.x[i], plan.y[i]);
        }
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }
  if (o.needlePoints && vp.zoom > 6) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    const r = 1.2 / vp.zoom;
    ctx.beginPath();
    for (let i = 0; i <= Math.min(upTo, plan.flags.length - 1); i++) {
      if (plan.flags[i] & MOVE) continue;
      ctx.moveTo(plan.x[i] + r, plan.y[i]);
      ctx.arc(plan.x[i], plan.y[i], r, 0, Math.PI * 2);
    }
    ctx.fill();
  }
  ctx.restore();
}

/** Flat drawing of commands 0..upTo, iterating directly (used by the simulator). */
export function drawPrefixFlat(
  ctx: CanvasRenderingContext2D,
  plan: StitchPlan,
  vp: Viewport,
  upTo: number,
  from = 0,
): void {
  ctx.lineWidth = flatWidth(vp.zoom);
  ctx.lineCap = 'round';
  for (const b of plan.colorBlocks) {
    if (b.start > upTo) break;
    if (b.end <= from) continue;
    ctx.strokeStyle = b.color;
    ctx.beginPath();
    const s = Math.max(b.start, from);
    const e = Math.min(b.end - 1, upTo);
    let pen = false;
    for (let i = s; i <= e; i++) {
      if (plan.flags[i] & MOVE) {
        pen = false;
        continue;
      }
      if (!pen) {
        if (i > 0 && isStitchSegment(plan, i)) {
          ctx.moveTo(plan.x[i - 1], plan.y[i - 1]);
          ctx.lineTo(plan.x[i], plan.y[i]);
        } else ctx.moveTo(plan.x[i], plan.y[i]);
        pen = true;
      } else ctx.lineTo(plan.x[i], plan.y[i]);
    }
    ctx.stroke();
  }
}

/** Thread-like rendering: dark core + light highlight offset toward a fixed light direction. */
export function drawRealistic(
  ctx: CanvasRenderingContext2D,
  plan: StitchPlan,
  vp: Viewport,
  upTo: number,
  only: Set<Id> | null,
  from = 0,
): void {
  const tw = 0.4; // thread width mm
  const { x, y, element } = plan;
  const lx = -0.5,
    ly = -0.7; // light direction (up-left)
  for (const b of plan.colorBlocks) {
    if (b.start > upTo) break;
    if (b.end <= from) continue;
    const dark = shade(b.color, -0.35);
    const light = shade(b.color, 0.45);
    const s0 = Math.max(b.start, from, 1),
      e = Math.min(b.end - 1, upTo);
    const draw = (s: number, e2: number, style: string, width: number, offset: number, alpha: number) => {
      ctx.strokeStyle = style;
      ctx.lineWidth = width;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      for (let i = s; i <= e2; i++) {
        if (!isStitchSegment(plan, i)) continue;
        if (only && (element[i] === NO_ELEMENT || !only.has(plan.elementIds[element[i]]))) continue;
        const dx = x[i] - x[i - 1],
          dy = y[i] - y[i - 1];
        const l = Math.hypot(dx, dy) || 1;
        // normal pointing toward the light
        let nx = -dy / l,
          ny = dx / l;
        if (nx * lx + ny * ly < 0) {
          nx = -nx;
          ny = -ny;
        }
        ctx.moveTo(x[i - 1] + nx * offset, y[i - 1] + ny * offset);
        ctx.lineTo(x[i] + nx * offset, y[i] + ny * offset);
      }
      ctx.stroke();
    };
    // Shade in small chunks in sewing order so later stitches (the top layer) cover earlier highlights.
    const CHUNK = 48;
    for (let c = s0; c <= e; c += CHUNK) {
      const ce = Math.min(e, c + CHUNK - 1);
      draw(c, ce, dark, tw, 0, 1);
      draw(c, ce, b.color, tw * 0.7, tw * 0.05, 1);
      draw(c, ce, light, tw * 0.25, tw * 0.18, 0.7);
    }
  }
  ctx.globalAlpha = 1;
  void vp;
}

/** Renders a plan to a new canvas fitted to its bounds (PNG export, thumbnails, PES icons). */
export function renderPlanImage(
  plan: StitchPlan,
  opts: { width: number; height: number; mode?: 'flat' | 'realistic'; background?: string; padding?: number },
): HTMLCanvasElement | OffscreenCanvas {
  const canvas: HTMLCanvasElement | OffscreenCanvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(opts.width, opts.height)
      : Object.assign(document.createElement('canvas'), { width: opts.width, height: opts.height });
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const b = plan.bounds;
  const pad = opts.padding ?? 8;
  const bw = Math.max(1, b.maxX - b.minX),
    bh = Math.max(1, b.maxY - b.minY);
  const zoom = Math.min((opts.width - pad * 2) / bw, (opts.height - pad * 2) / bh);
  const vp: Viewport = {
    zoom,
    pan: [opts.width / 2 - ((b.minX + b.maxX) / 2) * zoom, opts.height / 2 - ((b.minY + b.maxY) / 2) * zoom],
  };
  drawPlan(ctx, plan, vp, {
    mode: opts.mode ?? 'flat',
    jumps: false,
    needlePoints: false,
    dpr: 1,
    background: opts.background,
  });
  return canvas;
}

/**
 * Draws a previously rendered full-canvas snapshot (taken at viewport `from`) as it would appear at
 * viewport `to`. Used during pan/zoom gestures so large designs stay at 60 fps; a full re-render
 * follows shortly after the gesture ends.
 */
export function blitTransformed(
  ctx: CanvasRenderingContext2D,
  snapshot: CanvasImageSource,
  from: Viewport,
  to: Viewport,
  dpr: number,
): void {
  const s = to.zoom / from.zoom;
  const tx = (to.pan[0] - from.pan[0] * s) * dpr;
  const ty = (to.pan[1] - from.pan[1] * s) * dpr;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.setTransform(s, 0, 0, s, tx, ty);
  ctx.imageSmoothingEnabled = s < 1;
  ctx.drawImage(snapshot, 0, 0);
  ctx.restore();
}
