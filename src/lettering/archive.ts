// SPDX-License-Identifier: GPL-3.0-or-later
import { buildPlan } from '@/engine/plan';
import { zipFiles, type ZipEntry } from '@/library/zip';
import { serializeProject } from '@/model/schema';
import type { LetteringOptions } from '@/model/types';
import { writePes } from '@/io/pes/pesWriter';
import { letteringBatch } from './batch';
import type { Design } from '@/model/types';

export function letteringArchive(names: string[], options: LetteringOptions, color: string): Uint8Array {
  if (names.join('').length > 5000) throw new Error('Limit a batch to 5,000 characters in total.');
  return archiveLetteringDesigns(letteringBatch(names, options, color));
}

export function archiveLetteringDesigns(designs: Design[]): Uint8Array {
  const entries: ZipEntry[] = [];
  const enc = new TextEncoder();
  for (const [i, d] of designs.entries()) {
    const name = `${String(i + 1).padStart(3, '0')}-${d.name.replace(/[^\p{L}\p{N}_-]/gu, '_').slice(0, 60)}`;
    const plan = buildPlan(d);
    const errors = plan.diagnostics.filter((v) => v.severity === 'error');
    if (errors.length) throw new Error(`${d.name}: ${errors.map((v) => v.message).join(' ')}`);
    entries.push({ name: `${name}.lumastitch`, data: enc.encode(serializeProject(d)) });
    entries.push({ name: `${name}.pes`, data: writePes(plan, d, { version: 6 }) });
  }
  entries.push({
    name: 'README.txt',
    data: enc.encode(
      'LumaStitch lettering batch. Each numbered pair contains an editable project and a PES v6 machine file. OpenType projects embed their original font; its license continues to apply. Geneva Simple Sans digitized font: CC-BY-SA 2.5; https://github.com/inkstitch/embroidery-fonts/tree/084eac038bf1af5a3a8b881a6cf0cc3340cf6e9b/src/geneva_simple . Verify dimensions and test on the intended fabric before production.',
    ),
  });
  return zipFiles(entries);
}
