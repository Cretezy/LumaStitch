// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * SVG path data ⇄ PathGeom. Pure TypeScript (no DOM, no Paper.js).
 *
 * `parsePathData` supports the full SVG 1.1/2 path grammar: M/m L/l H/h V/v C/c S/s Q/q T/t A/a Z/z,
 * implicit command repeats, exponents and compact number forms ("1.5.5", "-1-2", arc flags "a1 1 0 00 1 1").
 * Quadratic curves and arcs are converted to cubics. Output nodes are Paper.js-style: handles are relative
 * to their anchor, and the closing segment's incoming handle sits on the first node's `in`.
 */
import type { Matrix, Node, PathGeom, Subpath, Vec2 } from '@/model/types';
import { apply, applyLinear } from '@/geom/matrix';

const CLOSE_EPS = 1e-9;
const HANDLE_EPS = 1e-12;

// ---------------------------------------------------------------------------------------------
// Tokeniser

const CMD_ARGS: Record<string, number> = {
  m: 2,
  l: 2,
  h: 1,
  v: 1,
  c: 6,
  s: 4,
  q: 4,
  t: 2,
  a: 7,
  z: 0,
};

class Scanner {
  i = 0;
  constructor(private readonly s: string) {}

  skipSeparators(): void {
    const s = this.s;
    while (this.i < s.length) {
      const c = s.charCodeAt(this.i);
      // whitespace or comma
      if (c === 32 || c === 9 || c === 10 || c === 13 || c === 12 || c === 44) this.i++;
      else break;
    }
  }

  atEnd(): boolean {
    this.skipSeparators();
    return this.i >= this.s.length;
  }

  peekIsNumberStart(): boolean {
    this.skipSeparators();
    const c = this.s[this.i];
    return c !== undefined && /[0-9+\-.]/.test(c);
  }

  readCommand(): string | null {
    this.skipSeparators();
    const c = this.s[this.i];
    if (c !== undefined && /[MmLlHhVvCcSsQqTtAaZz]/.test(c)) {
      this.i++;
      return c;
    }
    return null;
  }

  readNumber(): number {
    this.skipSeparators();
    const s = this.s;
    const start = this.i;
    let j = this.i;
    if (s[j] === '+' || s[j] === '-') j++;
    let digits = 0;
    while (j < s.length && s.charCodeAt(j) >= 48 && s.charCodeAt(j) <= 57) {
      j++;
      digits++;
    }
    if (s[j] === '.') {
      j++;
      while (j < s.length && s.charCodeAt(j) >= 48 && s.charCodeAt(j) <= 57) {
        j++;
        digits++;
      }
    }
    if (digits === 0) throw new SyntaxError(`Expected number at ${start} in path data`);
    if (s[j] === 'e' || s[j] === 'E') {
      let k = j + 1;
      if (s[k] === '+' || s[k] === '-') k++;
      let expDigits = 0;
      while (k < s.length && s.charCodeAt(k) >= 48 && s.charCodeAt(k) <= 57) {
        k++;
        expDigits++;
      }
      if (expDigits > 0) j = k;
    }
    this.i = j;
    return Number(s.slice(start, j));
  }

  /** Arc flags may be written without separators ("a1 1 0 01 1 1"). */
  readFlag(): number {
    this.skipSeparators();
    const c = this.s[this.i];
    if (c === '0' || c === '1') {
      this.i++;
      return c === '1' ? 1 : 0;
    }
    throw new SyntaxError(`Expected arc flag at ${this.i} in path data`);
  }
}

// ---------------------------------------------------------------------------------------------
// Builder

class GeomBuilder {
  subpaths: Subpath[] = [];
  private cur: Node[] | null = null;

  moveTo(p: Vec2): void {
    this.finish(false);
    this.cur = [{ p: [p[0], p[1]] }];
  }

  private ensure(from: Vec2): Node[] {
    if (!this.cur) this.cur = [{ p: [from[0], from[1]] }];
    return this.cur;
  }

  lineTo(from: Vec2, p: Vec2): void {
    this.ensure(from).push({ p: [p[0], p[1]] });
  }

