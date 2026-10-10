/// <reference types="node" />
// SPDX-License-Identifier: GPL-3.0-or-later
// Golden tests: our PES writer vs files written by pyembroidery (tests/tools/make_goldens.py).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MC_NAME } from './machineCommands';
import { buildUniquePalette, nearestPecIndex, nearestPecIndexRedMean } from './pecPalette';
import { readPes } from './pesReader';
import { buildPesPattern, writePes } from './pesWriter';
import { planFromCommands, type SynthCommand, type SynthThread } from './testing';

const FIXTURES = fileURLToPath(new URL('../../../tests/fixtures/pes/', import.meta.url));

interface GoldenCase {
  id: string;
  name: string;
  threads: SynthThread[];
  commands: SynthCommand[];
  segmentThreads: number[];
  files: { v1: string; v6: string };
  pyembroideryRead: {
    commands: [string, number, number][];
    threads: string[];
    bounds: [number, number, number, number];
    label: string;
  };
}

const goldens = JSON.parse(readFileSync(FIXTURES + 'goldens.json', 'utf8')) as { cases: GoldenCase[] };

function load(file: string): Uint8Array {
  return new Uint8Array(readFileSync(FIXTURES + file));
}

function build(c: GoldenCase) {
  return planFromCommands(c.commands, c.threads, { name: c.name, segmentThreads: c.segmentThreads });
}

/** First differing byte, for a readable failure message. */
function firstDiff(a: Uint8Array, b: Uint8Array): string | null {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) {
      const hex = (u: Uint8Array) =>
        Array.from(u.subarray(Math.max(0, i - 4), i + 8))
          .map((v) => v.toString(16).padStart(2, '0'))
          .join(' ');
      return `offset ${i} (len ${a.length} vs ${b.length}): ours ${hex(a)} | golden ${hex(b)}`;
    }
  }
  return null;
}

describe('PES golden files (byte-identical to pyembroidery 1.5.1)', () => {
  it('has fixtures', () => {
    expect(goldens.cases.length).toBeGreaterThanOrEqual(6);
  });

  for (const c of goldens.cases) {
    describe(c.id, () => {
      // pyembroidery always writes hoop flag 1 and matches colours with its red-mean metric.
      it('v1 matches byte for byte (pyembroidery colour matching, hoop 1)', () => {
        const { plan, design } = build(c);
        const ours = writePes(plan, design, { version: 1, hoop: 1, colorMatch: 'pyembroidery' });
        expect(firstDiff(ours, load(c.files.v1))).toBeNull();
      });

      it('v6 matches byte for byte (pyembroidery colour matching)', () => {
        const { plan, design } = build(c);
        const ours = writePes(plan, design, { version: 6, colorMatch: 'pyembroidery' });
        expect(firstDiff(ours, load(c.files.v6))).toBeNull();
      });

      // The fixtures use colours on which CIEDE2000 and red-mean agree, so the default
      // (CIEDE2000) mode is byte-identical too.
      it('default colour matching (CIEDE2000) agrees on these colours', () => {
        const { plan, design } = build(c);
        const colors = buildPesPattern(plan, design).threads.map((t) => t.color);
        expect(buildUniquePalette(colors, 'ciede2000')).toEqual(buildUniquePalette(colors, 'pyembroidery'));
        for (const col of colors) expect(nearestPecIndex(col)).toBe(nearestPecIndexRedMean(col));
        expect(firstDiff(writePes(plan, design, { version: 1, hoop: 1 }), load(c.files.v1))).toBeNull();
        expect(firstDiff(writePes(plan, design, { version: 6 }), load(c.files.v6))).toBeNull();
      });

      it('auto hoop flag only changes bytes 14–15 of v1', () => {
        const { plan, design } = build(c);
        const ours = writePes(plan, design, { version: 1, colorMatch: 'pyembroidery' });
        const golden = load(c.files.v1);
        const b = plan.bounds;
        const fits100 = b.maxX - b.minX <= 100 && b.maxY - b.minY <= 100;
        expect(ours[12] | (ours[13] << 8)).toBe(1); // scale to fit
        expect(ours[14] | (ours[15] << 8)).toBe(fits100 ? 0 : 1); // hoop flag
        const patched = ours.slice();
        patched[14] = 1;
        patched[15] = 0;
        expect(firstDiff(patched, golden)).toBeNull();
      });

      it('readPes reads the pyembroidery file like pyembroidery does', () => {
        for (const file of [c.files.v1, c.files.v6]) {
          const r = readPes(load(file));
          const cmds = r.commands.map((m) => [MC_NAME[m.cmd], m.x, m.y]);
          expect(cmds).toEqual(c.pyembroideryRead.commands);
          expect(r.label).toBe(c.pyembroideryRead.label);
          const [minX, minY, maxX, maxY] = c.pyembroideryRead.bounds;
          expect(r.bounds).toEqual({ minX, minY, maxX, maxY });
          expect(r.thumbnails).toHaveLength(r.pecColorIndexes.length + 1);
          if (file === c.files.v1) {
            expect(r.version).toBe(1);
            expect(r.colors.map((t) => t.color)).toEqual(c.pyembroideryRead.threads);
          } else {
            expect(r.version).toBe(6);
            expect(r.metadata.name).toBe(c.name);
            // v6 carries the exact thread colours and metadata.
            const used = r.colors.map((t) => t.color);
            for (const col of used) expect(c.threads.map((t) => t.color)).toContain(col);
            expect(r.colors[0].name).toBe(c.threads[c.segmentThreads[0]].name);
          }
        }
      });
    });
  }
});
