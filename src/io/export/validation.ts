// SPDX-License-Identifier: GPL-3.0-or-later
// Pre-export validation (ARCHITECTURE §15.5, SPEC FR-6.2) for PES and the other machine
// formats. Errors block export; warnings don't.
// There are deliberately no hoop or size warnings (SPEC §7), except that JEF stores a hoop
// code and warns when no Janome hoop it knows fits.
import { COMMAND_MASK, F, NO_ELEMENT, type Diagnostic, type StitchPlan } from '@/engine/types';
import {
  MC,
  normalizeForPes,
  PES_MAX_JUMP,
  toMachineCommands,
  type MachineCommand,
} from '@/io/pes/machineCommands';
import { buildFormatPattern } from '@/io/formats/encoder';
import { DST_MAX_DELTA, DST_SETTINGS } from '@/io/formats/dst';
import { EXP_SETTINGS } from '@/io/formats/exp';
import { JEF_HOOPS, JEF_SETTINGS, jefDesignSize, jefHoopFor } from '@/io/formats/jef';
import {
  VP3_MAX_COLOR_BLOCKS,
  VP3_MAX_DELTA,
  VP3_SETTINGS,
  vp3ColorBlocks,
  vp3MaxDelta,
} from '@/io/formats/vp3';
import { pyRound } from '@/io/pes/pymath';

/** Stitches longer than this (mm) produce a warning. */
export const LONG_STITCH_MM = 12;
/** More trims than this produce a warning. */
export const MANY_TRIMS = 200;
/** PEC header holds (colours − 1) in one byte, and pyembroidery asserts it is < 255. */
export const MAX_COLORS = 255;
/** PES section coordinates are int16 (0.1 mm). */
export const MAX_ABS_UNITS = 32767;

export interface ValidationOptions {
  longStitchMm?: number;
  manyTrims?: number;
}

function elementAt(plan: StitchPlan, i: number): string | undefined {
  const e = plan.element[i];
  return e === undefined || e === NO_ELEMENT ? undefined : plan.elementIds[e];
}

interface PlanScan {
  stitches: number;
  trims: number;
  longCount: number;
  longest: number;
  firstLong: number;
}

/** Plan scan: stitches, trims, long stitches (measured on the plan, in mm). */
function scanPlan(plan: StitchPlan, longStitchMm: number): PlanScan {
  const n = plan.flags.length;
  let stitches = 0;
  let trims = 0;
  let longCount = 0;
  let longest = 0;
  let firstLong = -1;
  // After a trim / colour change / stop (and at the start) the exporter reaches the next
  // stitch with a jump, so only stitches sewn from a stitch or an untrimmed jump count.
  let trimmed = true;
  for (let i = 0; i < n; i++) {
    const f = plan.flags[i] & COMMAND_MASK;
    if (f & F.END) break;
    if (f & F.TRIM) trims++;
    if (f & (F.TRIM | F.COLOR_CHANGE | F.STOP)) trimmed = true;
    if (f !== 0) continue;
    stitches++;
    const wasTrimmed = trimmed;
    trimmed = false;
    if (wasTrimmed || i === 0) continue;
    const len = Math.hypot(plan.x[i] - plan.x[i - 1], plan.y[i] - plan.y[i - 1]);
    if (len > longStitchMm) {
      longCount++;
      if (len > longest) longest = len;
      if (firstLong < 0) firstLong = i;
    }
  }
  return { stitches, trims, longCount, longest, firstLong };
}

/** Errors every format shares: nothing to sew, no colours. */
function basicErrors(plan: StitchPlan, scan: PlanScan): Diagnostic[] {
  const out: Diagnostic[] = [];
  if (scan.stitches === 0) {
    out.push({ severity: 'error', code: 'export.empty', message: 'The design has no stitches to export.' });
  }
  if (plan.colorBlocks.length === 0) {
    out.push({ severity: 'error', code: 'export.no-colors', message: 'The design has no thread colours.' });
  }
  return out;
}

/** Warnings every format shares: long stitches, many trims. */
function basicWarnings(
  plan: StitchPlan,
  scan: PlanScan,
  longStitchMm: number,
  manyTrims: number,
): Diagnostic[] {
  const out: Diagnostic[] = [];
  if (scan.longCount > 0) {
    const n = scan.longCount;
    const d: Diagnostic = {
      severity: 'warning',
      code: 'export.long-stitches',
      message: `${n} stitch${n === 1 ? ' is' : 'es are'} longer than ${longStitchMm} mm (longest ${scan.longest.toFixed(1)} mm). They may snag or be split by the machine.`,
      at: [plan.x[scan.firstLong], plan.y[scan.firstLong]],
    };
    const el = elementAt(plan, scan.firstLong);
    if (el !== undefined) d.elementId = el;
    out.push(d);
  }
  if (scan.trims > manyTrims) {
    out.push({
      severity: 'warning',
      code: 'export.many-trims',
      message: `The design has ${scan.trims} trims. Each trim slows sewing; consider reordering or connecting objects.`,
    });
  }
  return out;
}

