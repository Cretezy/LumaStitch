// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Stitch-out video export: the simulator's playback rendered frame by frame and encoded with
 * WebCodecs (via mediabunny) to MP4 (H.264) or, where H.264 can't be encoded, WebM (VP9/VP8/AV1).
 * Rendering is incremental (each frame draws only the new stitches), so encoding runs faster
 * than real time and doesn't depend on the display.
 */
import {
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  WebMOutputFormat,
  getFirstEncodableVideoCodec,
  type VideoCodec,
} from 'mediabunny';
import { drawPrefixFlat, drawRealistic } from '@/canvas/stitchRenderer';
import { F, type StitchPlan } from '@/engine/types';
import type { Viewport } from '@/store/uiStore';

/** Longest side of the video, px. */
export const VIDEO_SIZES = [1280, 1920, 3840] as const;
export type VideoSize = (typeof VIDEO_SIZES)[number];
export const VIDEO_FPS = 30;
/** Length limits of the stitching part, seconds. */
export const VIDEO_MIN_SECONDS = 1;
export const VIDEO_MAX_SECONDS = 600;
/** Seconds the finished design stays on screen at the end. */
export const VIDEO_HOLD_END = 2;

/** Either a fixed length, or a speed relative to the machine's stitch rate. */
export type VideoTiming = { kind: 'length'; seconds: number } | { kind: 'speed'; factor: number };

