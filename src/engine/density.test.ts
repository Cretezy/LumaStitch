// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, it } from 'vitest';
import { COMMAND_MASK, F } from './types';
import { penetrationDensity } from './density';

it('matches a brute-force circular neighborhood, including ties and underlay but excluding controls', () => {
  const x = Float32Array.from({ length: 301 }, (_, i) => Math.sin(i * 17) * 5);
  const y = Float32Array.from(x, (_, i) => Math.cos(i * 13) * 5);
  const flags = Uint8Array.from(
    x,
    (_, i) => [F.STITCH, F.TIE, F.UNDERLAY, F.JUMP, F.TRIM, F.COLOR_CHANGE, F.STOP][i % 7],
  );
  for (const radius of [0.5, 1, 2, 3]) {
    const got = penetrationDensity({ x, y, flags }, radius);
    const expected = Array.from(flags, (f, i) =>
      f & COMMAND_MASK
        ? 0
        : Array.from(flags).reduce(
            (n, g, j) =>
              n + (!(g & COMMAND_MASK) && (x[i] - x[j]) ** 2 + (y[i] - y[j]) ** 2 <= radius ** 2 ? 1 : 0),
            0,
          ),
    );
    expect([...got.counts]).toEqual(expected);
    expect(got.maximum).toBe(Math.max(...expected));
  }
});
it('counts 100,000 coincident penetrations without a quadratic duplicate scan', () => {
  const got = penetrationDensity({
    x: new Float32Array(100000),
    y: new Float32Array(100000),
    flags: new Uint8Array(100000),
  });
  expect(got.maximum).toBe(100000);
  expect(got.counts[99999]).toBe(100000);
});
