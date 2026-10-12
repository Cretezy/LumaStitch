// SPDX-License-Identifier: GPL-3.0-or-later
import { buildPlan } from '@/engine/plan';
import { zipFiles, type ZipEntry } from '@/library/zip';
import { serializeProject } from '@/model/schema';
import type { LetteringOptions } from '@/model/types';
import { writePes } from '@/io/pes/pesWriter';
import { letteringBatch } from './batch';
import { digitizedFont } from './digitizedFonts';
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
  const fonts = new Set(designs.flatMap((d) => Object.values(d.lettering ?? {}).map((g) => g.options.font)));
  const credits: string[] = [];
  for (const id of fonts) {
    const font = digitizedFont(id);
    if (font) {
      credits.push(`${font.name}: ${font.attribution} Source: ${font.source}`);
      entries.push({
        name: `licenses/${id}.txt`,
        data: enc.encode(`${font.attribution}\nSource: ${font.source}\n\n${font.license}`),
      });
    }
  }
  entries.push({
    name: 'README.txt',
    data: enc.encode(
      'LumaStitch lettering batch. Each numbered pair contains an editable project and a PES v6 machine file. OpenType projects embed their original font; its license continues to apply. Digitized font licenses are included in the licenses folder. Verify dimensions and test on the intended fabric before production.\n\n' +
        credits.join('\n'),
    ),
  });
  return zipFiles(entries);
}
