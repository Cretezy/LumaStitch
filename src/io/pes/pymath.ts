// SPDX-License-Identifier: GPL-3.0-or-later
// Python numeric semantics needed for byte-identical output with pyembroidery
// (pyembroidery, MIT License, Copyright (c) 2018 Tatarize).

/** Python 3 `round(x)` for floats: round half to even. Returns +0 rather than -0. */
export function pyRound(x: number): number {
  const f = Math.floor(x);
  const diff = x - f;
  let r: number;
  if (diff < 0.5) r = f;
  else if (diff > 0.5) r = f + 1;
  else r = f % 2 === 0 ? f : f + 1;
  return r === 0 ? 0 : r;
}

/** Python `int(x)` for floats: truncate toward zero. Returns +0 rather than -0. */
export function pyInt(x: number): number {
  const r = Math.trunc(x);
  return r === 0 ? 0 : r;
}
