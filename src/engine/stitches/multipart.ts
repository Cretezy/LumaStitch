// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Multi-part fills for stitch types that sew a whole shape at once: each connected part (e.g. one
 * letter of a word set as a single path) is prepared on its own and sewn completely before the
 * next, in the shortest order, finishing next to the following part; the moves between parts are
 * trimmed jumps (the sequencer still sews hops of 1 mm or less). Tatami does this natively.
 */
import { makeValid } from '@/geom/clipper';
import { flattenGeom } from '@/geom/flatten';
import { polyShapeToGeom } from '@/model/geomOps';
import type { Vec2 } from '@/model/types';
import type { StitchTypeDef } from '../def';
import { F, type StitchRun } from '../types';
import { nearestPointTo, partOrder } from './tatami';

interface MultiPrep<P> {
  single?: P;
  parts?: { prep: P; outer: Float64Array }[];
}

export function perPart<P>(def: StitchTypeDef<P>): StitchTypeDef<MultiPrep<P>> {
  return {
    ...def,
    prepare(geom, params, el, ctx) {
      const ps = makeValid(flattenGeom(geom, ctx.tolerance).rings, geom.fillRule);
      if (ps.length <= 1) return { single: def.prepare(geom, params, el, ctx) };
      // Rail splits refer to the whole shape's outline; they don't carry over to its parts.
      const partEl = { ...el, railSplit: undefined };
      return {
        parts: ps.map((p) => ({
          prep: def.prepare(polyShapeToGeom([p]), params, partEl, ctx),
          outer: p.outer,
        })),
      };
    },
    route(prep, hints, ctx) {
      if (prep.single !== undefined || !prep.parts) return def.route(prep.single as P, hints, ctx);
      const parts = prep.parts;
      const order = partOrder(parts, hints.entry, hints.exit);
      const xy: number[] = [];
      const flags: number[] = [];
      let cur: Vec2 | undefined = hints.entry;
      order.forEach((pi, k) => {
        const last = k === order.length - 1;
        const run: StitchRun = def.route(
          parts[pi].prep,
          {
            entry: cur,
            exit: last ? hints.exit : nearestPointTo(parts[order[k + 1]].outer, parts[pi].outer),
            userEntry: k === 0 && hints.userEntry,
            userExit: last && hints.userExit,
          },
          ctx,
        );
        const n = run.flags.length;
        if (!n) return;
        for (let i = 0; i < n; i++) {
          xy.push(run.xy[i * 2], run.xy[i * 2 + 1]);
          let f = run.flags[i];
          // The first point of every part after the first is reached by a jump between parts.
          if (i === 0 && flags.length) f = (f & ~F.STOP) | F.JUMP | F.TRIM;
          flags.push(f);
        }
        cur = [run.xy[n * 2 - 2], run.xy[n * 2 - 1]];
      });
      return { xy: Float64Array.from(xy), flags: Uint8Array.from(flags) };
    },
  };
}
