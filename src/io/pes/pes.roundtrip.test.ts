// SPDX-License-Identifier: GPL-3.0-or-later
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { F } from '@/engine/types';
import { MC, normalizeForPes, toMachineCommands, type MachineCommand } from './machineCommands';
import { buildUniquePalette } from './pecPalette';
import { readPes } from './pesReader';
import { buildPesPattern, writePes, type PesWriteOptions } from './pesWriter';
import {
  describeCommands,
  expectedReadBack,
  planFromCommands,
  type SynthCommand,
  type SynthThread,
} from './testing';
import type { StitchPlan } from '@/engine/types';
import type { Design } from '@/model/types';

const RED: SynthThread = { color: '#e3242b', name: 'Red', code: '1902', chart: 'isacord-polyester' };
const BLUE: SynthThread = { color: '#0a55a3', name: 'Blue', code: '3810', chart: 'isacord-polyester' };
const GREEN: SynthThread = { color: '#2f7e20', name: 'Green' };

function planStitchUnits(plan: StitchPlan): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < plan.flags.length; i++) {
    if (plan.flags[i] & F.END) break;
    if ((plan.flags[i] & (F.JUMP | F.TRIM | F.COLOR_CHANGE | F.STOP)) === 0) {
      out.push([Math.round(plan.x[i] * 10) || 0, Math.round(plan.y[i] * 10) || 0]);
    }
  }
  return out;
}

/** Full round-trip check for one plan and one set of writer options. */
function roundTrip(plan: StitchPlan, design: Pick<Design, 'name' | 'threads'>, opts: PesWriteOptions) {
  const norm = normalizeForPes(toMachineCommands(plan));
  const pattern = buildPesPattern(plan, design);
  const bytes = writePes(plan, design, opts);
  const read = readPes(bytes);

  // 1. Normalisation never adds, drops or moves a stitch.
  const normStitches = norm.commands.filter((c) => c.cmd === MC.STITCH).map((c) => [c.x, c.y]);
  expect(normStitches).toEqual(planStitchUnits(plan));

  // 2. The reader returns exactly the predicted command list.
  //    v1 can only distinguish colours by PEC index; v6 by the full thread record.
  const expectedPec = buildUniquePalette(
    pattern.threads.map((t) => t.color),
    opts.colorMatch ?? 'ciede2000',
  );
  expect(read.pecColorIndexes).toEqual(expectedPec);
  const keys = opts.version === 6 ? pattern.threads.map((t) => JSON.stringify(t)) : expectedPec.map(String);
  const expected = expectedReadBack(norm, keys);
  expect(describeCommands(read.commands)).toEqual(describeCommands(expected));

  // 3. Positions within half a unit (0.05 mm) of the plan, stats consistent.
  const readStitches = read.commands.filter((c) => c.cmd === MC.STITCH);
  for (const [x, y] of planStitchUnits(plan)) {
    expect(readStitches.some((s) => Math.abs(s.x - x) <= 0.5 && Math.abs(s.y - y) <= 0.5)).toBe(true);
  }
  const count = (cmds: MachineCommand[], cmd: number) => cmds.filter((c) => c.cmd === cmd).length;
  expect(read.stitchCount).toBe(count(expected, MC.STITCH));
  expect(read.colorChangeCount + read.stopCount).toBe(plan.stats.colorChanges + plan.stats.stops);
  expect(read.colors.length).toBe(read.colorChangeCount + 1);
  expect(read.pecColorIndexes.length).toBe(norm.colorSlots.length);
  expect(read.thumbnails).toHaveLength(norm.colorSlots.length + 1);
  const xs = expected.map((c) => c.x);
  const ys = expected.map((c) => c.y);
  expect(read.bounds).toEqual({
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  });
  return { read, norm, bytes };
}

