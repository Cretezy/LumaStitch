// SPDX-License-Identifier: GPL-3.0-or-later
// Brother PES as an export format.
import { hoopWarnings } from '@/engine/hoop';
import type { StitchPlan } from '@/engine/types';
import type { Design } from '@/model/types';
import { writePes, type PesWriteOptions } from '@/io/pes/pesWriter';
import { CHART_MANIFEST } from '@/threads/charts/manifest';
import type { MachineExportFormat } from './registry';
import { hasErrors, validatePesExport } from './validation';

/** Options accepted by the PES export (all optional; v1 with CIEDE2000 colour mapping by default). */
export type PesExportOptions = Pick<PesWriteOptions, 'version' | 'truncated' | 'hoop' | 'colorMatch'>;

/** Thread chart id → brand / chart name for the v6 thread table. */
export function resolveChart(chartId: string): { brand?: string; chart?: string } | undefined {
  const entry = CHART_MANIFEST.find((c) => c.id === chartId);
  return entry ? { brand: entry.brand, chart: entry.name } : undefined;
}

function parseOptions(opts: unknown): PesExportOptions {
  const o = (opts && typeof opts === 'object' ? opts : {}) as Record<string, unknown>;
  const out: PesExportOptions = {};
  if (o.version === 1 || o.version === 6) out.version = o.version;
  if (typeof o.truncated === 'boolean') out.truncated = o.truncated;
  if (o.hoop === 'auto' || o.hoop === 0 || o.hoop === 1) out.hoop = o.hoop;
  if (o.colorMatch === 'ciede2000' || o.colorMatch === 'pyembroidery') out.colorMatch = o.colorMatch;
  return out;
}

export const pesFormat: MachineExportFormat = {
  id: 'pes',
  kind: 'machine',
  ext: 'pes',
  mime: 'application/octet-stream',
  label: 'Brother PES',
  validate(plan: StitchPlan, design: Design) {
    return [...validatePesExport(plan), ...hoopWarnings(plan, design.hoop)];
  },
  write(plan: StitchPlan, design: Design, opts: unknown) {
    const diagnostics = validatePesExport(plan);
    if (hasErrors(diagnostics)) {
      const msg = diagnostics
        .filter((d) => d.severity === 'error')
        .map((d) => d.message)
        .join(' ');
      throw new Error(`Cannot export PES: ${msg}`);
    }
    return writePes(plan, design, { ...parseOptions(opts), resolveChart });
  },
};