  cubicTo(from: Vec2, c1: Vec2, c2: Vec2, p: Vec2): void {
    const nodes = this.ensure(from);
    const last = nodes[nodes.length - 1];
    setHandle(last, 'out', [c1[0] - last.p[0], c1[1] - last.p[1]]);
    const node: Node = { p: [p[0], p[1]] };
    setHandle(node, 'in', [c2[0] - p[0], c2[1] - p[1]]);
    nodes.push(node);
  }

  close(): void {
    this.finish(true);
  }

  finish(closed: boolean): void {
    const nodes = this.cur;
    this.cur = null;
    if (!nodes) return;
    if (closed && nodes.length > 1) {
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (Math.abs(first.p[0] - last.p[0]) <= CLOSE_EPS && Math.abs(first.p[1] - last.p[1]) <= CLOSE_EPS) {
        // The segment into the duplicate end node becomes the closing segment.
        if (last.in) first.in = last.in;
        else delete first.in;
        nodes.pop();
      }
    }
    if (nodes.length < 2) return;
    this.subpaths.push({ closed, nodes });
  }
}

function setHandle(node: Node, key: 'in' | 'out', h: Vec2): void {
  if (Math.abs(h[0]) > HANDLE_EPS || Math.abs(h[1]) > HANDLE_EPS) node[key] = h;
  else delete node[key];
}

// ---------------------------------------------------------------------------------------------
// Arc → cubic (SVG 1.1 implementation notes F.6.5 / F.6.6)

