// SPDX-License-Identifier: GPL-3.0-or-later
/** Loading a `.pes` file for the viewer (FR-6.6). */
import type { StitchPlan } from '@/engine/types';
import { PesReadError, readPes, type PesReadResult } from '@/io/pes';
import { pesToPlan } from '@/io/pes/toPlan';
import { errorMessage } from './save';

export type LoadedPes =
  | { kind: 'loading' }
  | { kind: 'error'; title: string; detail: string }
  | { kind: 'ok'; read: PesReadResult; plan: StitchPlan };

/** Reads a PES file and converts it to a plan; errors become an inline message. */
export async function loadPesFile(file: Blob): Promise<LoadedPes> {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const read = readPes(bytes);
    return { kind: 'ok', read, plan: pesToPlan(read) };
  } catch (err) {
    if (err instanceof PesReadError)
      return { kind: 'error', title: 'This is not a PES file we can read.', detail: err.message };
    return {
      kind: 'error',
      title: 'The file could not be read. It may be damaged or truncated.',
      detail: errorMessage(err),
    };
  }
}

export function versionLabel(r: Pick<PesReadResult, 'version' | 'signature'>): string {
  if (r.signature === '#PEC0001') return 'PEC (no PES header)';
  if (r.version === 0) return `Unknown PES (${r.signature.replace(/[^\x20-\x7e]/g, '?')})`;
  return `PES v${r.version}`;
}
