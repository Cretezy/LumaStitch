// SPDX-License-Identifier: GPL-3.0-or-later
// Test helpers for the PES codec: build synthetic StitchPlans and predict what a PES
// reader will return for a written plan.
import { F, NO_ELEMENT, type ColorBlock, type StitchPlan } from '@/engine/types';
import type { Design, Thread } from '@/model/types';
import { MC, MC_NAME, type MachineCommand, type NormalizedPes } from './machineCommands';
import { pyRound } from './pymath';

/** `[name, xMm, yMm, extraFlags?]` for STITCH/JUMP; `[name]` for the rest (they stay in place). */
export type SynthCommand =
  | [name: 'STITCH' | 'JUMP', x: number, y: number, extraFlags?: number]
  | [name: 'TRIM' | 'COLOR_CHANGE' | 'STOP' | 'END'];

export interface SynthThread {
  color: string;
  name?: string;
  code?: string;
  chart?: string;
}

const FLAG_OF: Record<SynthCommand[0], number> = {
  STITCH: F.STITCH,
  JUMP: F.JUMP,
  TRIM: F.TRIM,
  COLOR_CHANGE: F.COLOR_CHANGE,
  STOP: F.STOP,
  END: F.END,
};

/**
 * Builds a StitchPlan (+ the Design fields the PES writer needs) from a command list.
 * Colour blocks split at COLOR_CHANGE and STOP; the boundary command closes the previous
 * block. COLOR_CHANGE advances to the next thread, STOP keeps the current one, unless
 * `segmentThreads` gives the thread index of every segment explicitly.
 */