/** Validates a plan for PES export. */
export function validatePesExport(plan: StitchPlan, opts: ValidationOptions = {}): Diagnostic[] {
  const longStitchMm = opts.longStitchMm ?? LONG_STITCH_MM;
  const manyTrims = opts.manyTrims ?? MANY_TRIMS;
  const scan = scanPlan(plan, longStitchMm);
  const out = basicErrors(plan, scan);

  if (scan.stitches > 0) {
    // Format range, checked on what will actually be encoded (after jump splitting).
    const norm = normalizeForPes(toMachineCommands(plan));
    let px = 0;
    let py = 0;
    let badDelta = -1;
    let badAbs = -1;
    for (let k = 0; k < norm.commands.length; k++) {
      const c = norm.commands[k];
      const dx = pyRound(c.x - px);
      const dy = pyRound(c.y - py);
      px += dx;
      py += dy;
      if (badDelta < 0 && (Math.abs(dx) > PES_MAX_JUMP || Math.abs(dy) > PES_MAX_JUMP)) badDelta = k;
      if (badAbs < 0 && (Math.abs(c.x) > MAX_ABS_UNITS || Math.abs(c.y) > MAX_ABS_UNITS)) badAbs = k;
      if (c.cmd === MC.END) break;
    }
    if (badDelta >= 0) {
      const c = norm.commands[badDelta];
      out.push({
        severity: 'error',
        code: 'export.out-of-range',
        message: 'A move is longer than the PES format allows (±204.7 mm per command).',
        at: [c.x / 10, c.y / 10],
      });
    } else if (badAbs >= 0) {
      const c = norm.commands[badAbs];
      out.push({
        severity: 'error',
        code: 'export.out-of-range',
        message: 'The design extends beyond the PES coordinate range (±3.27 m).',
        at: [c.x / 10, c.y / 10],
      });
    }
    if (norm.colorSlots.length > MAX_COLORS) {
      out.push({
        severity: 'error',
        code: 'export.too-many-colors',
        message: `PES supports at most ${MAX_COLORS} colour blocks; this design has ${norm.colorSlots.length}.`,
      });
    }
  }

  out.push(...basicWarnings(plan, scan, longStitchMm, manyTrims));
  return out;
}

/** Machine formats other than PES with a validator here. */
export type MachineFormatId = 'dst' | 'jef' | 'exp' | 'vp3';

const FORMAT_NAME: Record<MachineFormatId, string> = { dst: 'DST', jef: 'JEF', exp: 'EXP', vp3: 'VP3' };

/** First encoded STITCH/JUMP whose rounded delta exceeds `max` on either axis. */
function firstOutOfRange(commands: readonly MachineCommand[], max: number): MachineCommand | undefined {
  let px = 0;
  let py = 0;
  for (const c of commands) {
    const dx = pyRound(c.x - px);
    const dy = pyRound(c.y - py);
    px += dx;
    py += dy;
    if ((c.cmd === MC.STITCH || c.cmd === MC.JUMP) && (Math.abs(dx) > max || Math.abs(dy) > max)) return c;
    if (c.cmd === MC.END) break;
  }
  return undefined;
}

/**
 * Validates a plan for DST / JEF / EXP / VP3 export (ARCHITECTURE §15.5 applied to each
 * format). Like PES there are no hoop checks, except that JEF stores a hoop code: it warns
 * when the design is larger than every Janome hoop the format knows.
 */
export function validateMachineExport(
  plan: StitchPlan,
  format: MachineFormatId,
  opts: ValidationOptions = {},
): Diagnostic[] {
  const longStitchMm = opts.longStitchMm ?? LONG_STITCH_MM;
  const manyTrims = opts.manyTrims ?? MANY_TRIMS;
  const scan = scanPlan(plan, longStitchMm);
  const out = basicErrors(plan, scan);
  const name = FORMAT_NAME[format];

  if (scan.stitches > 0) {
    const settings =
      format === 'dst'
        ? DST_SETTINGS
        : format === 'jef'
          ? JEF_SETTINGS
          : format === 'exp'
            ? EXP_SETTINGS
            : VP3_SETTINGS;
    const pattern = buildFormatPattern(plan, { name: '', threads: {} }, settings);
    if (format === 'vp3') {
      const blocks = vp3ColorBlocks(pattern).length;
      if (vp3MaxDelta(pattern) > VP3_MAX_DELTA) {
        out.push({
          severity: 'error',
          code: 'export.out-of-range',
          message: 'A move is longer than the VP3 format allows (±3.27 m).',
        });
      }
      if (blocks > VP3_MAX_COLOR_BLOCKS) {
        out.push({
          severity: 'error',
          code: 'export.too-many-colors',
          message: `VP3 supports at most ${VP3_MAX_COLOR_BLOCKS} colour blocks (stops count as blocks); this design has ${blocks}.`,
        });
      }
    } else {
      // The encoder splits long moves, so this only trips on a defect; kept as a safety net.
      const max = format === 'dst' ? DST_MAX_DELTA : 127;
      const bad = firstOutOfRange(pattern.commands, max);
      if (bad) {
        out.push({
          severity: 'error',
          code: 'export.out-of-range',
          message: `A move is longer than the ${name} format allows (±${(max / 10).toFixed(1)} mm per command).`,
          at: [bad.x / 10, bad.y / 10],
        });
      }
    }
    if (format === 'jef') {
      const { width, height } = jefDesignSize(pattern);
      if (!jefHoopFor(width, height).fits) {
        const largest = JEF_HOOPS[JEF_HOOPS.length - 1];
        out.push({
          severity: 'warning',
          code: 'export.jef-hoop',
          message: `The design (${(width / 10).toFixed(1)} × ${(height / 10).toFixed(1)} mm) is larger than the largest Janome hoop JEF can declare (${largest.label}). The file is written for the 110 × 110 mm hoop and the machine may refuse or need it repositioned.`,
        });
      }
    }
  }

  out.push(...basicWarnings(plan, scan, longStitchMm, manyTrims));
  return out;
}

export function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === 'error');
}