describe('toMachineCommands', () => {
  it('rounds to 0.1 mm, strips informational flags and appends END', () => {
    const { plan } = planFromCommands(
      [
        ['STITCH', 1.04, -2.06, F.TIE],
        ['STITCH', 1.26, -2.0, F.UNDERLAY | F.TRAVEL],
        ['JUMP', 5.0, 5.0, F.TRAVEL],
        ['STITCH', -0.04, 0.0],
      ],
      [RED],
    );
    const { commands, segmentBlocks } = toMachineCommands(plan);
    expect(commands).toEqual([
      { x: 10, y: -21, cmd: MC.STITCH },
      { x: 13, y: -20, cmd: MC.STITCH },
      { x: 50, y: 50, cmd: MC.JUMP },
      { x: 0, y: 0, cmd: MC.STITCH }, // no -0
      { x: 0, y: 0, cmd: MC.END },
    ]);
    expect(Object.is(commands[3].x, 0)).toBe(true);
    expect(segmentBlocks).toEqual([0]);
  });

  it('computes deltas from rounded absolutes (no drift)', () => {
    // 100 stitches of 0.26 mm: naive delta rounding would drift by 0.04 mm per stitch.
    const cmds: SynthCommand[] = [];
    for (let i = 0; i <= 100; i++) cmds.push(['STITCH', i * 0.26, 0]);
    const { plan, design } = planFromCommands(cmds, [RED]);
    const read = readPes(writePes(plan, design));
    const last = read.commands.filter((c) => c.cmd === MC.STITCH).at(-1)!;
    expect(last.x).toBe(Math.round(Math.fround(100 * 0.26) * 10));
  });

  it('maps colour segments to colour blocks (stops keep the thread)', () => {
    const { plan } = planFromCommands(
      [['STITCH', 0, 0], ['STITCH', 1, 0], ['STOP'], ['STITCH', 2, 0], ['COLOR_CHANGE'], ['STITCH', 3, 0]],
      [RED, BLUE],
    );
    expect(plan.colorBlocks.map((b) => b.threadId)).toEqual(['t0', 't0', 't1']);
    expect(toMachineCommands(plan).segmentBlocks).toEqual([0, 1, 2]);
  });
});

describe('normalizeForPes (pyembroidery encoder semantics)', () => {
  it('documents the quirks on a small plan', () => {
    const { plan, design } = planFromCommands(
      [
        ['STITCH', 1, 1], // first stitch: JUMP from origin inserted
        ['STITCH', 2, 1],
        ['JUMP', 4, 4], // untrimmed jump
        ['STITCH', 5, 5], // moves on both axes after a jump → (0,0) stitch in PEC
        ['TRIM'],
        ['TRIM'], // already trimmed: dropped
        ['JUMP', 8, 8],
        ['COLOR_CHANGE'], // colour change while jumping → (0,0) stitch in PEC
        ['STITCH', 8, 8],
        ['STITCH', 9, 8],
        ['STOP'],
        ['STITCH', 10, 8], // after STOP (trimmed): JUMP inserted
        ['END'],
      ],
      [RED, BLUE],
    );
    const norm = normalizeForPes(toMachineCommands(plan));
    expect(describeCommands(norm.commands)).toEqual([
      'JUMP 10,10',
      'STITCH 10,10',
      'STITCH 20,10',
      'JUMP 40,40',
      'STITCH 50,50',
      'TRIM 50,50',
      'JUMP 80,80',
      'COLOR_CHANGE 80,80',
      'STITCH 80,80',
      'STITCH 90,80',
      'COLOR_CHANGE 90,80',
      'JUMP 100,80',
      'STITCH 100,80',
      'END 100,80',
    ]);
    expect(norm.colorSlots).toEqual([0, 1, 2]);
    expect(norm.stops).toBe(1);
    expect(buildPesPattern(plan, design).threads.map((t) => t.color)).toEqual([
      RED.color,
      BLUE.color,
      BLUE.color,
    ]);

    const read = readPes(writePes(plan, design));
    expect(describeCommands(read.commands)).toEqual([
      'JUMP 10,10', // first jump: JUMP flag
      'STITCH 10,10',
      'STITCH 20,10',
      'TRIM 20,10', // every later jump carries the TRIM flag
      'JUMP 40,40',
      'STITCH 40,40', // (0,0) quirk stitch
      'STITCH 50,50',
      'TRIM 50,50',
      'JUMP 80,80',
      'STITCH 80,80', // (0,0) stitch before a colour change while jumping
      'COLOR_CHANGE 80,80',
      'STITCH 80,80',
      'STITCH 90,80',
      'STOP 90,80', // duplicate colour reads back as STOP
      'TRIM 90,80',
      'JUMP 100,80',
      'STITCH 100,80',
      'END 100,80',
    ]);
    expect(read.colors.map((c) => c.pecIndex)).toEqual(read.pecColorIndexes.slice(0, 2));
  });

  it('splits moves longer than 204.7 mm into equal jumps', () => {
    const { plan } = planFromCommands(
      [['STITCH', -150, 0], ['TRIM'], ['JUMP', 150.1, 0], ['STITCH', 150.1, 0], ['STITCH', -150, 10]],
      [RED],
    );
    const norm = normalizeForPes(toMachineCommands(plan));
    expect(describeCommands(norm.commands)).toEqual([
      'JUMP -1500,0',
      'STITCH -1500,0',
      'TRIM -1500,0',
      'JUMP 0.5,0', // fractional; encoders round half to even
      'JUMP 1501,0',
      'STITCH 1501,0',
      'JUMP 0.5,50', // long stitch → needle jumps, then the stitch
      'STITCH -1500,100',
      'END -1500,100',
    ]);
  });
});

