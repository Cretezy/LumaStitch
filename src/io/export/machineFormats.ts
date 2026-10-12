// SPDX-License-Identifier: GPL-3.0-or-later
// DST, JEF, EXP and VP3 as export formats (writers in src/io/formats, ported from pyembroidery).
import { hoopWarnings } from '@/engine/hoop';
import type { StitchPlan } from '@/engine/types';
import type { Design } from '@/model/types';
import { writeDst, type DstWriteOptions } from '@/io/formats/dst';
import { writeExp } from '@/io/formats/exp';
import { writeJef, type JefWriteOptions } from '@/io/formats/jef';
import { writeVp3, type Vp3WriteOptions } from '@/io/formats/vp3';
import { resolveChart } from './pesFormat';
import type { MachineExportFormat } from './registry';
import { hasErrors, validateMachineExport, type MachineFormatId } from './validation';

function record(opts: unknown): Record<string, unknown> {
  return (opts && typeof opts === 'object' ? opts : {}) as Record<string, unknown>;
}

function assertValid(plan: StitchPlan, id: MachineFormatId, label: string): void {
  const diagnostics = validateMachineExport(plan, id);
  if (hasErrors(diagnostics)) {
    const msg = diagnostics
      .filter((d) => d.severity === 'error')
      .map((d) => d.message)
      .join(' ');
    throw new Error(`Cannot export ${label}: ${msg}`);
  }
}

function machineFormat(
  id: MachineFormatId,
  label: string,
  write: (plan: StitchPlan, design: Design, opts: unknown) => Uint8Array,
): MachineExportFormat {
  const short = id.toUpperCase();
  return {
    id,
    kind: 'machine',
    ext: id,
    mime: 'application/octet-stream',
    label,
    validate(plan: StitchPlan, design: Design) {
      return [...validateMachineExport(plan, id), ...hoopWarnings(plan, design.hoop)];
    },
    write(plan: StitchPlan, design: Design, opts: unknown) {
      assertValid(plan, id, short);
      return write(plan, design, opts);
    },
  };
}

/** Options: `{ trimAt?: number }`. */
export const dstFormat = machineFormat('dst', 'Tajima DST (commercial machines)', (plan, design, opts) => {
  const o = record(opts);
  const out: DstWriteOptions = {};
  if (typeof o.trimAt === 'number' && o.trimAt >= 2) out.trimAt = Math.floor(o.trimAt);
  return writeDst(plan, design, out);
});

/** Options: `{ date?: string | Date; trims?: boolean; colorMatch?: 'ciede2000' | 'pyembroidery' }`. */
export const jefFormat = machineFormat('jef', 'Janome JEF', (plan, design, opts) => {
  const o = record(opts);
  const out: JefWriteOptions = {};
  if ((typeof o.date === 'string' && /^\d{14}$/.test(o.date)) || o.date instanceof Date) out.date = o.date;
  if (typeof o.trims === 'boolean') out.trims = o.trims;
  if (o.colorMatch === 'ciede2000' || o.colorMatch === 'pyembroidery') out.colorMatch = o.colorMatch;
  return writeJef(plan, design, { ...out, resolveChart });
});

/** No options. */
export const expFormat = machineFormat('exp', 'Bernina / Melco EXP', (plan, design) =>
  writeExp(plan, design),
);

/** Options: `{ stops?: 'colorChange' | 'ignore' }`. */
export const vp3Format = machineFormat('vp3', 'Husqvarna / Pfaff VP3', (plan, design, opts) => {
  const o = record(opts);
  const out: Vp3WriteOptions = { resolveChart };
  if (o.stops === 'colorChange' || o.stops === 'ignore') out.stops = o.stops;
  return writeVp3(plan, design, out);
});
