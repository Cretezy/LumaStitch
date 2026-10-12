// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, it } from 'vitest';
import { satinDef, type SatinColumnPrep } from './index';
import { columnFromCenterline, sewColumn, type UnderlayKind } from './column';
import { RunBuilder } from '../common';
import { DEFAULT_SETTINGS } from '@/model/factories';
import { F, type StitchRun } from '../../types';
import type { Vec2 } from '@/model/types';

const distance = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const first = (r: StitchRun): Vec2 => [r.xy[0], r.xy[1]];
const last = (r: StitchRun): Vec2 => [r.xy[r.xy.length - 2], r.xy[r.xy.length - 1]];

it.each<UnderlayKind>(['none', 'center', 'edge', 'zigzag', 'edgeZigzag', 'centerZigzag', 'centerEdge'])(
  'optimizes actual needle endpoints with %s underlay against every order and direction',
  (underlay) => {
    const prep: SatinColumnPrep = {
      paths: [
        [4, 8, 7, 2],
        [12, 5, 3, 1],
        [20, 2, 14, 9],
        [9, 17, 2, 14],
      ].map((xy) => ({ pts: Float64Array.from(xy), closed: false })),
      halfWidth: 2.5,
      width: 5,
      density: 0.4,
      underlay,
      underlayInset: 0.4,
      zigzagUnderlaySpacing: 2,
      underlayStitchLength: 2,
      shortStitches: true,
      splitAbove: 7,
      zigzag: false,
    };
    const entry: Vec2 = [0, 0],
      exit: Vec2 = [20, 20];
    const candidates = prep.paths.map(({ pts }) =>
      [true, false].map((forward) => {
        const b = new RunBuilder();
        sewColumn(b, columnFromCenterline(pts, false, prep.halfWidth), prep, undefined, undefined, forward);
        return b.build();
      }),
    );
    let optimum = Infinity;
    const visit = (left: number[], pos: Vec2, cost: number) => {
      if (!left.length) {
        optimum = Math.min(optimum, cost + 0.5 * distance(pos, exit));
        return;
      }
      for (const i of left)
        for (const r of candidates[i])
          visit(
            left.filter((j) => j !== i),
            last(r),
            cost + distance(pos, first(r)),
          );
    };
    visit([0, 1, 2, 3], entry, 0);
    const run = satinDef.route(
      prep,
      { entry, exit },
      { settings: DEFAULT_SETTINGS, tolerance: 0.05, diag() {} },
    );
    let actual = distance(entry, first(run)) + 0.5 * distance(last(run), exit);
    let jumps = 0;
    for (let i = 1; i < run.flags.length; i++)
      if (run.flags[i] & F.JUMP) {
        actual += Math.hypot(run.xy[i * 2] - run.xy[i * 2 - 2], run.xy[i * 2 + 1] - run.xy[i * 2 - 1]);
        jumps++;
      }
    expect(actual).toBeCloseTo(optimum, 8);
    expect(jumps).toBe(3);
    expect(run.flags.length).toBe(candidates.reduce((n, pair) => n + pair[0].flags.length, 0));
  },
);