describe('PES round trip', () => {
  const plans: [string, SynthCommand[], SynthThread[]][] = [
    [
      'single colour',
      [
        ['STITCH', -10, -10],
        ['STITCH', 10, -10],
        ['STITCH', 10, 10],
        ['STITCH', -10, 10],
        ['STITCH', -10, -10],
      ],
      [RED],
    ],
    [
      'colours, trims, stops and long moves',
      [
        ['JUMP', -60, -40],
        ['STITCH', -60, -40],
        ['STITCH', -52.3, -40.1],
        ['STITCH', -60, -39.4],
        ['TRIM'],
        ['JUMP', 0, 0],
        ['STITCH', 0, 0],
        ['STITCH', 12.8, 0],
        ['STITCH', 12.8, 6.3],
        ['COLOR_CHANGE'],
        ['STITCH', 30, 30],
        ['STITCH', 31, 31],
        ['STOP'],
        ['STITCH', 31, 33],
        ['STITCH', 31, 35],
        ['TRIM'],
        ['COLOR_CHANGE'],
        ['JUMP', 180, -120],
        ['STITCH', 180, -120],
        ['STITCH', -180, 120],
        ['TRIM'],
        ['END'],
      ],
      [RED, BLUE, GREEN],
    ],
  ];

  for (const [name, cmds, threads] of plans) {
    for (const version of [1, 6] as const) {
      it(`${name} (v${version})`, () => {
        const { plan, design } = planFromCommands(cmds, threads, { name: 'RoundTrip' });
        const { read } = roundTrip(plan, design, { version });
        expect(read.version).toBe(version);
        expect(read.label).toBe('RoundTri');
        expect(read.stopCount).toBe(plan.stats.stops);
        expect(read.colorChangeCount).toBe(plan.stats.colorChanges);
        if (version === 6) {
          expect(read.metadata.name).toBe('RoundTrip');
          const used = plan.colorBlocks.map((b) => design.threads[b.threadId]);
          const unique = used.filter((t, i) => i === 0 || t.id !== used[i - 1].id);
          expect(read.colors.map((c) => c.color)).toEqual(unique.map((t) => t.color));
          expect(read.colors.map((c) => c.name)).toEqual(unique.map((t) => t.name));
          expect(read.colors.map((c) => c.code)).toEqual(unique.map((t) => t.code));
        }
      });
    }
  }

  it('truncated variants are readable', () => {
    const { plan, design } = planFromCommands(plans[1][1], plans[1][2]);
    for (const version of [1, 6] as const) {
      const read = readPes(writePes(plan, design, { version, truncated: true }));
      expect(read.version).toBe(version);
      expect(read.stitchCount).toBeGreaterThan(0);
      expect(read.colorChangeCount + read.stopCount).toBe(3);
    }
  });

  it('property: random plans round-trip', () => {
    const coord = fc.integer({ min: -2500, max: 2500 }).map((v) => v / 10);
    const step = fc.oneof(
      { weight: 8, arbitrary: fc.tuple(fc.constant('STITCH' as const), coord, coord) },
      { weight: 1, arbitrary: fc.tuple(fc.constant('JUMP' as const), coord, coord) },
      { weight: 1, arbitrary: fc.constant(['TRIM'] as SynthCommand) },
      { weight: 1, arbitrary: fc.constant(['COLOR_CHANGE'] as SynthCommand) },
      { weight: 1, arbitrary: fc.constant(['STOP'] as SynthCommand) },
    );
    fc.assert(
      fc.property(
        fc.array(step, { minLength: 1, maxLength: 60 }),
        fc.constantFrom<1 | 6>(1, 6),
        (steps, version) => {
          const cmds: SynthCommand[] = [['STITCH', 0.3, -0.2], ...(steps as SynthCommand[]), ['END']];
          const ccs = cmds.filter((c) => c[0] === 'COLOR_CHANGE').length;
          // Distinct colours per colour change so v1 can tell them apart.
          const palette = [
            '#ed171f',
            '#0a55a3',
            '#ffd911',
            '#2f7e20',
            '#913697',
            '#fe9e32',
            '#000000',
            '#f0f0f0',
          ];
          const threads = Array.from({ length: ccs + 1 }, (_, i) => ({
            color: palette[i % palette.length],
            name: `T${i}`,
          }));
          // Consecutive colours must differ for COLOR_CHANGE vs STOP to be distinguishable.
          if (threads.some((t, i) => i > 0 && t.color === threads[i - 1].color)) return;
          const { plan, design } = planFromCommands(cmds, threads, { name: 'Prop' });
          roundTrip(plan, design, { version });
        },
      ),
      { numRuns: 300 },
    );
  });
});
