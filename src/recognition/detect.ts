// SPDX-License-Identifier: GPL-3.0-or-later
/** Conservative, bounded pattern recognition. These are inferred objects, not recovered originals. */
import { compound, polylineGeom } from '@/geom/shapes';
import { columnFromRails } from '@/engine/stitches/satinColumn';
import type { Node, PathGeom, StitchElement, Vec2 } from '@/model/types';

export interface Detection {
  start: number;
  end: number;
  type: 'satinColumn' | 'tatami';
  geom: PathGeom;
  params: StitchElement['params'];
  guides?: [Vec2, Vec2][];
}
const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const norm = (a: Vec2) => Math.hypot(...a);
const dot = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1];
const median = (a: number[]) => a.sort((x, y) => x - y)[Math.floor(a.length / 2)];

// A pair of alternating long cross-column stitches, with short forward steps on both rails.
function zigzag(p: Vec2[], i: number) {
  const u = sub(p[i + 1], p[i]),
    v = sub(p[i + 2], p[i + 1]);
  const a = norm(u),
    b = norm(v),
    step = norm(sub(p[i + 2], p[i]));
  return (
    a >= 1.2 &&
    a <= 12 &&
    b >= 1.2 &&
    b <= 12 &&
    dot(u, v) / (a * b) < -0.8 &&
    step >= 0.12 &&
    step <= 1.5 &&
    step < Math.min(a, b) * 0.45
  );
}

function satin(p: Vec2[], start: number, end: number): Detection | null {
  const pairs = Math.floor((end - start) / 2);
  if (pairs < 10) return null;
  const aa: Vec2[] = [],
    bb: Vec2[] = [],
    centers: Vec2[] = [];
  for (let k = 0; k < pairs; k++) {
    const a = p[start + 2 * k],
      b = p[start + 2 * k + 1];
    aa.push(a);
    bb.push(b);
    centers.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
  }
  const steps = centers.slice(1).map((c, i) => norm(sub(c, centers[i])));
  const density = median([...steps]);
  if (
    density < 0.2 ||
    density > 1.2 ||
    steps.some((s) => Math.abs(s - density) > Math.max(0.14, density * 0.35))
  )
    return null;
  for (let k = 2; k < centers.length; k++) {
    const u = sub(centers[k - 1], centers[k - 2]),
      v = sub(centers[k], centers[k - 1]);
    if (dot(u, v) < 0.5 * norm(u) * norm(v)) return null;
  }
  // Jointly sample rails: preserve correspondence, refuse if a bounded set cannot describe them.
  const stride = Math.max(1, Math.ceil((pairs - 1) / 127));
  const indices = [0];
  for (let k = stride; k < pairs - 1; k += stride) indices.push(k);
  indices.push(pairs - 1);
  for (let k = 1; k < indices.length; k++) {
    const a = indices[k - 1],
      b = indices[k];
    for (let j = a + 1; j < b; j++)
      for (const rail of [aa, bb]) {
        const t = (j - a) / (b - a);
        if (
          Math.hypot(
            rail[j][0] - rail[a][0] - t * (rail[b][0] - rail[a][0]),
            rail[j][1] - rail[a][1] - t * (rail[b][1] - rail[a][1]),
          ) > 0.1
        )
          return null;
      }
  }
  const a = indices.map((i) => aa[i]),
    b = indices.map((i) => bb[i]);
  const guides: [Vec2, Vec2][] = a.slice(1, -1).map((p, i) => [p, b[i + 1]]);
  try {
    columnFromRails(Float64Array.from(a.flat()), Float64Array.from(b.flat()), guides);
  } catch {
    return null;
  }
  return {
    start,
    end: start + pairs * 2,
    type: 'satinColumn',
    geom: compound([polylineGeom(a), polylineGeom(b)]),
    guides,
    params: { density, pullComp: 0, underlay: 'none', splitAbove: 0, shortStitches: false },
  };
}

