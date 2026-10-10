/// <reference types="node" />
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Cross-check of the DST / JEF / EXP / VP3 writers against pyembroidery (manual, needs
 * Python + pyembroidery):
 *
 *   FORMATS_CROSSCHECK_DIR=/tmp/fmt-xcheck npx vitest run --project unit tests/integration/formats.crosscheck
 *   python tests/tools/crosscheck_formats.py /tmp/fmt-xcheck
 *
 * Writes, for the golden patterns, three random plans and an app design (buildPlan):
 * - `<id>.<ext>`: our files with the app's default options, plus summary.json with what a
 *   reader should find (stitch count, colour changes + stops, colour blocks, stitch extents);
 * - `<id>.compat.<ext>`: pyembroidery-compatible options (fixed JEF date, red-mean JEF
 *   colours) plus cases.json, so the script can write the same patterns with pyembroidery
 *   and compare bytes.
 * Skipped unless FORMATS_CROSSCHECK_DIR is set.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildPlan } from '@/engine/plan';
import type { StitchPlan } from '@/engine/types';
import { compound, ellipseGeom, polylineGeom, rectGeom } from '@/geom/shapes';
import { writeDst, DST_SETTINGS } from '@/io/formats/dst';
import { buildFormatPattern, type EncoderSettings } from '@/io/formats/encoder';
import { writeExp, EXP_SETTINGS } from '@/io/formats/exp';
import { writeJef, JEF_SETTINGS } from '@/io/formats/jef';
import { vp3ColorBlocks, writeVp3, VP3_SETTINGS } from '@/io/formats/vp3';
import { MC } from '@/io/pes/machineCommands';
import { planFromCommands, type SynthCommand, type SynthThread } from '@/io/pes/testing';
import { createDesign, createElement, createShape, createThread } from '@/model/factories';
import type { Design, PathGeom, StitchType } from '@/model/types';

const OUT = process.env.FORMATS_CROSSCHECK_DIR;
const FIXTURES = fileURLToPath(new URL('../fixtures/formats/', import.meta.url));
const JEF_DATE = '20261010123456';

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

