// SPDX-License-Identifier: GPL-3.0-or-later
import { newId } from '@/lib/ids';
import type {
  Design,
  DesignSettings,
  ElementRole,
  FabricId,
  Id,
  PathGeom,
  Shape,
  StitchElement,
  StitchType,
  Thread,
  ArtPaint,
} from './types';

export const DEFAULT_SETTINGS: DesignSettings = {
  trimThreshold: 3.0,
  minStitchLength: 0.3,
  maxStitchLength: 12.0,
  tieLength: 0.8,
  machineSpm: 600,
  trimSeconds: 6,
  colorChangeSeconds: 30,
  defaultTie: 'auto',
  scaleStrokeWidths: true,
};

export function createDesign(opts: { name?: string; fabric?: FabricId } = {}): Design {
  return {
    schemaVersion: 1,
    name: opts.name ?? 'Untitled',
    fabric: opts.fabric ?? 'woven',
    threadChart: 'exact',
    settings: { ...DEFAULT_SETTINGS },
    threads: {},
    shapes: {},
    zOrder: [],
    sequence: [],
  };
}

export function createElement(
  role: ElementRole,
  type: StitchType,
  threadId: Id,
  params: StitchElement['params'] = {},
): StitchElement {
  return {
    id: newId('e'),
    role,
    type,
    threadId,
    params,
    tieIn: 'auto',
    tieOut: 'auto',
    trimAfter: 'auto',
  };
}

export function createThread(color: string, name?: string, extra: Partial<Thread> = {}): Thread {
  return { id: newId('t'), name: name ?? color.toUpperCase(), color, ...extra };
}

export function hasClosedSubpath(geom: PathGeom): boolean {
  return geom.subpaths.some(
    (s) => s.closed && (s.nodes.length >= 3 || (s.nodes.length === 2 && s.nodes.some((n) => n.in || n.out))),
  );
}

export function createShape(name: string, geom: PathGeom, art: ArtPaint = {}): Shape {
  return { id: newId('s'), name, geom, art, fill: null, outline: null };
}

/** Elements of a shape in fill → outline order. */
export function shapeElements(shape: Shape): StitchElement[] {
  const out: StitchElement[] = [];
  if (shape.fill) out.push(shape.fill);
  if (shape.outline) out.push(shape.outline);
  return out;
}

export interface ElementRef {
  shapeId: Id;
  role: ElementRole;
}

/** elementId → { shapeId, role } */
export function buildElementIndex(design: Design): Map<Id, ElementRef> {
  const m = new Map<Id, ElementRef>();
  for (const id of Object.keys(design.shapes)) {
    const s = design.shapes[id];
    if (s.fill) m.set(s.fill.id, { shapeId: id, role: 'fill' });
    if (s.outline) m.set(s.outline.id, { shapeId: id, role: 'outline' });
  }
  return m;
}

export function getElement(design: Design, ref: ElementRef | undefined): StitchElement | null {
  if (!ref) return null;
  const s = design.shapes[ref.shapeId];
  if (!s) return null;
  return ref.role === 'fill' ? s.fill : s.outline;
}
