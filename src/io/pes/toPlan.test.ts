// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { buildPlan } from '@/engine/plan';
import { F, type StitchPlan } from '@/engine/types';
import { ellipseGeom, rectGeom } from '@/geom/shapes';
import { createDesign, createElement, createShape, createThread } from '@/model/factories';
import type { Design } from '@/model/types';
import { readPes } from './pesReader';
import { writePes } from './pesWriter';
import { pesBlockElementId, pesToPlan } from './toPlan';
import { planFromCommands } from './testing';

/** Five shapes, two colours (red returns after blue), a same-colour stop and a long (trimmed) connector. */
function sampleDesign(): Design {
  const d = createDesign({ name: 'Sample' });
  const red = createThread('#e3242b', 'Red');
  const blue = createThread('#0a55a3', 'Blue', { code: '3810', chart: 'isacord-polyester' });
  d.threads[red.id] = red;
  d.threads[blue.id] = blue;
  const add = (name: string, geom: ReturnType<typeof rectGeom>, threadId: string, outline = false) => {
    const s = createShape(name, geom);
    s.fill = createElement('fill', 'tatami', threadId);
    if (outline) s.outline = createElement('outline', 'running', threadId);
    d.shapes[s.id] = s;
    d.zOrder.push(s.id);
    d.sequence.push({ kind: 'element', elementId: s.fill.id });
    if (s.outline) d.sequence.push({ kind: 'element', elementId: s.outline.id });
  };
  add('A', rectGeom(0, 0, 12, 8), red.id, true);
  add('B', rectGeom(30, 0, 10, 10), red.id);
  d.sequence.push({ kind: 'stop', id: 'stop1' });
  add('C', ellipseGeom(10, 25, 7, 5), red.id);
  add('D', rectGeom(-20, 15, 8, 8), blue.id, true);
  add('E', rectGeom(40, 20, 6, 6), red.id);
  return d;
}

function kinds(plan: StitchPlan): string[] {
  const out: string[] = [];
  for (let i = 0; i < plan.flags.length; i++) {
    const f = plan.flags[i];
    out.push(
      f & F.END
        ? 'END'
        : f & F.COLOR_CHANGE
          ? 'CC'
          : f & F.STOP
            ? 'STOP'
            : f & F.TRIM
              ? 'TRIM'
              : f & F.JUMP
                ? 'JUMP'
                : 'STITCH',
    );
  }
  return out;
}

describe('pesToPlan', () => {
  for (const version of [1, 6] as const) {
    it(`round-trips an engine plan through PES v${version}`, () => {
      const design = sampleDesign();
      const plan = buildPlan(design);
      expect(plan.stats.stitches).toBeGreaterThan(100);
      expect(plan.stats.stops).toBe(1);
      expect(plan.stats.colorChanges).toBe(2);

      const read = readPes(writePes(plan, design, { version, hoop: 'auto' }));
      const back = pesToPlan(read);

      expect(back.stats.stitches).toBe(plan.stats.stitches);
      expect(back.stats.colorChanges).toBe(plan.stats.colorChanges);
      expect(back.stats.stops).toBe(plan.stats.stops);
      expect(back.stats.trims).toBe(plan.stats.trims);
      expect(back.colorBlocks).toHaveLength(plan.colorBlocks.length);
      for (const k of ['minX', 'minY', 'maxX', 'maxY'] as const)
        expect(Math.abs(back.bounds[k] - plan.bounds[k])).toBeLessThanOrEqual(0.0501);
      expect(kinds(back)).toEqual(kinds(plan));
      expect(Math.abs(back.stats.threadLengthMm - plan.stats.threadLengthMm)).toBeLessThan(
        plan.stats.threadLengthMm * 0.01,
      );
      expect(back.stats.estSeconds).toBeCloseTo(plan.stats.estSeconds, 6);

      // Block structure: boundaries at the same commands; one pseudo element per block.
      expect(back.colorBlocks.map((b) => [b.start, b.end])).toEqual(
        plan.colorBlocks.map((b) => [b.start, b.end]),
      );
      expect(back.elementIds).toEqual(back.colorBlocks.map((_, k) => pesBlockElementId(k)));
      expect(back.elementRanges.map((r) => [r.start, r.end])).toEqual(
        back.colorBlocks.map((b) => [b.start, b.end]),
      );
      for (let i = 0; i < back.flags.length; i++) {
        const b = back.colorBlocks[back.element[i]];
        expect(i >= b.start && i < b.end).toBe(true);
      }

      // Stop keeps the thread; the colour change switches it.
      expect(back.colorBlocks[0].threadId).toBe(back.colorBlocks[1].threadId);
      expect(back.colorBlocks[2].threadId).not.toBe(back.colorBlocks[1].threadId);
      expect(back.colorBlocks[3].threadId).toBe(back.colorBlocks[0].threadId);
      // Same thread → same id, so the colour count matches the design.
      expect(new Set(back.colorBlocks.map((b) => b.threadId)).size).toBe(
        new Set(plan.colorBlocks.map((b) => b.threadId)).size,
      );
      if (version === 6) {
        expect(back.colorBlocks.map((b) => b.color)).toEqual(plan.colorBlocks.map((b) => b.color));
      } else {
        // v1 stores PEC palette colours: Red → #ed171f, Blue → #0a55a3.
        expect(back.colorBlocks.map((b) => b.color)).toEqual(['#ed171f', '#ed171f', '#0a55a3', '#ed171f']);
      }
    });
  }

  it('handles a file without stitches', () => {
    const { plan, design } = planFromCommands([['JUMP', 1, 1], ['END']], [{ color: '#000000' }]);
    const back = pesToPlan(readPes(writePes(plan, design)));
    expect(back.stats.stitches).toBe(0);
    expect(back.bounds).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
    expect(back.flags[back.flags.length - 1] & F.END).toBeTruthy();
    expect(back.colorBlocks).toHaveLength(1);
  });

  it('appends END and absorbs stitchless blocks', () => {
    const read = readPes(
      writePes(
        ...((): [StitchPlan, Pick<Design, 'name' | 'threads'>] => {
          const { plan, design } = planFromCommands(
            [
              ['STITCH', 0, 0],
              ['STITCH', 2, 0],
              ['COLOR_CHANGE'],
              ['STITCH', 2, 3],
              ['STITCH', 4, 3],
              ['END'],
            ],
            [{ color: '#ff0000' }, { color: '#00ff00' }],
          );
          return [plan, design];
        })(),
      ),
    );
    const cmds = read.commands.slice(0, -1); // drop END
    const back = pesToPlan({ ...read, commands: [...cmds, { x: 40, y: 30, cmd: 5 }] }); // trailing colour change
    expect(back.flags[back.flags.length - 1]).toBe(F.END);
    expect(back.colorBlocks).toHaveLength(2);
    expect(back.colorBlocks[1].end).toBe(back.flags.length);
  });
});
