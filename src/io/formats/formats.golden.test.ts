/// <reference types="node" />
// SPDX-License-Identifier: GPL-3.0-or-later
// Golden tests: our DST / JEF / EXP / VP3 writers vs files written by pyembroidery 1.5.1
// (tests/tools/make_goldens_formats.py). JEF embeds a timestamp; the goldens fix it with
// pyembroidery's `date` setting and we pass the same value.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { normalizeForPes, toMachineCommands } from '@/io/pes/machineCommands';
import { planFromCommands, type SynthCommand, type SynthThread } from '@/io/pes/testing';
import { writeDst } from './dst';
import { encodeProgram } from './encoder';
import { writeExp } from './exp';
import { jefDateString, writeJef } from './jef';
import { writeVp3 } from './vp3';

const FIXTURES = fileURLToPath(new URL('../../../tests/fixtures/formats/', import.meta.url));

interface GoldenCase {
  id: string;
  name: string;
  threads: SynthThread[];
  commands: SynthCommand[];
  segmentThreads: number[];
  files: {
    dst: string;
    jef: string;
    exp: string;
    vp3: string;
    vp3IgnoreStops?: string;
    jefTrims?: string;
  };
}

const goldens = JSON.parse(readFileSync(FIXTURES + 'goldens.json', 'utf8')) as {
  jefDate: string;
  cases: GoldenCase[];
};

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

const JEF_COMPAT = { date: goldens.jefDate, colorMatch: 'pyembroidery' } as const;

describe('DST / JEF / EXP / VP3 golden files (byte-identical to pyembroidery 1.5.1)', () => {
  it('has fixtures', () => {
    expect(goldens.cases.length).toBeGreaterThanOrEqual(8);
  });

  for (const c of goldens.cases) {
    describe(c.id, () => {
      it('DST', () => {
        const { plan, design } = build(c);
        expect(firstDiff(writeDst(plan, design), load(c.files.dst))).toBeNull();
      });

      it('JEF (pyembroidery colour matching, fixed date)', () => {
        const { plan, design } = build(c);
        expect(firstDiff(writeJef(plan, design, JEF_COMPAT), load(c.files.jef))).toBeNull();
        if (c.files.jefTrims) {
          const ours = writeJef(plan, design, { ...JEF_COMPAT, trims: true });
          expect(firstDiff(ours, load(c.files.jefTrims))).toBeNull();
        }
      });

      it('JEF only differs in the timestamp when the date is not fixed', () => {
        const { plan, design } = build(c);
        const now = writeJef(plan, design, { colorMatch: 'pyembroidery' });
        const golden = load(c.files.jef);
        expect(now.length).toBe(golden.length);
        const patched = now.slice();
        patched.set(new TextEncoder().encode(goldens.jefDate), 8);
        expect(firstDiff(patched, golden)).toBeNull();
      });

      it('EXP', () => {
        const { plan, design } = build(c);
        expect(firstDiff(writeExp(plan, design), load(c.files.exp))).toBeNull();
      });

      it('VP3 (stops as colour changes)', () => {
        const { plan, design } = build(c);
        expect(firstDiff(writeVp3(plan, design), load(c.files.vp3))).toBeNull();
        if (c.files.vp3IgnoreStops) {
          const ours = writeVp3(plan, design, { stops: 'ignore' });
          expect(firstDiff(ours, load(c.files.vp3IgnoreStops))).toBeNull();
        }
      });

      it('the shared encoder with PES settings reproduces normalizeForPes', () => {
        const { plan } = build(c);
        const program = toMachineCommands(plan);
        const pes = normalizeForPes(program);
        const ours = encodeProgram(program, {
          maxJump: 2047,
          maxStitch: 2047,
          fullJump: true,
          stops: 'colorChange',
        });
        expect(ours.commands).toEqual(pes.commands);
        expect(ours.colorSlots).toEqual(pes.colorSlots);
      });
    });
  }
});

describe('jefDateString', () => {
  it('formats local time as YYYYMMDDHHMMSS', () => {
    expect(jefDateString(new Date(2026, 0, 2, 3, 4, 5))).toBe('20260102030405');
  });
});