export function planFromCommands(
  commands: readonly SynthCommand[],
  threads: readonly SynthThread[],
  opts: { name?: string; segmentThreads?: number[] } = {},
): { plan: StitchPlan; design: Pick<Design, 'name' | 'threads'> } {
  const n = commands.length;
  const x = new Float32Array(n);
  const y = new Float32Array(n);
  const flags = new Uint8Array(n);
  const element = new Uint32Array(n).fill(NO_ELEMENT);
  const designThreads: Record<string, Thread> = {};
  threads.forEach((t, i) => {
    const th: Thread = { id: `t${i}`, name: t.name ?? `Thread ${i + 1}`, color: t.color.toLowerCase() };
    if (t.code !== undefined) th.code = t.code;
    if (t.chart !== undefined) th.chart = t.chart;
    designThreads[th.id] = th;
  });

  const colorBlocks: ColorBlock[] = [];
  let seg = 0;
  let threadIdx = 0;
  let blockStart = 0;
  const segThread = () => opts.segmentThreads?.[seg] ?? threadIdx;
  const closeBlock = (end: number) => {
    const ti = Math.min(segThread(), threads.length - 1);
    if (ti >= 0)
      colorBlocks.push({
        threadId: `t${ti}`,
        color: threads[ti].color.toLowerCase(),
        start: blockStart,
        end,
      });
    blockStart = end;
  };

  let px = 0;
  let py = 0;
  const stats = {
    stitches: 0,
    jumps: 0,
    trims: 0,
    colorChanges: 0,
    stops: 0,
    threadLengthMm: 0,
    estSeconds: 0,
  };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let prevStitch = false;
  commands.forEach((c, i) => {
    const name = c[0];
    if (name === 'STITCH' || name === 'JUMP') {
      const nx = c[1];
      const ny = c[2];
      if (name === 'STITCH') {
        stats.stitches++;
        if (prevStitch) stats.threadLengthMm += Math.hypot(nx - px, ny - py);
        minX = Math.min(minX, nx);
        minY = Math.min(minY, ny);
        maxX = Math.max(maxX, nx);
        maxY = Math.max(maxY, ny);
      } else stats.jumps++;
      prevStitch = name === 'STITCH';
      px = nx;
      py = ny;
      flags[i] = FLAG_OF[name] | (c[3] ?? 0);
    } else {
      flags[i] = FLAG_OF[name];
      if (name === 'TRIM') stats.trims++;
      if (name === 'COLOR_CHANGE') stats.colorChanges++;
      if (name === 'STOP') stats.stops++;
      if (name !== 'END') prevStitch = false;
    }
    x[i] = px;
    y[i] = py;
    if (name === 'COLOR_CHANGE' || name === 'STOP') {
      closeBlock(i + 1);
      seg++;
      if (name === 'COLOR_CHANGE') threadIdx++;
    }
  });
  if (blockStart < n || colorBlocks.length === 0) closeBlock(n);

  const plan: StitchPlan = {
    revision: 1,
    x,
    y,
    flags,
    element,
    elementIds: [],
    elementRanges: [],
    colorBlocks: threads.length ? colorBlocks : [],
    bounds: stats.stitches ? { minX, minY, maxX, maxY } : { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    stats,
    diagnostics: [],
  };
  return { plan, design: { name: opts.name ?? 'Test', threads: designThreads } };
}

/**
 * Predicts the command list a PES reader (ours or pyembroidery's) returns for a file
 * written from `norm`, mirroring `pec_encode` and `read_pec_stitches`:
 * the first jump stays a JUMP, later jumps read back as TRIM + JUMP, standalone TRIMs
 * vanish (they are carried by the following jump), a (0,0) stitch is inserted after a
 * jump when the next stitch moves on both axes or a colour change follows, and colour
 * changes between equal colour slots read back as STOP.
 */
export function expectedReadBack(norm: NormalizedPes, slotKeys: readonly string[]): MachineCommand[] {
  const out: MachineCommand[] = [];
  let xx = 0;
  let yy = 0;
  let jumping = true;
  let init = true;
  const push = (cmd: MachineCommand['cmd']) => out.push({ x: xx, y: yy, cmd });
  for (const c of norm.commands) {
    const dx = pyRound(c.x - xx);
    const dy = pyRound(c.y - yy);
    if (c.cmd === MC.STITCH) {
      if (jumping) {
        if (dx !== 0 && dy !== 0) push(MC.STITCH);
        jumping = false;
      }
      xx += dx;
      yy += dy;
      push(MC.STITCH);
    } else if (c.cmd === MC.JUMP) {
      jumping = true;
      if (!init) push(MC.TRIM);
      xx += dx;
      yy += dy;
      push(MC.JUMP);
    } else if (c.cmd === MC.COLOR_CHANGE) {
      xx += dx;
      yy += dy;
      if (jumping) {
        push(MC.STITCH);
        jumping = false;
      }
      push(MC.COLOR_CHANGE);
    } else if (c.cmd === MC.END) {
      xx += dx;
      yy += dy;
      push(MC.END);
      break;
    } else {
      xx += dx;
      yy += dy;
    }
    init = false;
  }
  // interpolate_duplicate_color_as_stop
  const keys = slotKeys.slice();
  let threadIndex = 0;
  let initColor = true;
  let lastChange = -1;
  for (let pos = 0; pos < out.length; pos++) {
    const cmd = out[pos].cmd;
    if (cmd === MC.STITCH) {
      if (initColor) {
        if (lastChange >= 0 && threadIndex !== 0) {
          if (threadIndex >= keys.length) break;
          if (keys[threadIndex - 1] === keys[threadIndex]) {
            keys.splice(threadIndex, 1);
            out[lastChange] = { ...out[lastChange], cmd: MC.STOP };
          } else threadIndex++;
        } else threadIndex++;
        initColor = false;
      }
    } else if (cmd === MC.COLOR_CHANGE) {
      initColor = true;
      lastChange = pos;
    }
  }
  return out;
}

/** Human-readable command list (for snapshots / debugging). */
export function describeCommands(cmds: readonly MachineCommand[]): string[] {
  return cmds.map((c) => `${MC_NAME[c.cmd]} ${c.x},${c.y}`);
}
