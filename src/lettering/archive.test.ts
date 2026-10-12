// SPDX-License-Identifier: GPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { buildPlan } from '@/engine/plan';
import { optimizeSequence } from '@/engine/sequence/optimize';
import { F } from '@/engine/types';
import { readPes } from '@/io/pes/pesReader';
import { pesFormat } from '@/io/export/pesFormat';
import { MC } from '@/io/pes/machineCommands';
import { unzipFiles } from '@/library/zip';
import { parseProjectFile } from '@/model/schema';
import { letteringArchive } from './archive';
import { DEFAULT_LETTERING } from './layout';

it('batch files retain editable text, unique filenames and decodable machine stitches', async () => {
  const files = await unzipFiles(letteringArchive(['Ada', 'Ada'], DEFAULT_LETTERING, '#234a73'));
  expect(new Set(files.map((f) => f.name)).size).toBe(files.length);
  for (const file of files.filter((f) => f.name.endsWith('.lumastitch'))) {
    const d = parseProjectFile(new TextDecoder().decode(file.data));
    expect(d.lettering!.text.options.text).toBe('Ada');
    const pes = files.find((f) => f.name === file.name.replace('.lumastitch', '.pes'))!;
    expect(readPes(pes.data).stitchCount).toBe(buildPlan(d).stats.stitches);
  }
});

it.each(['lettering-multiline', 'lettering-arc', 'lettering-monogram'])(
  '%s committed machine file contains every rendered needle point',
  (name) => {
    const base = `docs/lettering/${name}/${name}`;
    const d = parseProjectFile(readFileSync(`${base}.lumastitch`, 'utf8'));
    expect(optimizeSequence(d)).toEqual(d.sequence);
    const p = buildPlan(d);
    const bytes = pesFormat.write(p, d, { version: 6 });
    expect(bytes).toEqual(new Uint8Array(readFileSync(`${base}.pes`)));
    const expected: number[][] = [];
    for (let i = 0; i < p.flags.length; i++)
      if (!(p.flags[i] & (F.JUMP | F.TRIM | F.STOP | F.COLOR_CHANGE | F.END)))
        expected.push([Math.round(p.x[i] * 10) || 0, Math.round(p.y[i] * 10) || 0]);
    expect(
      readPes(bytes)
        .commands.filter((c) => c.cmd === MC.STITCH)
        .map((c) => [c.x, c.y]),
    ).toEqual(expected);
  },
);
