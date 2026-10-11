// SPDX-License-Identifier: GPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { buildPlan } from '@/engine/plan';
import { optimizeSequence } from '@/engine/sequence/optimize';
import { F } from '@/engine/types';
import { parseProjectFile, serializeProject } from '@/model/schema';
import { pesFormat } from '@/io/export/pesFormat';
import { readPes } from '@/io/pes/pesReader';
import { MC } from '@/io/pes/machineCommands';
import { stitchExamples } from './stitch-examples';

it.each(stitchExamples())(
  '$name project and PES preserve every illustrated needle penetration',
  ({ name, design }) => {
    design.sequence = optimizeSequence(design);
    const saved = parseProjectFile(
      readFileSync(`docs/stitch-examples/after/${name}/${name}.lumastitch`, 'utf8'),
    );
    expect(saved).toEqual(parseProjectFile(serializeProject(design)));
    const plan = buildPlan(saved);
    expect(plan.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const bytes = pesFormat.write(plan, saved, { version: 6 });
    expect(bytes).toEqual(new Uint8Array(readFileSync(`docs/stitch-examples/after/${name}/${name}.pes`)));
    const decoded = readPes(bytes);
    const expected: number[][] = [];
    for (let i = 0; i < plan.flags.length; i++)
      if (!(plan.flags[i] & (F.JUMP | F.TRIM | F.STOP | F.COLOR_CHANGE | F.END)))
        expected.push([Math.round(plan.x[i] * 10) || 0, Math.round(plan.y[i] * 10) || 0]);
    expect(decoded.commands.filter((c) => c.cmd === MC.STITCH).map((c) => [c.x, c.y])).toEqual(expected);
    expect(decoded.colorChangeCount).toBe(plan.stats.colorChanges);
    expect(decoded.commands.at(-1)?.cmd).toBe(MC.END);
  },
);
