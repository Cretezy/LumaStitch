// SPDX-License-Identifier: GPL-3.0-or-later
/** PathGeom → SVG path data, memoised by geometry object identity. */
import type { PathGeom } from '@/model/types';

const cache = new WeakMap<PathGeom, string>();
const r = (v: number) => Math.round(v * 1000) / 1000;

export function geomToD(g: PathGeom): string {
  let d = cache.get(g);
  if (d !== undefined) return d;
  const parts: string[] = [];
  for (const sp of g.subpaths) {
    const n = sp.nodes;
    if (!n.length) continue;
    parts.push(`M${r(n[0].p[0])} ${r(n[0].p[1])}`);
    const seg = (a: (typeof n)[0], b: (typeof n)[0]) => {
      if (a.out || b.in) {
        const c1 = [a.p[0] + (a.out?.[0] ?? 0), a.p[1] + (a.out?.[1] ?? 0)];
        const c2 = [b.p[0] + (b.in?.[0] ?? 0), b.p[1] + (b.in?.[1] ?? 0)];
        parts.push(`C${r(c1[0])} ${r(c1[1])} ${r(c2[0])} ${r(c2[1])} ${r(b.p[0])} ${r(b.p[1])}`);
      } else parts.push(`L${r(b.p[0])} ${r(b.p[1])}`);
    };
    for (let i = 1; i < n.length; i++) seg(n[i - 1], n[i]);
    if (sp.closed) {
      if (n.length > 1) seg(n[n.length - 1], n[0]);
      parts.push('Z');
    }
  }
  d = parts.join('');
  cache.set(g, d);
  return d;
}
