// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Canvas2D stitch rendering. Flat mode draws one Path2D per colour block in document units;
 * realistic mode draws each stitch as a shaded thread. Also used for PNG export and thumbnails.
 */
import { F, NO_ELEMENT, type StitchPlan } from '@/engine/types';
import { parseHex, toHex } from '@/threads/color';
import type { Id } from '@/model/types';
import type { Viewport } from '@/store/uiStore';

/** A 2D context of an on-screen or offscreen canvas. */
export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const MOVE = F.JUMP | F.TRIM | F.COLOR_CHANGE | F.STOP | F.END;

/** Embroidery thread width (40 wt), mm. Both modes draw stitches at this width. */
const TW = 0.4;

export interface PlanPaths {
  /** Per colour block: top stitches, and underlay (drawn first, thinner). */
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
    // Index of the last point of each path, so consecutive segments continue one polyline.
    let pathEnd = -1,
      underEnd = -1;
    for (let i = b.start; i < b.end; i++) {
      const f = flags[i];
      if (f & F.JUMP) {
        if (i > 0) {
          jumps.moveTo(x[i - 1], y[i - 1]);
          jumps.lineTo(x[i], y[i]);
        }
        continue;
      }
      if (i === b.start || !isStitchSegment(plan, i)) continue;
      if (f & F.UNDERLAY) {
        if (underEnd !== i - 1) underlay.moveTo(x[i - 1], y[i - 1]);
        underlay.lineTo(x[i], y[i]);
        underEnd = i;
      } else {
        if (pathEnd !== i - 1) path.moveTo(x[i - 1], y[i - 1]);
        path.lineTo(x[i], y[i]);
        pathEnd = i;
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

/** Relative luminance-ish lightness of a colour, 0..1. */
function lightness(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** Device pixels per mm of the context's current transform (axis-aligned). */
function pxPerMm(ctx: Ctx2D): number {
  const m = ctx.getTransform();
  return Math.hypot(m.a, m.b) || 1;
}

/** The canvas area in document units (mm), grown by `pad`; used to skip off-screen stitches. */
function viewRect(ctx: Ctx2D, pad: number): [number, number, number, number] {
  const m = ctx.getTransform();
  if (m.b || m.c || !m.a || !m.d) return [-Infinity, -Infinity, Infinity, Infinity];
  const x0 = -m.e / m.a,
    x1 = (ctx.canvas.width - m.e) / m.a;
  const y0 = -m.f / m.d,
    y1 = (ctx.canvas.height - m.f) / m.d;
  return [Math.min(x0, x1) - pad, Math.min(y0, y1) - pad, Math.max(x0, x1) + pad, Math.max(y0, y1) + pad];
}

/** Per-element-index mask of the given element ids (null = all elements). */
function elementMask(plan: StitchPlan, ids: Set<Id> | null): Uint8Array | null {
  if (!ids) return null;
  const m = new Uint8Array(plan.elementIds.length);
  plan.elementIds.forEach((id, k) => {
    if (ids.has(id)) m[k] = 1;
  });
  return m;
}

function inMask(mask: Uint8Array | null, e: number): boolean {
  return !mask || (e !== NO_ELEMENT && mask[e] === 1);
}

// ---------------------------------------------------------------------------------------------
// Flat mode

interface FlatStyle {
  /** Stroke width, mm. */
  width: number;
  /** Underlay stroke width, mm. */
  under: number;
  /** Width of the darker separation line along each stitch, mm (0 = none at this zoom). */
  edge: number;
  /** Radius of the penetration marks, mm (0 = none at this zoom). */
  dot: number;
}

/**
 * Width of a stroke that should look `w` mm wide, in mm. Neighbouring fill rows are about a thread
 * width apart, and when their anti-aliased edges fall in the same pixels Skia's rasteriser gets
 * ~8× slower; overlapping them by under a pixel avoids that. Strokes under 2 px are slow too.
 */
function solidWidth(w: number, scale: number): number {
  return Math.max(w + 0.75 / scale, 2 / scale);
}

/**
 * Flat stitches are the real thread width (so fills read as solid areas, without moiré from
 * sub-pixel gaps). Zoomed in, each stitch gets a thin separation line and penetration marks so
 * the stitch structure stays readable.
 */
function flatStyle(scale: number): FlatStyle {
  const min = 2 / scale;
  const width = solidWidth(TW, scale);
  const wpx = width * scale;
  const edge = wpx >= 5 ? Math.min(2.5, Math.max(0.9, wpx * 0.09)) / scale : 0;
  const dot = wpx >= 9 ? Math.min(0.11, edge * 1.3) : 0;
  return { width, under: Math.max(width * 0.6, min), edge, dot };
}

const sepCache = new Map<string, string>();
/** Separation line colour: a darker shade, or a lighter one for very dark threads. */
function separator(color: string): string {
  let s = sepCache.get(color);
  if (!s) sepCache.set(color, (s = lightness(color) < 0.3 ? shade(color, 0.22) : shade(color, -0.24)));
  return s;
}

/** Strokes the top stitches of one block: optional separation pass, then the thread colour. */
function strokeFlat(ctx: Ctx2D, color: string, st: FlatStyle, path?: Path2D): void {
  const stroke = () => (path ? ctx.stroke(path) : ctx.stroke());
  if (st.edge) {
    ctx.strokeStyle = separator(color);
    ctx.lineWidth = st.width;
    stroke();
    ctx.lineWidth = st.width - st.edge * 2;
  } else ctx.lineWidth = st.width;
  ctx.strokeStyle = color;
  stroke();
}

/** Immediate-mode flat drawing of commands from..upTo (optionally only some elements). */
function drawFlat(ctx: Ctx2D, plan: StitchPlan, upTo: number, from: number, mask: Uint8Array | null): void {
  const st = flatStyle(pxPerMm(ctx));
  const [vx0, vy0, vx1, vy1] = viewRect(ctx, st.width);
  const { x, y, flags, element } = plan;
  // Incremental steps are short separate strokes: round ends so they join without notches.
  ctx.lineCap = from > 0 ? 'round' : 'butt';
  ctx.lineJoin = 'round';
  for (const b of plan.colorBlocks) {
    if (b.start > upTo) break;
    if (b.end <= from) continue;
    const s = Math.max(b.start, from, 1);
    const e = Math.min(b.end - 1, upTo);
    // Underlay first (thinner, it sits below the top stitches), then the top stitches.
    for (const under of [true, false]) {
      ctx.beginPath();
      let n = 0,
        end = -1;
      for (let i = s; i <= e; i++) {
        if (!(flags[i] & F.UNDERLAY) !== !under || !isStitchSegment(plan, i)) continue;
        if (!inMask(mask, element[i])) continue;
        const ax = x[i - 1],
          ay = y[i - 1],
          bx = x[i],
          by = y[i];
        if (
          (ax < vx0 && bx < vx0) ||
          (ax > vx1 && bx > vx1) ||
          (ay < vy0 && by < vy0) ||
          (ay > vy1 && by > vy1)
        )
          continue;
        if (end !== i - 1) ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        end = i;
        n++;
      }
      if (!n) continue;
      if (under) {
        ctx.lineWidth = st.under;
        ctx.strokeStyle = b.color;
        ctx.stroke();
      } else strokeFlat(ctx, b.color, st);
    }
    if (st.dot) penetrationDots(ctx, plan, s, e, b.color, st.dot, mask);
  }
}

/** Penetration marks of a block's top stitches (zoomed-in flat view), on-screen ones only. */
function penetrationDots(
  ctx: Ctx2D,
  plan: StitchPlan,
  s: number,
  e: number,
  color: string,
  r: number,
  mask: Uint8Array | null,
): void {
  const [x0, y0, x1, y1] = viewRect(ctx, r);
  const { x, y, flags, element } = plan;
  ctx.beginPath();
  for (let i = s; i <= e; i++) {
    if (flags[i] & (MOVE | F.UNDERLAY) || !inMask(mask, element[i])) continue;
    const px = x[i],
      py = y[i];
    if (px < x0 || px > x1 || py < y0 || py > y1) continue;
    ctx.moveTo(px + r, py);
    ctx.arc(px, py, r, 0, Math.PI * 2);
  }
  ctx.fillStyle = separator(color);
  ctx.fill();
}

/** Flat drawing of commands 0..upTo, iterating directly (simulator, video). */
export function drawPrefixFlat(ctx: Ctx2D, plan: StitchPlan, vp: Viewport, upTo: number, from = 0): void {
  drawFlat(ctx, plan, upTo, from, null);
  void vp;
}

/**
 * Flat drawing of commands from..upTo: colour blocks that lie wholly inside the range from the
 * cached Path2Ds (fastest), partial blocks directly.
 */
function drawFlatRange(ctx: Ctx2D, plan: StitchPlan, from: number, upTo: number): void {
  const st = flatStyle(pxPerMm(ctx));
  const paths = planPaths(plan);
  for (let k = 0; k < paths.blocks.length; k++) {
    const b = paths.blocks[k],
      cb = plan.colorBlocks[k];
    if (cb.end <= from) continue;
    if (cb.start > upTo) break;
    if (cb.start < from || cb.end - 1 > upTo) {
      drawFlat(ctx, plan, Math.min(upTo, cb.end - 1), Math.max(from, cb.start), null);
      continue;
    }
    // Round caps are expensive with ~100k segments; round joins cost about the same as miter
    // ones (and avoid miter spikes at satin turns).
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'round';
    ctx.lineWidth = st.under;
    ctx.strokeStyle = b.color;
    ctx.stroke(b.underlay);
    strokeFlat(ctx, b.color, st, b.path);
    if (st.dot) penetrationDots(ctx, plan, cb.start, cb.end - 1, b.color, st.dot, null);
  }
}

// ---------------------------------------------------------------------------------------------
// Realistic mode

/** Unit light direction in the plane: from the upper left. */
const LX = -0.57,
  LY = -0.82;
/** Shade levels a stitch can take (from its angle to the light plus a little per-stitch noise). */
const LEVELS = 6;
/** Shade index of underlay stitches. */
const UNDER = LEVELS;
const NONE = 255;
/**
 * Stitches shaded per batch; batches are drawn in sewing order so later stitches lie on top.
 * Zoomed out the layering detail is invisible, so larger batches save stroke calls.
 */
const CHUNK = [512, 96, 48];

interface ThreadGeom {
  /** Per command: shade level of the stitch ending there, UNDER, or NONE (no thread). */
  tone: Uint8Array;
  /** The same without the per-stitch variation (zoomed out, where it is invisible). */
  base: Uint8Array;
  /** Unit normal toward the light, scaled by how much the stitch faces the light (0..1). */
  nx: Float32Array;
  ny: Float32Array;
  len: Float32Array;
}

const geomCache = new WeakMap<StitchPlan, ThreadGeom>();

/** Per-stitch shading data, computed once per plan (the light is fixed, independent of zoom). */
function threadGeom(plan: StitchPlan): ThreadGeom {
  let g = geomCache.get(plan);
  if (g) return g;
  const n = plan.flags.length;
  const { x, y, flags } = plan;
  g = {
    tone: new Uint8Array(n).fill(NONE),
    base: new Uint8Array(n).fill(NONE),
    nx: new Float32Array(n),
    ny: new Float32Array(n),
    len: new Float32Array(n),
  };
  for (let i = 1; i < n; i++) {
    if (!isStitchSegment(plan, i)) continue;
    const dx = x[i] - x[i - 1],
      dy = y[i] - y[i - 1];
    const l = Math.hypot(dx, dy);
    g.len[i] = l;
    let nx = 0,
      ny = 0,
      facing = 0.5;
    if (l > 1e-6) {
      nx = -dy / l;
      ny = dx / l;
      // |n·L| = sin(stitch, light): a thread across the light catches a bright, off-centre sheen;
      // one along the light looks flatter and darker (anisotropic shine of twisted thread).
      facing = nx * LX + ny * LY;
      if (facing < 0) {
        nx = -nx;
        ny = -ny;
        facing = -facing;
      }
    }
    g.nx[i] = nx * facing;
    g.ny[i] = ny * facing;
    // Small, stable per-stitch variation (thread twist, tension).
    const noise = (((Math.imul(i, 2654435761) >>> 0) % 1000) / 1000 - 0.5) * 1.3;
    const level = (v: number) =>
      flags[i] & F.UNDERLAY ? UNDER : Math.max(0, Math.min(LEVELS - 1, Math.round(v)));
    g.tone[i] = level(facing * (LEVELS - 1) + noise);
    g.base[i] = level(facing * (LEVELS - 1));
  }
  geomCache.set(plan, g);
  return g;
}

interface Palette {
  edge: string;
  rim: string;
  body: string[];
  sheen: string;
  spec: string;
  under: string;
}

const paletteCache = new Map<string, Palette>();
function palette(color: string): Palette {
  let p = paletteCache.get(color);
  if (p) return p;
  const body: string[] = [];
  for (let k = 0; k < LEVELS; k++) body.push(shade(color, -0.16 + (0.2 * k) / (LEVELS - 1)));
  // Very light threads need a stronger edge to read against each other.
  const light = lightness(color);
  p = {
    edge: shade(color, light > 0.8 ? -0.36 : -0.42),
    rim: shade(color, -0.26),
    body,
    sheen: shade(color, 0.32),
    spec: shade(color, 0.8),
    under: shade(color, -0.3),
  };
  paletteCache.set(color, p);
  return p;
}

/**
 * Thread-like rendering: each stitch is a rounded tube (dark edge and rim, body shaded by its angle
 * to the light, a sheen and a specular line offset toward the light), tapering into the needle
 * holes at both ends, with a soft shadow on what lies below. Zoomed out, the detail passes are
 * skipped.
 * `from` allows incremental drawing (simulator, video).
 */
export function drawRealistic(
  ctx: Ctx2D,
  plan: StitchPlan,
  vp: Viewport,
  upTo: number,
  only: Set<Id> | null,
  from = 0,
): void {
  drawRealisticMasked(ctx, plan, upTo, elementMask(plan, only), from);
  void vp;
}

function drawRealisticMasked(
  ctx: Ctx2D,
  plan: StitchPlan,
  upTo: number,
  mask: Uint8Array | null,
  from: number,
): void {
  const g = threadGeom(plan);
  const scale = pxPerMm(ctx);
  const px = TW * scale; // thread width in device pixels
  const solid = solidWidth(TW, scale);
  // Level of detail: shaded body only (tiny threads); + a sheen line; full tube with shadow.
  const tier = px < 2.2 ? 0 : px < 5 ? 1 : 2;
  const [vx0, vy0, vx1, vy1] = viewRect(ctx, TW * 2);
  const { x, y, flags, element } = plan;
  const { nx, ny, len } = g;
  const tone = tier === 0 ? g.base : g.tone;
  const counts = new Int32Array(LEVELS + 2);
  const chunk = CHUNK[tier];
  const order = new Int32Array(chunk);
  const at = new Int32Array(LEVELS + 2);
  const next = new Int32Array(LEVELS + 2);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  /** Adds segments order[k0..k1) to the current path: offset toward the light, ends pulled in. */
  const add = (k0: number, k1: number, off: number, inset: number, dx = 0, dy = 0) => {
    const polyline = !off && !inset;
    for (let k = k0; k < k1; k++) {
      const i = order[k];
      // Untouched consecutive stitches continue one polyline (far fewer caps to rasterise).
      if (polyline && k > k0 && order[k - 1] === i - 1) {
        ctx.lineTo(x[i] + dx, y[i] + dy);
        continue;
      }
      let ax = x[i - 1] + dx,
        ay = y[i - 1] + dy,
        bx = x[i] + dx,
        by = y[i] + dy;
      if (off) {
        const ox = nx[i] * off,
          oy = ny[i] * off;
        ax += ox;
        ay += oy;
        bx += ox;
        by += oy;
      }
      const l = len[i];
      // Tie stitches go back and forth over each other: keep them whole so they read as one knot.
      if (inset && l > 1e-6 && !(flags[i] & F.TIE)) {
        const d = Math.min(inset, l * 0.3) / l;
        const ux = (bx - ax) * d,
          uy = (by - ay) * d;
        ax += ux;
        ay += uy;
        bx -= ux;
        by -= uy;
      }
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
    }
  };
  /** True if stitch i is drawn: in the mask and (roughly) on the canvas. */
  const shown = (i: number) => {
    if (!inMask(mask, element[i])) return false;
    const ax = x[i - 1],
      bx = x[i],
      ay = y[i - 1],
      by = y[i];
    return !(
      (ax < vx0 && bx < vx0) ||
      (ax > vx1 && bx > vx1) ||
      (ay < vy0 && by < vy0) ||
      (ay > vy1 && by > vy1)
    );
  };
  const pass = (style: string, width: number, alpha: number, k0: number, k1: number, off = 0, inset = 0) => {
    if (k1 <= k0) return;
    ctx.strokeStyle = style;
    ctx.lineWidth = width;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    add(k0, k1, off, inset);
    ctx.stroke();
  };

  for (const b of plan.colorBlocks) {
    if (b.start > upTo) break;
    if (b.end <= from) continue;
    const pal = palette(b.color);
    const s0 = Math.max(b.start, from, 1),
      e = Math.min(b.end - 1, upTo);
    for (let c = s0; c <= e; c += chunk) {
      const ce = Math.min(e, c + chunk - 1);
      // Bucket the batch's visible stitches by shade level (one stroke per level and pass).
      counts.fill(0);
      let n = 0;
      for (let i = c; i <= ce; i++) {
        const t = tone[i];
        if (t === NONE || !shown(i)) continue;
        counts[t + 1]++;
        n++;
      }
      if (!n) continue;
      for (let t = 0; t <= LEVELS; t++) at[t + 1] = at[t] + counts[t + 1];
      next.set(at);
      for (let i = c; i <= ce; i++) {
        const t = tone[i];
        if (t === NONE || !shown(i)) continue;
        order[next[t]++] = i;
      }
      const top = at[UNDER]; // order[0..top) are top stitches, order[top..n) underlay

      // Underlay first (it lies below the top stitches), dark and flat.
      if (tier === 0) {
        pass(pal.under, solid, 1, top, n);
        for (let t = 0; t < LEVELS; t++) pass(pal.body[t], solid, 1, at[t], at[t + 1]);
        continue;
      }
      if (tier === 1) {
        // Small threads: shaded body plus a sheen line.
        pass(pal.under, solid, 1, top, n);
        for (let t = 0; t < LEVELS; t++) pass(pal.body[t], solid, 1, at[t], at[t + 1]);
        for (let t = 0; t < LEVELS; t++)
          pass(pal.sheen, TW * 0.35, 0.25 + 0.5 * (t / (LEVELS - 1)), at[t], at[t + 1], TW * 0.15);
        continue;
      }
      // Soft shadow cast away from the light onto the fabric and the stitches below.
      ctx.strokeStyle = 'rgba(0,0,0,0.16)';
      ctx.lineWidth = TW * 1.2;
      ctx.globalAlpha = 1;
      ctx.beginPath();
      add(0, n, 0, 0, -LX * TW * 0.3, -LY * TW * 0.3);
      ctx.stroke();
      const inset = TW * 0.22;
      pass(pal.edge, solid, 1, top, n);
      pass(pal.under, TW * 0.6, 1, top, n, 0, inset);
      // Top stitches: dark edge, rim, body shaded by angle, sheen and specular line.
      pass(pal.edge, solid, 1, 0, top);
      pass(pal.rim, TW * 0.86, 1, 0, top);
      for (let t = 0; t < LEVELS; t++) pass(pal.body[t], TW * 0.7, 1, at[t], at[t + 1], 0, inset);
      for (let t = 0; t < LEVELS; t++) {
        const f = t / (LEVELS - 1);
        pass(pal.sheen, TW * 0.4, 0.2 + 0.45 * f, at[t], at[t + 1], TW * 0.13, TW * 0.4);
        pass(pal.spec, TW * 0.12, 0.06 + 0.5 * f * f, at[t], at[t + 1], TW * 0.2, TW * 0.7);
      }
    }
  }
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------------------------------------

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
  const upTo = Math.min(o.upTo ?? plan.flags.length, plan.flags.length - 1);
  const full = upTo >= plan.flags.length - 1;
  const realistic = o.mode === 'realistic';
  const dim = !!(o.dimOthers && o.highlight && o.highlight.size > 0);
  const paths = planPaths(plan);
  const scale = vp.zoom * dpr;

  /** Draws commands a..b (in sewing order, on top of what is there). */
  const drawRange = (a: number, b: number) => {
    if (b < a) return;
    if (realistic) drawRealisticMasked(ctx, plan, b, null, a);
    else drawFlatRange(ctx, plan, a, b);
  };

  // Selection/hover: a halo around the element's stitches, drawn into the sewing sequence just
  // before the element's first stitch. The element covers its own halo (so it shows as an outline)
  // and stitches sewn later still lie on top: the layering stays what gets sewn.
  interface Halo {
    at: number;
    ids: Set<Id>;
    color: string;
    px: number;
    alpha: number;
  }
  const halos: Halo[] = [];
  const addHalo = (ids: Set<Id>, color: string, px: number, alpha: number) => {
    let at = Infinity;
    for (const r of plan.elementRanges) if (ids.has(r.elementId)) at = Math.min(at, r.start);
    if (at <= upTo) halos.push({ at, ids, color, px, alpha });
  };
  if (o.hover && !(o.highlight?.has(o.hover) ?? false)) addHalo(new Set([o.hover]), '#818cf8', 1.5, 0.8);
  if (o.highlight?.size && !dim) addHalo(o.highlight, '#4f46e5', 2, 0.9);
  halos.sort((a, b) => a.at - b.at);
  const drawHalo = (h: Halo) => {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = h.color;
    ctx.globalAlpha = h.alpha;
    ctx.lineWidth = solidWidth(TW, scale) + (h.px * 2) / vp.zoom;
    for (const id of h.ids) {
      const idx = plan.elementIds.indexOf(id);
      const p = idx >= 0 ? paths.byElement.get(idx) : undefined;
      if (p) ctx.stroke(p);
    }
    ctx.globalAlpha = 1;
  };

  let from = 0;
  for (const h of halos) {
    drawRange(from, h.at - 1);
    drawHalo(h);
    from = h.at;
  }
  drawRange(from, upTo);

  if (o.underlayHighlight && full) {
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(255,0,180,0.8)';
    ctx.lineWidth = Math.max(TW * 0.5, 1 / vp.zoom);
    for (const b of paths.blocks) ctx.stroke(b.underlay);
  }

  if (dim) {
    // Wash out everything, then draw the highlighted elements again on top.
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = o.background ?? '#ffffff';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.restore();
    const mask = elementMask(plan, o.highlight!);
    if (realistic) drawRealisticMasked(ctx, plan, upTo, mask, 0);
    else drawFlat(ctx, plan, upTo, 0, mask);
  }

  if (o.jumps) {
    // Thin two-tone dashes: visible on light and dark threads alike without covering them.
    ctx.lineCap = 'butt';
    ctx.lineWidth = 1 / vp.zoom;
    let jp: Path2D;
    if (full) jp = paths.jumps;
    else {
      jp = new Path2D();
      for (let i = 1; i <= upTo; i++)
        if (plan.flags[i] & F.JUMP) {
          jp.moveTo(plan.x[i - 1], plan.y[i - 1]);
          jp.lineTo(plan.x[i], plan.y[i]);
        }
    }
    ctx.setLineDash([3 / vp.zoom, 3 / vp.zoom]);
    ctx.strokeStyle = 'rgba(40,40,40,0.6)';
    ctx.stroke(jp);
    ctx.lineDashOffset = 3 / vp.zoom;
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.stroke(jp);
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
  }
  if (o.needlePoints && vp.zoom > 6) {
    const r = 1.2 / vp.zoom;
    const [x0, y0, x1, y1] = viewRect(ctx, r);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    for (let i = 0; i <= upTo; i++) {
      if (plan.flags[i] & MOVE) continue;
      const px = plan.x[i],
        py = plan.y[i];
      if (px < x0 || px > x1 || py < y0 || py > y1) continue;
      ctx.moveTo(px + r, py);
      ctx.arc(px, py, r, 0, Math.PI * 2);
    }
    ctx.fill();
  }
  ctx.restore();
}

/** Width of one weave repeat (two threads) of the fabric texture, mm. */
const WEAVE_MM = 0.6;
const WEAVE_PX = 16;
let weaveTile: HTMLCanvasElement | OffscreenCanvas | null = null;

/** A plain-weave tile (two warp and two weft threads), as light/dark overlays for any colour. */
function weave(): HTMLCanvasElement | OffscreenCanvas {
  if (weaveTile) return weaveTile;
  const n = WEAVE_PX,
    h = n / 2;
  const c: HTMLCanvasElement | OffscreenCanvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(n, n)
      : Object.assign(document.createElement('canvas'), { width: n, height: n });
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  // Each quarter is one thread crossing over: shaded across its width, darker where it dives.
  for (const [x, y, vertical] of [
    [0, 0, true],
    [h, h, true],
    [h, 0, false],
    [0, h, false],
  ] as const) {
    const grad = vertical ? g.createLinearGradient(x, 0, x + h, 0) : g.createLinearGradient(0, y, 0, y + h);
    grad.addColorStop(0, 'rgba(0,0,0,0.16)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.10)');
    grad.addColorStop(0.65, 'rgba(255,255,255,0.04)');
    grad.addColorStop(1, 'rgba(0,0,0,0.16)');
    g.fillStyle = grad;
    g.fillRect(x, y, h, h);
  }
  return (weaveTile = c);
}

/**
 * Subtle woven-fabric texture over a fabric-coloured background (realistic view), aligned with
 * the document so it pans and zooms with the stitches. Fades out where the weave gets too fine.
 * `ctx` is in CSS pixels.
 */
export function drawFabricTexture(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  width: number,
  height: number,
): void {
  const repeat = WEAVE_MM * vp.zoom; // CSS px per weave repeat
  const alpha = Math.min(0.85, Math.max(0, (repeat - 3) / 6));
  if (alpha <= 0) return;
  const pattern = ctx.createPattern(weave(), 'repeat');
  if (!pattern) return;
  const s = repeat / WEAVE_PX;
  pattern.setTransform(new DOMMatrix([s, 0, 0, s, vp.pan[0], vp.pan[1]]));
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
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