export interface VideoExportOptions {
  mode: 'flat' | 'realistic';
  /** Background colour (videos have no transparency). */
  background: string;
  /** Longest side, px. */
  maxSide: VideoSize;
  timing: VideoTiming;
  /** Machine stitches per minute (for speed timing). */
  machineSpm: number;
  /** Seconds to hold the finished design at the end (default VIDEO_HOLD_END). */
  holdEnd?: number;
  /** Draw a needle marker at the current stitch. */
  needle?: boolean;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

export interface VideoResult {
  blob: Blob;
  ext: 'mp4' | 'webm';
  mime: string;
}

const MOVE = F.JUMP | F.TRIM | F.COLOR_CHANGE | F.STOP | F.END;

/** Number of needle penetrations in a plan. */
function penetrations(plan: StitchPlan): number {
  let n = 0;
  for (let i = 0; i < plan.flags.length; i++) if (!(plan.flags[i] & MOVE)) n++;
  return n;
}

/** Real stitching time of the plan at the machine speed, seconds (no trims or colour changes). */
export function machineStitchSeconds(plan: StitchPlan, machineSpm: number): number {
  return (penetrations(plan) * 60) / Math.max(1, machineSpm);
}

/** Length of the stitching part of the video, seconds (clamped to the allowed range). */
export function videoSeconds(plan: StitchPlan, timing: VideoTiming, machineSpm: number): number {
  const s =
    timing.kind === 'length'
      ? timing.seconds
      : machineStitchSeconds(plan, machineSpm) / Math.max(1e-6, timing.factor);
  return Math.min(VIDEO_MAX_SECONDS, Math.max(VIDEO_MIN_SECONDS, s));
}

/** Pixel size of the video: the design's aspect ratio, longest side = maxSide, even dimensions. */
export function videoSize(
  plan: StitchPlan,
  maxSide: number,
): { width: number; height: number; padding: number } {
  const pad = Math.round(maxSide * 0.04);
  const b = plan.bounds;
  const bw = Math.max(1, b.maxX - b.minX);
  const bh = Math.max(1, b.maxY - b.minY);
  const inner = maxSide - pad * 2;
  const even = (v: number) => Math.max(16, Math.round(v / 2) * 2);
  // Very long, thin designs get a minimum short side so the video stays watchable.
  const minShort = Math.round(maxSide * 0.4);
  if (bw >= bh)
    return {
      width: even(maxSide),
      height: even(Math.max(minShort, (inner * bh) / bw + pad * 2)),
      padding: pad,
    };
  return {
    width: even(Math.max(minShort, (inner * bw) / bh + pad * 2)),
    height: even(maxSide),
    padding: pad,
  };
}

/** Picks a container and codec the browser can encode at this size. */
async function pickCodec(
  width: number,
  height: number,
): Promise<{ codec: VideoCodec; ext: 'mp4' | 'webm' } | null> {
  if (typeof VideoEncoder === 'undefined') return null;
  const opts = { width, height, quality: QUALITY_HIGH };
  const mp4 = await getFirstEncodableVideoCodec(['avc'], opts);
  if (mp4) return { codec: mp4, ext: 'mp4' };
  const webm = await getFirstEncodableVideoCodec(['vp9', 'vp8', 'av1'], opts);
  return webm ? { codec: webm, ext: 'webm' } : null;
}

/** The file type this browser will produce at this size, or null if it can't encode video. */
export async function videoContainer(plan: StitchPlan, maxSide: VideoSize): Promise<'mp4' | 'webm' | null> {
  const { width, height } = videoSize(plan, maxSide);
  return (await pickCodec(width, height))?.ext ?? null;
}

/**
 * Command index reached when `k` penetrations have been sewn: the stitching progresses at a
 * constant rate, and jumps/trims/colour changes happen instantly between stitches.
 */
function indexTable(plan: StitchPlan): Uint32Array {
  const n = penetrations(plan);
  const at = new Uint32Array(n + 1);
  let k = 0;
  for (let i = 0; i < plan.flags.length; i++) if (!(plan.flags[i] & MOVE)) at[++k] = i;
  return at;
}

function drawNeedle(ctx: OffscreenCanvasRenderingContext2D, x: number, y: number, size: number): void {
  const r = Math.max(4, size * 0.006);
  ctx.save();
  ctx.lineWidth = Math.max(1.5, r * 0.35);
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.beginPath();
  ctx.arc(x, y, r + ctx.lineWidth, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(20,20,20,0.85)';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.moveTo(x - r * 1.8, y);
  ctx.lineTo(x + r * 1.8, y);
  ctx.moveTo(x, y - r * 1.8);
  ctx.lineTo(x, y + r * 1.8);
  ctx.stroke();
  ctx.restore();
}

export interface StitchOutRenderer {
  readonly canvas: OffscreenCanvas;
  /**
   * Draws the stitch-out at `progress` (0..1 of the penetrations). Forward steps draw only the
   * new stitches; going backwards starts again from the empty background.
   */
  render(progress: number): void;
}

/** Incremental stitch-out frames for the video and its preview. */
export function createStitchOutRenderer(
  plan: StitchPlan,
  o: {
    width: number;
    height: number;
    padding: number;
    mode: 'flat' | 'realistic';
    background: string;
    needle: boolean;
  },
): StitchOutRenderer {
  const { width, height, padding } = o;
  // Accumulates the sewn stitches; the frame canvas adds the needle marker on top.
  const sewn = new OffscreenCanvas(width, height);
  const sctx = sewn.getContext('2d')!;
  const b = plan.bounds;
  const bw = Math.max(1, b.maxX - b.minX),
    bh = Math.max(1, b.maxY - b.minY);
  const zoom = Math.min((width - padding * 2) / bw, (height - padding * 2) / bh);
  const vp: Viewport = {
    zoom,
    pan: [width / 2 - ((b.minX + b.maxX) / 2) * zoom, height / 2 - ((b.minY + b.maxY) / 2) * zoom],
  };
  const frame = o.needle ? new OffscreenCanvas(width, height) : sewn;
  const fctx = o.needle ? frame.getContext('2d')! : null;
  const at = indexTable(plan);
  const total = at.length - 1;
  let drawn = Infinity;

  const reset = () => {
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.fillStyle = o.background;
    sctx.fillRect(0, 0, width, height);
    sctx.setTransform(zoom, 0, 0, zoom, vp.pan[0], vp.pan[1]);
    sctx.lineCap = 'round';
    sctx.lineJoin = 'round';
    drawn = -1;
  };

  return {
    canvas: frame,
    render(progress) {
      const p = Math.min(1, Math.max(0, progress));
      const k = Math.round(total * p);
      // The end includes everything up to the last command of the plan.
      const upTo = p >= 1 ? plan.flags.length - 1 : k > 0 ? at[k] : -1;
      if (upTo < drawn) reset();
      if (upTo > drawn) {
        if (o.mode === 'realistic') drawRealistic(sctx, plan, vp, upTo, null, drawn + 1);
        else drawPrefixFlat(sctx, plan, vp, upTo, drawn + 1);
        drawn = upTo;
      }
      if (fctx) {
        fctx.drawImage(sewn, 0, 0);
        if (p < 1 && k > 0) {
          const i = at[k];
          drawNeedle(
            fctx,
            plan.x[i] * zoom + vp.pan[0],
            plan.y[i] * zoom + vp.pan[1],
            Math.max(width, height),
          );
        }
      }
    },
  };
}

/** Renders the stitch-out of a plan to a video file. Rejects with an AbortError when cancelled. */
export async function exportVideo(plan: StitchPlan, opts: VideoExportOptions): Promise<VideoResult> {
  const { width, height, padding } = videoSize(plan, opts.maxSide);
  const picked = await pickCodec(width, height);
  if (!picked)
    throw new Error("This browser can't encode video. Try a recent Chrome, Edge, Safari or Firefox.");
  const renderer = createStitchOutRenderer(plan, {
    width,
    height,
    padding,
    mode: opts.mode,
    background: opts.background,
    needle: opts.needle ?? true,
  });

  const output = new Output({
    format: picked.ext === 'mp4' ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(),
    target: new BufferTarget(),
  });
  const source = new CanvasSource(renderer.canvas, { codec: picked.codec, quality: QUALITY_HIGH });
  output.addVideoTrack(source, { frameRate: VIDEO_FPS });
  await output.start();

  const seconds = videoSeconds(plan, opts.timing, opts.machineSpm);
  const frames = Math.max(1, Math.round(seconds * VIDEO_FPS));
  const hold = Math.max(0, opts.holdEnd ?? VIDEO_HOLD_END);
  const dt = 1 / VIDEO_FPS;
  try {
    for (let f = 0; f <= frames; f++) {
      if (opts.signal?.aborted) throw new DOMException('Video export cancelled', 'AbortError');
      renderer.render(f / frames);
      // The finished design is one long frame.
      await source.add(f * dt, f === frames ? Math.max(dt, hold) : dt);
      opts.onProgress?.((f + 1) / (frames + 1));
    }
    source.close();
    await output.finalize();
  } catch (err) {
    await output.cancel().catch(() => {});
    throw err;
  }
  const buf = (output.target as BufferTarget).buffer!;
  const mime = picked.ext === 'mp4' ? 'video/mp4' : 'video/webm';
  return { blob: new Blob([buf], { type: mime }), ext: picked.ext, mime };
}
