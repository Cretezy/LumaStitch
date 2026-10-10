/// <reference types="node" />
// SPDX-License-Identifier: GPL-3.0-or-later
// Cross-check against pyembroidery's reader (manual, needs Python + pyembroidery):
//
//   PES_CROSSCHECK_DIR=/tmp/pes-xcheck npx vitest run --project unit src/io/pes/pes.crosscheck
//   python tests/tools/crosscheck_pes.py /tmp/pes-xcheck
//
// The test writes PES files with OUR writer plus summary.json (what OUR reader sees);
// the Python script reads every file with pyembroidery and compares stitch count,
// colour count, command count and bounds. Skipped unless PES_CROSSCHECK_DIR is set.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MC } from './machineCommands';
import { readPes } from './pesReader';
import { writePes } from './pesWriter';
import { planFromCommands, type SynthCommand, type SynthThread } from './testing';

const OUT = process.env.PES_CROSSCHECK_DIR;
const FIXTURES = fileURLToPath(new URL('../../../tests/fixtures/pes/', import.meta.url));

/** Small deterministic PRNG (mulberry32). */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomPlan(seed: number): { cmds: SynthCommand[]; threads: SynthThread[] } {
  const r = rng(seed);
  const cmds: SynthCommand[] = [];
  let x = 0;
  let y = 0;
  let colors = 1;
  for (let i = 0; i < 3000; i++) {
    const p = r();
    if (p < 0.9) {
      x = Math.max(-140, Math.min(140, x + (r() - 0.5) * 14));
      y = Math.max(-90, Math.min(90, y + (r() - 0.5) * 14));
      cmds.push(['STITCH', Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
    } else if (p < 0.94) {
      cmds.push(['TRIM'], ['JUMP', Math.round((r() - 0.5) * 2800) / 10, Math.round((r() - 0.5) * 1800) / 10]);
    } else if (p < 0.96) {
      cmds.push(['JUMP', Math.round((r() - 0.5) * 400) / 10, Math.round((r() - 0.5) * 400) / 10]);
    } else if (p < 0.98) {
      cmds.push(['TRIM'], ['COLOR_CHANGE']);
      colors++;
    } else {
      cmds.push(['STOP']);
    }
  }
  cmds.push(['END']);
  const threads = Array.from({ length: colors }, (_, i) => ({
    color:
      '#' +
      Math.floor(rng(seed * 100 + i)() * 0xffffff)
        .toString(16)
        .padStart(6, '0'),
    name: `Random ${i}`,
    code: String(1000 + i),
    chart: 'isacord-polyester',
  }));
  return { cmds, threads };
}

describe.skipIf(!OUT)('pyembroidery cross-check export', () => {
  it('writes our files and reader summary', () => {
    const dir = OUT!;
    mkdirSync(dir, { recursive: true });
    const goldens = JSON.parse(readFileSync(FIXTURES + 'goldens.json', 'utf8')) as {
      cases: {
        id: string;
        name: string;
        threads: SynthThread[];
        commands: SynthCommand[];
        segmentThreads: number[];
      }[];
    };
    const cases = [
      ...goldens.cases,
      ...[1, 2, 3].map((seed) => {
        const { cmds, threads } = randomPlan(seed);
        return {
          id: `random${seed}`,
          name: `Random${seed}`,
          threads,
          commands: cmds,
          segmentThreads: undefined,
        };
      }),
    ];
    const inputs = cases.map((c) => ({
      id: c.id,
      name: c.name,
      ...planFromCommands(c.commands, c.threads, { name: c.name, segmentThreads: c.segmentThreads }),
    }));
    // Inputs for byte-for-byte comparison with pyembroidery's writer (compat settings).
    writeFileSync(
      join(dir, 'cases.json'),
      JSON.stringify(cases.map(({ id, name, threads, commands }) => ({ id, name, threads, commands }))),
    );
    const summary: unknown[] = [];
    for (const input of inputs) {
      for (const version of [1, 6] as const) {
        const compat = writePes(input.plan, input.design, { version, hoop: 1, colorMatch: 'pyembroidery' });
        writeFileSync(join(dir, `${input.id}.compat.v${version}.pes`), compat);
      }
      for (const version of [1, 6] as const) {
        const file = `${input.id}.ours.v${version}.pes`;
        const bytes = writePes(input.plan, input.design, { version });
        writeFileSync(join(dir, file), bytes);
        const r = readPes(bytes);
        summary.push({
          file,
          version,
          label: r.label,
          stitchCount: r.stitchCount,
          commandCount: r.commands.length,
          colorCount: r.colors.length,
          colorChangeCount: r.colorChangeCount,
          stopCount: r.stopCount,
          bounds: [r.bounds.minX, r.bounds.minY, r.bounds.maxX, r.bounds.maxY],
          commands: r.commands.map((c) => [c.cmd, c.x, c.y]),
          colors: r.colors.map((c) => c.color),
        });
        expect(r.commands.at(-1)?.cmd).toBe(MC.END);
      }
    }
    writeFileSync(join(dir, 'summary.json'), JSON.stringify(summary));
  });
});
