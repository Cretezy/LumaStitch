// SPDX-License-Identifier: GPL-3.0-or-later
/** Layout of the separately licensed, digitized Geneva Simple Sans font. */
import glyphData from './fonts/geneva-simple/glyphs.json';
import metadata from './fonts/geneva-simple/metadata.json';
import { flattenSubpath } from '@/geom/flatten';
import { compose, IDENTITY, rotateScreen, scale, translate } from '@/geom/matrix';
import { parsePathData } from '@/geom/pathData';
import { cumulativeLengths } from '@/geom/polyline';
import { columnFromRails } from '@/engine/stitches/satinColumn';
import { parseTransform } from '@/io/svg-import/tree';
import { createElement, createShape } from '@/model/factories';
import { geomBBox, transformGeomM } from '@/model/geomOps';
import type { LetteringOptions, Matrix, PathGeom, Shape, Subpath } from '@/model/types';

export const DEFAULT_LETTERING: LetteringOptions = {
  font: 'geneva-simple',
  text: 'LumaStitch',
  height: 10,
  letterSpacing: 0,
  wordSpacing: 0,
  lineSpacing: 1.2,
  align: 'left',
  arcAngle: 0,
  monogram: false,
};
type FontPath = { d: string; transforms: string[]; satin: boolean; underlay: string; pull: number };
const glyphs: Record<string, FontPath[]> = glyphData;
const advances: Record<string, number> = metadata.horiz_adv_x;
const kern: Record<string, number> = metadata.kerning_pairs;
// SVG guide positions, in the pinned source's 90×90 user coordinate system.
const BASELINE = 90 - 27.2685;
const CAP_HEIGHT = 62.9405 - 27.2685;

function intersects(a: Float64Array, b: Float64Array): boolean {
  for (let i = 0; i + 3 < a.length; i += 2)
    for (let j = 0; j + 3 < b.length; j += 2) {
      const dx = a[i + 2] - a[i],
        dy = a[i + 3] - a[i + 1];
      const ex = b[j + 2] - b[j],
        ey = b[j + 3] - b[j + 1];
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-10) continue;
      const px = b[j] - a[i],
        py = b[j + 1] - a[i + 1];
      const t = (px * ey - py * ex) / den,
        u = (px * dy - py * dx) / den;
      if (t >= -1e-6 && t <= 1 + 1e-6 && u >= -1e-6 && u <= 1 + 1e-6) return true;
    }
  return false;
}

function reverse(sp: Subpath): Subpath {
  return {
    ...sp,
    nodes: sp.nodes
      .slice()
      .reverse()
      .map((n) => ({ ...n, in: n.out, out: n.in })),
  };
}

/** Font SVGs can interleave rails and rungs; identify rails by their shared rung intersections. */
export function normalizeRails(g: PathGeom): PathGeom {
  const flat = g.subpaths.map((sp) => flattenSubpath(sp, 0.05));
  if (flat.length < 2) throw new Error('Digitized satin requires two rails.');
  let best: [number, number] = [0, 1],
    score = -Infinity;
  for (let i = 0; i < flat.length; i++)
    for (let j = i + 1; j < flat.length; j++) {
      let count = 0;
      for (let k = 0; k < flat.length; k++)
        if (k !== i && k !== j && intersects(flat[i], flat[k]) && intersects(flat[j], flat[k])) count++;
      const length = (cumulativeLengths(flat[i]).at(-1) ?? 0) + (cumulativeLengths(flat[j]).at(-1) ?? 0);
      const value = count * 1e6 + length;
      if (value > score) {
        score = value;
        best = [i, j];
      }
    }
  const [i, j] = best;
  const a = g.subpaths[i];
  let b = g.subpaths[j];
  const dist = (p: number[], q: number[]) => Math.hypot(p[0] - q[0], p[1] - q[1]);
  const a0 = a.nodes[0].p,
    a1 = a.nodes.at(-1)!.p,
    b0 = b.nodes[0].p,
    b1 = b.nodes.at(-1)!.p;
  if (dist(a0, b1) + dist(a1, b0) < dist(a0, b0) + dist(a1, b1)) b = reverse(b);
  const r = g.subpaths.filter((_, k) => k !== i && k !== j);
  const rungs = r.map(
    (sp) =>
      [sp.nodes[0].p, sp.nodes.at(-1)!.p] as [import('@/model/types').Vec2, import('@/model/types').Vec2],
  );
  try {
    columnFromRails(flattenSubpath(a, 0.05), flattenSubpath(b, 0.05), rungs);
  } catch {
    b = reverse(b);
    columnFromRails(flattenSubpath(a, 0.05), flattenSubpath(b, 0.05), rungs);
  }
  return { ...g, subpaths: [a, b, ...r] };
}

