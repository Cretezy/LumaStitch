// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * PES read result → StitchPlan, so an opened `.pes` can be previewed, rendered and played
 * back with the same code as our own designs (SPEC FR-6.6). Colour blocks split at colour
 * changes and stops (the boundary command closes the previous block, as in the engine);
 * every colour block is one pseudo element (`block-<k>`).
 */
import { F, type ColorBlock, type ElementRange, type StitchPlan } from '@/engine/types';
import { DEFAULT_SETTINGS } from '@/model/factories';
import { MC, type MachineCmd } from './machineCommands';
import { PEC_PALETTE } from './pecPalette';
import type { PesColor, PesReadResult } from './pesReader';

export interface PesToPlanOptions {
  /** Stitches per minute for the time estimate. Default 600. */
  machineSpm?: number;
  /** Seconds per trim. Default 6. */
  trimSeconds?: number;
  /** Seconds per colour change or stop. Default 30. */
  colorChangeSeconds?: number;
}

const FLAG_OF: Record<MachineCmd, number> = {
  [MC.STITCH]: F.STITCH,
  [MC.JUMP]: F.JUMP,
  [MC.TRIM]: F.TRIM,
  [MC.STOP]: F.STOP,
  [MC.END]: F.END,
  [MC.COLOR_CHANGE]: F.COLOR_CHANGE,
};

/**
 * Thread id used for colour `k` of a PES file. Colours with identical thread records share
 * the id of their first occurrence, so the colour count matches the design's thread count.
 */
export function pesThreadId(k: number): string {
  return `pes-${k}`;
}

/** Colour slot index a `pesThreadId` refers to. */
export function pesColorIndexOf(threadId: string): number {
  const k = Number(threadId.replace(/^pes-/, ''));
  return Number.isInteger(k) && k >= 0 ? k : 0;
}

function colorKey(c: PesColor): string {
  return JSON.stringify([
    c.color.toLowerCase(),
    c.name ?? null,
    c.code ?? null,
    c.brand ?? null,
    c.chart ?? null,
  ]);
}

/** Element id of the pseudo element for colour block `b`. */
export function pesBlockElementId(b: number): string {
  return `block-${b}`;
}

/** Colour of PES colour slot `k`, falling back to the PEC palette byte or a neutral grey. */
export function pesColorAt(r: Pick<PesReadResult, 'colors' | 'pecColorIndexes'>, k: number): PesColor {
  const c = r.colors[k];
  if (c) return c;
  const idx = r.pecColorIndexes[k];
  const p = idx !== undefined ? PEC_PALETTE[idx % PEC_PALETTE.length] : null;
  if (p) return { pecIndex: p.index, color: p.color, name: p.name, code: p.code };
  return { pecIndex: -1, color: '#808080' };
}

/** Converts a parsed PES file (0.1 mm machine commands) into a StitchPlan (mm, F flags). */
export function pesToPlan(r: PesReadResult, opts: PesToPlanOptions = {}): StitchPlan {
  const spm = opts.machineSpm ?? DEFAULT_SETTINGS.machineSpm;
  const trimSeconds = opts.trimSeconds ?? DEFAULT_SETTINGS.trimSeconds;
  const colorChangeSeconds = opts.colorChangeSeconds ?? DEFAULT_SETTINGS.colorChangeSeconds;

  // Everything after the first END is ignored; make sure the plan ends with one.
  const cmds = r.commands;
  let n = cmds.findIndex((c) => c.cmd === MC.END);
  const hasEnd = n >= 0;
  n = hasEnd ? n + 1 : cmds.length + 1;

  const x = new Float32Array(n);
  const y = new Float32Array(n);
  const flags = new Uint8Array(n);
  const element = new Uint32Array(n);
  const colorBlocks: ColorBlock[] = [];
  const elementRanges: ElementRange[] = [];
  const elementIds: string[] = [];

  let colorIndex = 0;
  let blockStart = 0;
  const firstSlotOf = new Map<string, number>();
  const threadIdOf = (k: number, c: PesColor) => {
    const key = colorKey(c);
    let first = firstSlotOf.get(key);
    if (first === undefined) firstSlotOf.set(key, (first = k));
    return pesThreadId(first);
  };
  let blockHasStitch = false;
  /** Closes the current block. Blocks without stitches are absorbed by the next (or, at the end, the previous) block. */
  const closeBlock = (end: number, final = false) => {
    if (end <= blockStart) return;
    if (!blockHasStitch) {
      const prev = colorBlocks[colorBlocks.length - 1];
      if (final && prev) {
        prev.end = end;
        elementRanges[elementRanges.length - 1].end = end;
        blockStart = end;
      }
      if (!final || prev) return;
    }
    blockHasStitch = false;
    const b = colorBlocks.length;
    const c = pesColorAt(r, colorIndex);
    const id = pesBlockElementId(b);
    colorBlocks.push({
      threadId: threadIdOf(colorIndex, c),
      color: c.color.toLowerCase(),
      start: blockStart,
      end,
    });
    elementRanges.push({ elementId: id, start: blockStart, end });
    elementIds.push(id);
    blockStart = end;
  };

  let stitches = 0,
    jumps = 0,
    trims = 0,
    colorChanges = 0,
    stops = 0,
    threadLengthMm = 0;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  let px = NaN,
    py = NaN;

  for (let i = 0; i < n; i++) {
    const c = cmds[i];
    const last = i === n - 1;
    const cmd: MachineCmd = c && !(last && !hasEnd) ? c.cmd : MC.END;
    const cx = c ? c.x / 10 : i > 0 ? x[i - 1] : 0;
    const cy = c ? c.y / 10 : i > 0 ? y[i - 1] : 0;
    x[i] = cx;
    y[i] = cy;
    const f = FLAG_OF[cmd];
    flags[i] = f;
    if (cmd === MC.STITCH) {
      stitches++;
      blockHasStitch = true;
      if (!Number.isNaN(px)) threadLengthMm += Math.hypot(x[i] - px, y[i] - py);
      if (x[i] < minX) minX = x[i];
      if (y[i] < minY) minY = y[i];
      if (x[i] > maxX) maxX = x[i];
      if (y[i] > maxY) maxY = y[i];
    } else if (cmd === MC.JUMP) jumps++;
    else if (cmd === MC.TRIM) trims++;
    else if (cmd === MC.COLOR_CHANGE) colorChanges++;
    else if (cmd === MC.STOP) stops++;
    // Same bookkeeping as the engine: the thread runs from the last needle position.
    if (cmd === MC.STITCH || cmd === MC.JUMP) {
      px = x[i];
      py = y[i];
    }
    if (cmd === MC.COLOR_CHANGE || cmd === MC.STOP) {
      closeBlock(i + 1);
      if (cmd === MC.COLOR_CHANGE) colorIndex++;
    }
  }
  closeBlock(n, true);
  colorBlocks.forEach((b, k) => element.fill(k, b.start, b.end));

  const bounds = stitches ? { minX, minY, maxX, maxY } : { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  const estSeconds =
    (stitches * 60) / Math.max(1, spm) + trims * trimSeconds + (colorChanges + stops) * colorChangeSeconds;

  return {
    revision: 0,
    x,
    y,
    flags,
    element,
    elementIds,
    elementRanges,
    colorBlocks,
    bounds,
    stats: { stitches, jumps, trims, colorChanges, stops, threadLengthMm, estSeconds },
    diagnostics: stitches
      ? []
      : [{ severity: 'warning', code: 'pes.empty', message: 'The file has no stitches.' }],
  };
}
