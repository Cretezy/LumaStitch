// SPDX-License-Identifier: GPL-3.0-or-later
// Export format registry (ARCHITECTURE §15.7). Machine formats (PES, DST, JEF, EXP, VP3)
// write synchronously; document exports (the PDF worksheet) render images and are async.
// More formats can be registered without touching the engine.
import type { Diagnostic, StitchPlan } from '@/engine/types';
import type { Design } from '@/model/types';
import { dstFormat, expFormat, jefFormat, vp3Format } from './machineFormats';
import { pdfFormat } from './pdf';
import { pesFormat } from './pesFormat';

interface ExportFormatBase {
  id: string;
  /** File extension without the dot. */
  ext: string;
  label: string;
  /** MIME type of the written file. */
  mime: string;
  validate(plan: StitchPlan, design: Design): Diagnostic[];
}

/** An embroidery machine file. `write` throws when validation reports errors. */
export interface MachineExportFormat extends ExportFormatBase {
  kind: 'machine';
  write(plan: StitchPlan, design: Design, opts: unknown): Uint8Array;
}

/** A document (needs the DOM / canvas, so it is async). */
export interface DocumentExportFormat extends ExportFormatBase {
  kind: 'document';
  write(plan: StitchPlan, design: Design, opts: unknown): Promise<Uint8Array>;
}

export type ExportFormat = MachineExportFormat | DocumentExportFormat;

const formats = new Map<string, ExportFormat>();

/** Registers (or replaces) a format by id. */
export function registerFormat(format: ExportFormat): void {
  formats.set(format.id, format);
}

export function getFormat(id: string): ExportFormat | undefined {
  return formats.get(id);
}

/** A registered machine format (synchronous writer), or undefined. */
export function getMachineFormat(id: string): MachineExportFormat | undefined {
  const f = formats.get(id);
  return f?.kind === 'machine' ? f : undefined;
}

/** Registered formats in registration order. */
export function listFormats(): ExportFormat[] {
  return [...formats.values()];
}

/** Registered machine formats in registration order. */
export function listMachineFormats(): MachineExportFormat[] {
  return listFormats().filter((f): f is MachineExportFormat => f.kind === 'machine');
}

/** Writes with any registered format. */
export async function writeFormat(
  id: string,
  plan: StitchPlan,
  design: Design,
  opts?: unknown,
): Promise<Uint8Array> {
  const f = formats.get(id);
  if (!f) throw new Error(`Unknown export format: ${id}`);
  return f.write(plan, design, opts);
}

registerFormat(pesFormat);
registerFormat(dstFormat);
registerFormat(jefFormat);
registerFormat(expFormat);
registerFormat(vp3Format);
registerFormat(pdfFormat);
