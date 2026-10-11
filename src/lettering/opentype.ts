// SPDX-License-Identifier: GPL-3.0-or-later
/** Synchronous layout from worker-prepared HarfBuzz outlines. */
import type { LetteringOptions, Matrix, PathGeom, Vec2 } from '@/model/types';
import { createElement, createShape } from '@/model/factories';
import { transformGeomM } from '@/model/geomOps';
import { parsePathData } from '@/geom/pathData';
import { flattenSubpath } from '@/geom/flatten';
import { cumulativeLengths, pointAtLength } from '@/geom/polyline';
import { crc32 } from '@/library/zip';

let lastData = '',
  lastChecksum = 0;

export function shapingKey(o: LetteringOptions): string {
  const f = o.openType!;
  if (f.data !== lastData) {
    lastData = f.data;
    lastChecksum = crc32(new TextEncoder().encode(f.data));
  }
  return JSON.stringify([
    lastChecksum,
    o.text.normalize('NFC'),
    f.direction,
    f.language,
    Object.entries(f.variations).sort(),
    o.height,
    o.letterSpacing,
    o.wordSpacing,
  ]);
}

export function layoutOpenType(o: LetteringOptions, thread: string, color: string, matrix: Matrix) {
  const f = o.openType,
    prepared = f?.prepared;
  if (!f || !prepared || prepared.key !== shapingKey(o))
    throw new Error('Prepare this text with its font before laying it out.');
  const unit = o.height / prepared.upem;
  let baseline = o.baseline ? flattenSubpath(o.baseline.subpaths[0], 0.03) : undefined;
  if (baseline && o.baselineReverse) {
    const points = Array.from({ length: baseline.length / 2 }, (_, i) => [
      baseline![2 * i],
      baseline![2 * i + 1],
    ]).reverse();
    baseline = new Float64Array(points.flat());
  }
  const lengths = baseline ? cumulativeLengths(baseline) : undefined;
  const length = lengths?.at(-1) ?? 0;
  return prepared.lines.flatMap((line, index) => {
    const width = line.advance * unit;
    if (baseline && (!(width > 0) || width > length + 1e-6))
      throw new Error(`Text needs ${width.toFixed(1)} mm; the baseline provides ${length.toFixed(1)} mm.`);
    const offset =
      (o.align === 'center' ? 0.5 : o.align === 'right' ? 1 : 0) * (baseline ? length - width : -width);
    let geom: PathGeom = { fillRule: 'nonzero', subpaths: [] };
    for (const glyph of line.glyphs) {
      if (!glyph.path) continue;
      const g = transformGeomM(parsePathData(glyph.path), [
        unit,
        0,
        0,
        -unit,
        glyph.x * unit + offset,
        -glyph.y * unit + index * prepared.leading * unit * o.lineSpacing,
      ]);
      geom.subpaths.push(...g.subpaths);
    }
    if (!geom.subpaths.length) return [];
    if (baseline || o.arcAngle) {
      const angle = (o.arcAngle * Math.PI) / 180,
        radius = angle ? width / angle : 0;
      const bend = (x: number, y: number): Vec2 => {
        if (baseline && lengths) {
          const at = Math.max(0, Math.min(length, x));
          const p = pointAtLength(baseline, lengths, at);
          const a = pointAtLength(baseline, lengths, Math.max(0, at - 0.05));
          const b = pointAtLength(baseline, lengths, Math.min(length, at + 0.05));
          const theta = Math.atan2(b[1] - a[1], b[0] - a[0]),
            normal = y + (o.baselineOffset ?? 0);
          // Tangent extension keeps overhanging accents/sidebearings intact at endpoints.
          return [
            p[0] + Math.cos(theta) * (x - at) - Math.sin(theta) * normal,
            p[1] + Math.sin(theta) * (x - at) + Math.cos(theta) * normal,
          ];
        }
        const theta = ((x - offset) / width - 0.5) * angle;
        return [(radius - y) * Math.sin(theta), radius * (1 - Math.cos(theta)) + y * Math.cos(theta)];
      };
      geom = {
        fillRule: 'nonzero',
        subpaths: geom.subpaths.map((sp) => {
          const flat = flattenSubpath(sp, 0.03);
          return {
            closed: sp.closed,
            nodes: Array.from({ length: flat.length / 2 }, (_, i) => ({
              p: bend(flat[2 * i], flat[2 * i + 1]),
            })),
          };
        }),
      };
    }
    const shape = createShape(`Text ${o.text.split('\n')[index]}`, transformGeomM(geom, matrix), {
      fill: color,
    });
    shape.fill = createElement('fill', f.stitch, thread);
    return [shape];
  });
}