function randomCase(seed: number) {
  const r = rng(seed);
  const commands: SynthCommand[] = [];
  let x = 0;
  let y = 0;
  let colors = 1;
  for (let i = 0; i < 3000; i++) {
    const p = r();
    if (p < 0.9) {
      x = Math.max(-140, Math.min(140, x + (r() - 0.5) * 30));
      y = Math.max(-90, Math.min(90, y + (r() - 0.5) * 30));
      commands.push(['STITCH', Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
    } else if (p < 0.94) {
      commands.push(
        ['TRIM'],
        ['JUMP', Math.round((r() - 0.5) * 2800) / 10, Math.round((r() - 0.5) * 1800) / 10],
      );
    } else if (p < 0.96) {
      commands.push(['JUMP', Math.round((r() - 0.5) * 400) / 10, Math.round((r() - 0.5) * 400) / 10]);
    } else if (p < 0.98) {
      commands.push(['TRIM'], ['COLOR_CHANGE']);
      colors++;
    } else {
      commands.push(['STOP']);
    }
  }
  commands.push(['END']);
  const r2 = rng(seed * 7919);
  const threads: SynthThread[] = Array.from({ length: colors }, (_, i) => ({
    color:
      '#' +
      Math.floor(r2() * 0xffffff)
        .toString(16)
        .padStart(6, '0'),
    name: `Random ${i}`,
    code: String(1000 + i),
    chart: 'isacord-polyester',
  }));
  return { id: `random${seed}`, name: `Random${seed}`, threads, commands, segmentThreads: undefined };
}

function appDesign(): Design {
  const d = createDesign({ name: 'Logo3' });
  const items: { geom: PathGeom; fill?: StitchType; outline?: StitchType; color: string; sw?: number }[] = [
    {
      geom: compound([ellipseGeom(0, 0, 30, 24), ellipseGeom(0, 0, 10, 8)]),
      fill: 'tatami',
      color: '#c1121f',
    },
    { geom: rectGeom(-25, -3, 50, 6), fill: 'satinFill', color: '#003049' },
    { geom: ellipseGeom(0, 0, 30, 24), outline: 'satin', color: '#003049', sw: 2.5 },
    {
      geom: polylineGeom([
        [-30, 32],
        [30, 32],
      ]),
      outline: 'triple',
      color: '#fdf0d5',
    },
  ];
  for (const it of items) {
    let t = Object.values(d.threads).find((x) => x.color === it.color);
    if (!t) {
      t = createThread(it.color);
      d.threads[t.id] = t;
    }
    const s = createShape('s', it.geom, { strokeWidth: it.sw });
    if (it.fill) s.fill = createElement('fill', it.fill, t.id, {});
    if (it.outline) s.outline = createElement('outline', it.outline, t.id, {});
    d.shapes[s.id] = s;
    d.zOrder.push(s.id);
    for (const el of [s.fill, s.outline]) if (el) d.sequence.push({ kind: 'element', elementId: el.id });
  }
  // A stop between the two navy elements' neighbours exercises stop handling.
  d.sequence.splice(2, 0, { kind: 'stop', id: 'stop1' });
  return d;
}

const SETTINGS: Record<'dst' | 'jef' | 'exp' | 'vp3', EncoderSettings> = {
  dst: DST_SETTINGS,
  jef: JEF_SETTINGS,
  exp: EXP_SETTINGS,
  vp3: VP3_SETTINGS,
};

/** What a reader should find in our file. */
function expectations(
  plan: StitchPlan,
  design: Pick<Design, 'name' | 'threads'>,
  ext: keyof typeof SETTINGS,
) {
  const pattern = buildFormatPattern(plan, design, SETTINGS[ext]);
  let stitches = 0;
  let changes = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of pattern.commands) {
    if (c.cmd === MC.STITCH) {
      stitches++;
      minX = Math.min(minX, c.x);
      minY = Math.min(minY, c.y);
      maxX = Math.max(maxX, c.x);
      maxY = Math.max(maxY, c.y);
    } else if (c.cmd === MC.COLOR_CHANGE || c.cmd === MC.STOP) changes++;
  }
  return {
    stitches,
    planStitches: plan.stats.stitches,
    changes,
    colorBlocks: ext === 'vp3' ? vp3ColorBlocks(pattern).length : changes + 1,
    stitchBounds: [minX, minY, maxX, maxY],
  };
}

describe.skipIf(!OUT)('pyembroidery cross-check (DST / JEF / EXP / VP3)', () => {
  it('writes our files, compat files and the expected reader summary', () => {
    const dir = OUT!;
    mkdirSync(dir, { recursive: true });
    const goldens = JSON.parse(readFileSync(FIXTURES + 'goldens.json', 'utf8')) as {
      cases: {
        id: string;
        name: string;
        threads: SynthThread[];
        commands: SynthCommand[];
        segmentThreads?: number[];
      }[];
    };
    const synth = [...goldens.cases, ...[1, 2, 3].map(randomCase)];
    writeFileSync(
      join(dir, 'cases.json'),
      JSON.stringify(
        synth.map(({ id, name, threads, commands, segmentThreads }) => ({
          id,
          name,
          threads,
          commands,
          segmentThreads,
        })),
      ),
    );
    const inputs: {
      id: string;
      plan: StitchPlan;
      design: Pick<Design, 'name' | 'threads'>;
      synthetic: boolean;
    }[] = [
      ...synth.map((c) => ({
        id: c.id,
        synthetic: true,
        ...planFromCommands(c.commands, c.threads, { name: c.name, segmentThreads: c.segmentThreads }),
      })),
    ];
    const app = appDesign();
    const appPlan = buildPlan(app);
    expect(appPlan.stats.stitches).toBeGreaterThan(1000);
    expect(appPlan.stats.stops).toBe(1);
    inputs.push({ id: 'app', plan: appPlan, design: app, synthetic: false });

    const summary: unknown[] = [];
    for (const { id, plan, design, synthetic } of inputs) {
      const files: [keyof typeof SETTINGS, Uint8Array][] = [
        ['dst', writeDst(plan, design)],
        ['jef', writeJef(plan, design)],
        ['exp', writeExp(plan, design)],
        ['vp3', writeVp3(plan, design)],
      ];
      for (const [ext, bytes] of files) {
        const file = `${id}.${ext}`;
        writeFileSync(join(dir, file), bytes);
        summary.push({ file, format: ext, ...expectations(plan, design, ext) });
      }
      if (synthetic) {
        writeFileSync(join(dir, `${id}.compat.dst`), writeDst(plan, design));
        writeFileSync(
          join(dir, `${id}.compat.jef`),
          writeJef(plan, design, { date: JEF_DATE, colorMatch: 'pyembroidery' }),
        );
        writeFileSync(join(dir, `${id}.compat.exp`), writeExp(plan, design));
        writeFileSync(join(dir, `${id}.compat.vp3`), writeVp3(plan, design));
      }
    }
    writeFileSync(join(dir, 'summary.json'), JSON.stringify({ jefDate: JEF_DATE, files: summary }));
  });
});
