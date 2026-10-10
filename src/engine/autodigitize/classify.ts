// SPDX-License-Identifier: GPL-3.0-or-later
/** Auto-digitizer analysis (SPEC §9 steps 4–6): classify strokes and fills, choose angles. */
import { makeValid, intersection, offset } from '@/geom/clipper';
import { flattenGeom } from '@/geom/flatten';
import { medialAxis } from '@/geom/medialAxis';
import { bboxIntersects, minAreaRect, polyShapeArea, polyShapeBBox } from '@/geom/polygon';
import { simplifyDP } from '@/geom/polyline';
import type { PolyShape } from '@/geom/types';
import type { ParamValue, PathGeom, StitchType, Vec2 } from '@/model/types';
import { AUTO } from './config';

export interface AnalyzeShapeInput {
  id: string;
  geom: PathGeom;
  /** Stroke width in mm if the shape has a visible stroke. */
  strokeWidth?: number;
  hasFill: boolean;
  hasStroke: boolean;
}

export interface ElementDecision {
  type: StitchType;
  params: Record<string, ParamValue>;
}

export interface ShapeDecision {
  id: string;
  fill: ElementDecision | null;
  outline: ElementDecision | null;
  /**
   * The fill is too thin for a fill: sew a running stitch along this open centreline instead.
   * `outline` still describes the shape's own stroke (if any).
   */
  centerline?: PathGeom;
  /** Fill dropped as too small. */
  droppedFill?: boolean;
  maxWidth?: number;
  area?: number;
}

export interface AnalyzeOptions {
  minDetail?: number;
  maxSatinWidth?: number;
  /** Outline handling: 'auto' (by stroke width), 'running', 'satin', 'none'. */
  outlines?: 'auto' | 'running' | 'triple' | 'satin' | 'none';
}

export interface AnalyzeResult {
  decisions: ShapeDecision[];
}

function snapAngle(a: number, step: number): number {
  const s = Math.round(a / step) * step;
  return ((s % 180) + 180) % 180;
}

function angleDiff(a: number, b: number): number {
  const d = Math.abs((((a - b) % 180) + 180) % 180);
  return Math.min(d, 180 - d);
}

/** Outline stitch type from stroke width (SPEC §9 step 4). Returns null when w > max satin (convert to fill). */
export function classifyStroke(w: number, maxSatin: number = AUTO.maxSatinWidth): ElementDecision | null {
  if (w < AUTO.runningMaxWidth) return { type: 'running', params: {} };
  if (w < AUTO.tripleMaxWidth) return { type: 'triple', params: {} };
  if (w <= maxSatin) return { type: 'satin', params: { width: Math.round(w * 100) / 100 } };
  return null;
}

function centerlineGeom(info: ReturnType<typeof medialAxis>): PathGeom | null {
  const sk = info.skeleton;
  if (info.diameter.length < 2) return null;
  const pts = new Float64Array(info.diameter.length * 2);
  info.diameter.forEach((n, i) => {
    pts[i * 2] = sk.x[n];
    pts[i * 2 + 1] = sk.y[n];
  });
  const simp = simplifyDP(pts, 0.05);
  const nodes = [];
  for (let i = 0; i < simp.length; i += 2) nodes.push({ p: [simp[i], simp[i + 1]] as Vec2 });
  return { fillRule: 'nonzero', subpaths: [{ closed: false, nodes }] };
}

export function analyzeShapes(shapes: AnalyzeShapeInput[], opts: AnalyzeOptions = {}): AnalyzeResult {
  const minDetail = opts.minDetail ?? AUTO.minDetail;
  const maxSatin = opts.maxSatinWidth ?? AUTO.maxSatinWidth;
  const decisions: ShapeDecision[] = [];
  const tatamis: { idx: number; poly: PolyShape; angle: number }[] = [];

  for (const s of shapes) {
    const d: ShapeDecision = { id: s.id, fill: null, outline: null };
    if (s.hasStroke && s.strokeWidth && opts.outlines !== 'none') {
      const w = s.strokeWidth;
      if (opts.outlines === 'running') d.outline = { type: 'running', params: {} };
      else if (opts.outlines === 'triple') d.outline = { type: 'triple', params: {} };
      else if (opts.outlines === 'satin')
        d.outline = { type: 'satin', params: { width: Math.max(1, Math.min(maxSatin, w)) } };
      else d.outline = classifyStroke(w, maxSatin);
    }
    if (s.hasFill) {
      const poly = makeValid(flattenGeom(s.geom).rings, s.geom.fillRule);
      const area = polyShapeArea(poly);
      d.area = area;
      if (area <= 1e-6) {
        d.droppedFill = true;
      } else {
        const holes = poly.reduce((n, p) => n + p.holes.length, 0);
        const med = medialAxis(poly);
        const maxW = med.maxWidth;
        d.maxWidth = maxW;
        if (maxW < minDetail) {
          if (med.diameterLength + maxW > AUTO.thinRunMinLength && poly.length === 1) {
            const cl = centerlineGeom(med);
            if (cl) d.centerline = cl;
            else d.droppedFill = true;
          } else d.droppedFill = true;
        } else if (maxW <= maxSatin && holes === 0 && med.branches === 0 && poly.length === 1) {
          d.fill = { type: 'satinFill', params: {} };
        } else {
          const pts: number[] = [];
          for (const p of poly) for (let i = 0; i < p.outer.length; i++) pts.push(p.outer[i]);
          const rect = minAreaRect(pts);
          const angle = snapAngle(rect.angle, AUTO.angleSnap);
          const params: Record<string, ParamValue> = { angle };
          if (maxW < AUTO.noUnderlayBelow) params.underlay = 'none';
          d.fill = { type: 'tatami', params };
          tatamis.push({ idx: decisions.length, poly, angle });
        }
      }
    }
    decisions.push(d);
  }

  // Neighbour rule: if an overlapping or touching fill has an angle within 20°, rotate by 45°.
  for (let i = 0; i < tatamis.length; i++) {
    const a = tatamis[i];
    const ba = polyShapeBBox(a.poly);
    for (let j = 0; j < i; j++) {
      const b = tatamis[j];
      const bb = polyShapeBBox(b.poly);
      if (!bboxIntersects(ba, bb, 0.2)) continue;
      const curA = decisions[a.idx].fill!.params.angle as number;
      const curB = decisions[b.idx].fill!.params.angle as number;
      if (angleDiff(curA, curB) >= AUTO.neighbourAngleTolerance) continue;
      const touching = intersection(offset(a.poly, 0.2), b.poly).length > 0;
      if (!touching) continue;
      decisions[a.idx].fill!.params.angle = snapAngle(curA + AUTO.neighbourAngleRotate, 1);
    }
  }
  return { decisions };
}
