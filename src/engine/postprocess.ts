// SPDX-License-Identifier: GPL-3.0-or-later
/** Per-run cleanup: split long stitches, merge very short ones (ties exempt), drop duplicates. */
import type { DesignSettings } from '@/model/types';
import { segDist2 } from '@/geom/polygon';
import { F, type StitchRun } from './types';

export function postprocessRun(
  run: StitchRun,
  s: Pick<DesignSettings, 'minStitchLength' | 'maxStitchLength'>,
): StitchRun {
  const n = run.flags.length;
  if (n === 0) return run;
  const xy: number[] = [run.xy[0], run.xy[1]];
  const flags: number[] = [run.flags[0]];
  const maxL = Math.max(0.5, s.maxStitchLength);
  const minL = Math.max(0, s.minStitchLength);
  for (let i = 1; i < n; i++) {
    const x = run.xy[i * 2],
      y = run.xy[i * 2 + 1],
      f = run.flags[i];
    const k = flags.length;
    const px = xy[k * 2 - 2],
      py = xy[k * 2 - 1];
    const d = Math.hypot(x - px, y - py);
    if (f & F.JUMP) {
      xy.push(x, y);
      flags.push(f);
      continue;
    }
    if (d < 1e-6 && !(f & F.TIE)) continue;
    const isLast = i === n - 1;
    const nextIsJump = !isLast && run.flags[i + 1] & F.JUMP;
    if (d < minL && !(f & F.TIE) && !isLast && !nextIsJump && !(flags[k - 1] & F.JUMP)) {
      // Removing a row-turn corner would replace the next row with a diagonal. Only merge
      // points within 0.01 mm of the replacement segment, including its endpoints (so short
      // reversals are preserved too). The minimum length is subordinate to the sewn geometry.
      const [deviation2] = segDist2(x, y, px, py, run.xy[i * 2 + 2], run.xy[i * 2 + 3]);
      if (deviation2 <= 0.01 ** 2) continue;
    }
    if (d > maxL) {
      const m = Math.ceil(d / maxL);
      for (let j = 1; j < m; j++) {
        xy.push(px + ((x - px) * j) / m, py + ((y - py) * j) / m);
        flags.push(f);
      }
    }
    xy.push(x, y);
    flags.push(f);
  }
  return { xy: Float64Array.from(xy), flags: Uint8Array.from(flags) };
}