const cache = new Map<string, { geom: PathGeom; source: FontPath }[]>();
function glyph(char: string) {
  let value = cache.get(char);
  if (value) return value;
  value = glyphs[char].map((source) => {
    const m = compose(...source.transforms.map((s) => parseTransform(s) ?? IDENTITY));
    let geom = transformGeomM(parsePathData(source.d), m);
    if (source.satin) geom = normalizeRails(geom);
    return { geom, source };
  });
  const minX = Math.min(...value.map((p) => geomBBox(p.geom).minX));
  value = value.map((p) => ({ ...p, geom: transformGeomM(p.geom, translate(-minX, -BASELINE)) }));
  cache.set(char, value);
  return value;
}

export function validateLettering(o: LetteringOptions): void {
  if (o.font !== 'geneva-simple') throw new Error('Unknown embroidery font.');
  if (!o.text.trim() || o.text.length > 1000) throw new Error('Enter between 1 and 1,000 characters.');
  for (const [key, min, max] of [
    ['height', 10, 20],
    ['letterSpacing', -5, 20],
    ['wordSpacing', 0, 30],
    ['lineSpacing', 1, 4],
    ['arcAngle', -300, 300],
  ] as const)
    if (!Number.isFinite(o[key]) || o[key] < min || o[key] > max)
      throw new Error(`${key} must be between ${min} and ${max}.`);
  const missing = [
    ...new Set([...o.text.normalize('NFC')].filter((c) => c !== ' ' && c !== '\n' && !glyphs[c])),
  ];
  if (missing.length) throw new Error(`This font has no glyph for: ${missing.join(' ')}.`);
  if (o.monogram && (!/^[^\s]{3}$/u.test(o.text) || [...o.text].length !== 3))
    throw new Error('A monogram needs exactly three characters, entered in sewing order.');
  if (o.monogram && o.height < 10 / 0.75)
    throw new Error(
      'Monograms need a capital height of at least 13.34 mm to keep the smaller initials within the font range.',
    );
  if (o.arcAngle && o.text.includes('\n')) throw new Error('Curved lettering uses one line.');
}

export function layoutLettering(
  options: LetteringOptions,
  threadId: string,
  color: string,
  matrix: Matrix = IDENTITY,
): Shape[] {
  validateLettering(options);
  const o = { ...options, text: options.text.normalize('NFC') };
  const unit = o.height / CAP_HEIGHT;
  const shapes: Shape[] = [];
  for (const [lineIndex, line] of o.text.split('\n').entries()) {
    const letters: { char: string; x: number; factor: number; advance: number }[] = [];
    let x = 0,
      previous = '';
    for (const [index, char] of [...line].entries()) {
      const factor = o.monogram && index !== 1 ? 0.75 : 1;
      if (index) x += o.letterSpacing - (kern[`${previous} ${char}`] ?? 0) * unit * factor;
      const advance =
        (char === ' ' ? metadata.horiz_adv_x_space : (advances[char] ?? metadata.horiz_adv_x_default)) *
          unit *
          factor +
        (char === ' ' ? o.wordSpacing : 0);
      letters.push({ char, x, factor, advance });
      x += advance;
      previous = char;
    }
    const offset = o.align === 'center' ? -x / 2 : o.align === 'right' ? -x : 0;
    const angle = (o.arcAngle * Math.PI) / 180;
    const radius = angle ? x / angle : 0;
    for (const letter of letters) {
      if (letter.char === ' ') continue;
      const center = letter.x + letter.advance / 2;
      let placement: Matrix;
      if (angle) {
        const t = (center / x - 0.5) * angle;
        placement = compose(
          translate(radius * Math.sin(t), radius * (1 - Math.cos(t))),
          rotateScreen((-t * 180) / Math.PI),
          translate(-letter.advance / 2, 0),
        );
      } else placement = translate(letter.x + offset, lineIndex * metadata.leading * unit * o.lineSpacing);
      const m = compose(matrix, placement, scale(unit * letter.factor));
      for (const part of glyph(letter.char)) {
        const s = createShape(`Letter ${letter.char}`, transformGeomM(part.geom, m), {
          stroke: color,
          strokeWidth: 0.15,
        });
        s.outline = createElement(
          'outline',
          part.source.satin ? 'satinColumn' : 'running',
          threadId,
          part.source.satin
            ? { underlay: part.source.underlay, pullComp: part.source.pull }
            : { stitchLength: 2 },
        );
        shapes.push(s);
      }
    }
  }
  return shapes;
}

export const FONT_CHARACTERS = Object.keys(glyphs).join('');
