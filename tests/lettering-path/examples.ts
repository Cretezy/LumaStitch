// SPDX-License-Identifier: GPL-3.0-or-later
import { letteringBatch } from '@/lettering/batch';
import { DEFAULT_LETTERING } from '@/lettering/layout';
import { polylineGeom } from '@/geom/shapes';
import type { PathGeom } from '@/model/types';
export const curve: PathGeom = {
  fillRule: 'nonzero',
  subpaths: [
    {
      closed: false,
      nodes: [
        { p: [0, 20], out: [25, -20] },
        { p: [60, 20], in: [-20, -20], out: [20, 20] },
        { p: [120, 20], in: [-25, 20] },
      ],
    },
  ],
};
export function stitchExamples() {
  return [false, true].map((curved) => ({
    name: curved ? 'curve' : 'straight',
    optimize: false,
    design: letteringBatch(
      ['LumaStitch'],
      {
        ...DEFAULT_LETTERING,
        align: 'center',
        height: 12,
        baseline: curved
          ? curve
          : polylineGeom([
              [0, 20],
              [120, 20],
            ]),
      },
      '#315b8a',
    )[0],
  }));
}