/** Whole contiguous blocks only: regularly spaced, serpentine rows with no holes or long turns. */
function tatami(p: Vec2[]): Detection | null {
  if (p.length < 24) return null;
  const bins = new Float64Array(36);
  const segments = p.slice(1).map((v, i) => sub(v, p[i]));
  for (const v of segments) {
    const l = norm(v);
    if (l >= 1 && l <= 12) bins[Math.round(((Math.atan2(v[1], v[0]) + Math.PI) * 36) / Math.PI) % 36] += l;
  }
  let best = 0;
  for (let i = 1; i < bins.length; i++) if (bins[i] > bins[best]) best = i;
  if (!bins[best]) return null;
  const rough = (best * Math.PI) / 36;
  let xx = 0,
    yy = 0;
  for (const v of segments) {
    const l = norm(v),
      angle = Math.atan2(v[1], v[0]);
    if (l >= 1 && l <= 12 && Math.abs(Math.cos(angle - rough)) > 0.995) {
      xx += Math.cos(2 * angle) * l;
      yy += Math.sin(2 * angle) * l;
    }
  }
  const angle = (Math.atan2(yy, xx) / 2 + Math.PI) % Math.PI,
    c = Math.cos(angle),
    s = Math.sin(angle);
  const points = p.map(([x, y]) => [x * c + y * s, -x * s + y * c] as Vec2);
  const rows: { points: Vec2[]; y: number; lo: number; hi: number; dir: number }[] = [];
  for (const q of points) {
    const r = rows.at(-1);
    if (!r || Math.abs(q[1] - r.points[0][1]) > 0.14)
      rows.push({ points: [q], y: q[1], lo: q[0], hi: q[0], dir: 0 });
    else {
      r.points.push(q);
      r.lo = Math.min(r.lo, q[0]);
      r.hi = Math.max(r.hi, q[0]);
    }
  }
  if (rows.length < 6 || rows.length > 512) return null;
  const lengths: number[] = [];
  for (const r of rows) {
    if (r.points.length < 4 || r.hi - r.lo < 5 || r.hi - r.lo > 200) return null;
    r.y = r.points.reduce((a, p) => a + p[1], 0) / r.points.length;
    r.dir = Math.sign(r.points.at(-1)![0] - r.points[0][0]);
    for (let i = 1; i < r.points.length; i++) {
      const d = (r.points[i][0] - r.points[i - 1][0]) * r.dir;
      if (d < -0.05 || d > 12) return null;
      if (d > 0.5) lengths.push(d);
    }
  }
  const deltas = rows.slice(1).map((r, i) => r.y - rows[i].y);
  const delta = median([...deltas]),
    density = Math.abs(delta);
  if (
    density < 0.2 ||
    density > 1.2 ||
    deltas.some((d) => Math.sign(d) !== Math.sign(delta) || Math.abs(d - delta) > 0.14)
  )
    return null;
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1],
      b = rows[i];
    if (
      a.dir === b.dir ||
      Math.abs(a.lo - b.lo) > 2 * density + 0.15 ||
      Math.abs(a.hi - b.hi) > 2 * density + 0.15
    )
      return null;
    if (norm(sub(a.points.at(-1)!, b.points[0])) > 3 * density + 0.2) return null;
  }
  const world = (x: number, y: number): Vec2 => [x * c - y * s, x * s + y * c];
  // Half-row extension estimates the unsampled edge. Never infer underlay or undo unknown pull.
  const edgeY = (i: number) => rows[i].y + (i === 0 ? -delta / 2 : i === rows.length - 1 ? delta / 2 : 0);
  const left = rows.map((r, i) => world(r.lo, edgeY(i))),
    right = rows.map((r, i) => world(r.hi, edgeY(i)));
  return {
    start: 0,
    end: p.length,
    type: 'tatami',
    geom: polylineGeom([...left, ...right.reverse()], true),
    params: {
      angle: (angle * 180) / Math.PI,
      density,
      stitchLength: median(lengths),
      offset: 0.25,
      pullComp: 0,
      underlay: 'none',
      cutoutGrowth: 0,
    },
  };
}

export function detectStitches(nodes: Node[]): Detection[] {
  const result: Detection[] = [];
  // Command boundaries are absolute; never bridge a jump, trim or stop during inference.
  let start = 0;
  while (start < nodes.length) {
    if (nodes[start].command) {
      start++;
      continue;
    }
    let end = start + 1;
    while (end < nodes.length && !nodes[end].command) end++;
    const p = nodes.slice(start, end).map((n) => n.p);
    let fill = tatami(p);
    // Small entry travel / tie sequences commonly bracket a complete fill. Keep them manual.
    // Bounded retries avoid searching every possible interval in a large stitch stream.
    for (let removed = 1; !fill && removed <= 8; removed++) {
      for (let lead = 0; !fill && lead <= removed; lead++) {
        const tail = removed - lead;
        const candidate = tatami(p.slice(lead, p.length - tail));
        if (candidate) fill = { ...candidate, start: lead, end: p.length - tail };
      }
    }
    if (fill) result.push({ ...fill, start: start + fill.start, end: start + fill.end });
    else {
      let i = 0;
      while (i + 2 < p.length) {
        if (!zigzag(p, i)) {
          i++;
          continue;
        }
        let j = i + 1;
        while (j + 2 < p.length && zigzag(p, j)) j++;
        const found = satin(p, i, j + 2);
        if (found) result.push({ ...found, start: start + found.start, end: start + found.end });
        i = j + 1;
      }
    }
    start = end;
  }
  return result;
}