/** Returns cubic segments [c1, c2, end][] approximating the elliptical arc from p0 to p. */
export function arcToCubics(
  p0: Vec2,
  rxIn: number,
  ryIn: number,
  xAxisRotationDeg: number,
  largeArc: boolean,
  sweep: boolean,
  p: Vec2,
): [Vec2, Vec2, Vec2][] {
  const [x1, y1] = p0;
  const [x2, y2] = p;
  if (x1 === x2 && y1 === y2) return [];
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0) {
    // Degenerate: straight line as a cubic with collinear controls.
    return [
      [
        [x1, y1],
        [x2, y2],
        [x2, y2],
      ],
    ];
  }
  const phi = (xAxisRotationDeg * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cosPhi * dx + sinPhi * dy;
  const y1p = -sinPhi * dx + cosPhi * dy;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }
  const rx2 = rx * rx;
  const ry2 = ry * ry;
  const num = rx2 * ry2 - rx2 * y1p * y1p - ry2 * x1p * x1p;
  const den = rx2 * y1p * y1p + ry2 * x1p * x1p;
  let coef = den === 0 ? 0 : Math.sqrt(Math.max(0, num / den));
  if (largeArc === sweep) coef = -coef;
  const cxp = (coef * rx * y1p) / ry;
  const cyp = (-coef * ry * x1p) / rx;
  const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;

  const angle = (ux: number, uy: number, vx: number, vy: number) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const ux = (x1p - cxp) / rx;
  const uy = (y1p - cyp) / ry;
  const vx = (-x1p - cxp) / rx;
  const vy = (-y1p - cyp) / ry;
  const theta1 = angle(1, 0, ux, uy);
  let dTheta = angle(ux, uy, vx, vy);
  if (!sweep && dTheta > 0) dTheta -= 2 * Math.PI;
  else if (sweep && dTheta < 0) dTheta += 2 * Math.PI;

  const nSeg = Math.max(1, Math.ceil(Math.abs(dTheta) / (Math.PI / 2) - 1e-9));
  const delta = dTheta / nSeg;
  const k = (4 / 3) * Math.tan(delta / 4);
  const out: [Vec2, Vec2, Vec2][] = [];
  const pointAt = (t: number): Vec2 => {
    const ct = Math.cos(t);
    const st = Math.sin(t);
    return [cx + rx * ct * cosPhi - ry * st * sinPhi, cy + rx * ct * sinPhi + ry * st * cosPhi];
  };
  const derivAt = (t: number): Vec2 => {
    const ct = Math.cos(t);
    const st = Math.sin(t);
    return [-rx * st * cosPhi - ry * ct * sinPhi, -rx * st * sinPhi + ry * ct * cosPhi];
  };
  let t0 = theta1;
  let a = pointAt(t0);
  for (let i = 0; i < nSeg; i++) {
    const t1 = t0 + delta;
    const b = i === nSeg - 1 ? ([x2, y2] as Vec2) : pointAt(t1);
    const d0 = derivAt(t0);
    const d1 = derivAt(t1);
    out.push([[a[0] + k * d0[0], a[1] + k * d0[1]], [b[0] - k * d1[0], b[1] - k * d1[1]], b]);
    a = b;
    t0 = t1;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Parser

/** Parse SVG path data into a PathGeom (Paper-style nodes). Throws SyntaxError on malformed data. */
export function parsePathData(d: string, fillRule: PathGeom['fillRule'] = 'nonzero'): PathGeom {
  const sc = new Scanner(d);
  const b = new GeomBuilder();
  let cx = 0;
  let cy = 0;
  let sx = 0; // subpath start
  let sy = 0;
  // Reflection control points for S/T
  let lastCubicC2: Vec2 | null = null;
  let lastQuadC: Vec2 | null = null;
  let cmd: string | null = null;

  while (!sc.atEnd()) {
    const next = sc.readCommand();
    if (next) cmd = next;
    else if (!cmd) throw new SyntaxError('Path data must start with a command');
    else if (!sc.peekIsNumberStart()) throw new SyntaxError(`Unexpected character at ${sc.i}`);
    else if (cmd === 'z' || cmd === 'Z') throw new SyntaxError(`Unexpected number after Z at ${sc.i}`);

    const c = cmd as string;
    const lower = c.toLowerCase();
    const rel = c !== c.toUpperCase();
    if (lower === 'z') {
      b.close();
      cx = sx;
      cy = sy;
      lastCubicC2 = null;
      lastQuadC = null;
      continue;
    }
    // Read one argument group (implicit repeats loop around via `cmd` staying set).
    const argc = CMD_ARGS[lower];
    const args: number[] = [];
    for (let k = 0; k < argc; k++) {
      if (lower === 'a' && (k === 3 || k === 4)) args.push(sc.readFlag());
      else args.push(sc.readNumber());
    }
    const ox = rel ? cx : 0;
    const oy = rel ? cy : 0;
    const from: Vec2 = [cx, cy];
    let newCubicC2: Vec2 | null = null;
    let newQuadC: Vec2 | null = null;
    switch (lower) {
      case 'm': {
        cx = args[0] + ox;
        cy = args[1] + oy;
        sx = cx;
        sy = cy;
        b.moveTo([cx, cy]);
        // Subsequent implicit pairs are linetos.
        cmd = rel ? 'l' : 'L';
        break;
      }
      case 'l':
        cx = args[0] + ox;
        cy = args[1] + oy;
        b.lineTo(from, [cx, cy]);
        break;
      case 'h':
        cx = args[0] + ox;
        b.lineTo(from, [cx, cy]);
        break;
      case 'v':
        cy = args[0] + oy;
        b.lineTo(from, [cx, cy]);
        break;
      case 'c': {
        const c1: Vec2 = [args[0] + ox, args[1] + oy];
        const c2: Vec2 = [args[2] + ox, args[3] + oy];
        const p: Vec2 = [args[4] + ox, args[5] + oy];
        b.cubicTo(from, c1, c2, p);
        newCubicC2 = c2;
        cx = p[0];
        cy = p[1];
        break;
      }
      case 's': {
        const c1: Vec2 = lastCubicC2 ? [2 * cx - lastCubicC2[0], 2 * cy - lastCubicC2[1]] : [cx, cy];
        const c2: Vec2 = [args[0] + ox, args[1] + oy];
        const p: Vec2 = [args[2] + ox, args[3] + oy];
        b.cubicTo(from, c1, c2, p);
        newCubicC2 = c2;
        cx = p[0];
        cy = p[1];
        break;
      }
      case 'q': {
        const q: Vec2 = [args[0] + ox, args[1] + oy];
        const p: Vec2 = [args[2] + ox, args[3] + oy];
        quadTo(b, from, q, p);
        newQuadC = q;
        cx = p[0];
        cy = p[1];
        break;
      }
      case 't': {
        const q: Vec2 = lastQuadC ? [2 * cx - lastQuadC[0], 2 * cy - lastQuadC[1]] : [cx, cy];
        const p: Vec2 = [args[0] + ox, args[1] + oy];
        quadTo(b, from, q, p);
        newQuadC = q;
        cx = p[0];
        cy = p[1];
        break;
      }
      case 'a': {
        const p: Vec2 = [args[5] + ox, args[6] + oy];
        const segs = arcToCubics(from, args[0], args[1], args[2], args[3] === 1, args[4] === 1, p);
        let f = from;
        for (const [c1, c2, e] of segs) {
          b.cubicTo(f, c1, c2, e);
          f = e;
        }
        cx = p[0];
        cy = p[1];
        break;
      }
    }
    lastCubicC2 = newCubicC2;
    lastQuadC = newQuadC;
  }
  b.finish(false);
  return { subpaths: b.subpaths, fillRule };
}

function quadTo(b: GeomBuilder, p0: Vec2, q: Vec2, p: Vec2): void {
  const c1: Vec2 = [p0[0] + (2 / 3) * (q[0] - p0[0]), p0[1] + (2 / 3) * (q[1] - p0[1])];
  const c2: Vec2 = [p[0] + (2 / 3) * (q[0] - p[0]), p[1] + (2 / 3) * (q[1] - p[1])];
  b.cubicTo(p0, c1, c2, p);
}

// ---------------------------------------------------------------------------------------------
// Transform & serialise

/** Bake an affine matrix into anchors (full transform) and handles (linear part). */
export function transformGeom(geom: PathGeom, m: Matrix): PathGeom {
  return {
    fillRule: geom.fillRule,
    subpaths: geom.subpaths.map((sp) => ({
      closed: sp.closed,
      nodes: sp.nodes.map((n) => {
        const out: Node = { p: apply(m, n.p) };
        if (n.command) out.command = n.command;
        if (n.in) out.in = applyLinear(m, n.in);
        if (n.out) out.out = applyLinear(m, n.out);
        if (n.smooth !== undefined) out.smooth = n.smooth;
        return out;
      }),
    })),
  };
}

function fmt(v: number, precision: number): string {
  const f = Math.pow(10, precision);
  let r = Math.round(v * f) / f;
  if (Object.is(r, -0) || r === 0) r = 0;
  let s = r.toFixed(precision);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s === '-0' ? '0' : s;
}

function hasHandle(h: Vec2 | undefined): h is Vec2 {
  return !!h && (Math.abs(h[0]) > HANDLE_EPS || Math.abs(h[1]) > HANDLE_EPS);
}

/** Serialise to absolute SVG path data (M, L, C, Z). */
export function geomToPathData(geom: PathGeom, precision = 3): string {
  const parts: string[] = [];
  const pt = (p: Vec2) => `${fmt(p[0], precision)} ${fmt(p[1], precision)}`;
  const seg = (a: Node, bNode: Node) => {
    if (hasHandle(a.out) || hasHandle(bNode.in)) {
      const c1: Vec2 = a.out ? [a.p[0] + a.out[0], a.p[1] + a.out[1]] : a.p;
      const c2: Vec2 = bNode.in ? [bNode.p[0] + bNode.in[0], bNode.p[1] + bNode.in[1]] : bNode.p;
      parts.push(`C${pt(c1)} ${pt(c2)} ${pt(bNode.p)}`);
    } else {
      parts.push(`L${pt(bNode.p)}`);
    }
  };
  for (const sp of geom.subpaths) {
    const nodes = sp.nodes;
    if (nodes.length === 0) continue;
    parts.push(`M${pt(nodes[0].p)}`);
    for (let i = 1; i < nodes.length; i++) seg(nodes[i - 1], nodes[i]);
    if (sp.closed) {
      const last = nodes[nodes.length - 1];
      // A curved closing segment must be drawn explicitly; a straight one is implied by Z.
      if (hasHandle(last.out) || hasHandle(nodes[0].in)) seg(last, nodes[0]);
      parts.push('Z');
    }
  }
  return parts.join('');
}
