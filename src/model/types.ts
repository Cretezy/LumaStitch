// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * LumaStitch document model. Everything here is plain, serialisable JSON:
 * no class instances, all geometry in millimetres (+x right, +y down).
 */

export type Id = string;
/** A point or vector in mm. */
export type Vec2 = [x: number, y: number];
/** 2D affine matrix in SVG order: [a, b, c, d, e, f] → x' = a·x + c·y + e, y' = b·x + d·y + f. */
export type Matrix = [a: number, b: number, c: number, d: number, e: number, f: number];

/** Bézier node in the style of Paper.js segments. Handles are relative to `p`. */
export interface Node {
  p: Vec2;
  /** Machine command at this point in an imported manual stitch stream; omitted = needle down. */
  command?: 'jump' | 'trim' | 'stop';
  in?: Vec2;
  out?: Vec2;
  smooth?: boolean;
}
export interface Subpath {
  closed: boolean;
  nodes: Node[];
}
export interface PathGeom {
  subpaths: Subpath[];
  fillRule: 'nonzero' | 'evenodd';
}

export interface ArtPaint {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
}

export interface Shape {
  id: Id;
  name: string;
  /** Absolute mm, transforms baked in. */
  geom: PathGeom;
  hidden?: boolean;
  locked?: boolean;
  /** Original paint (artwork view, auto-digitize). */
  art: ArtPaint;
  /** Always null if the shape has no closed subpath. */
  fill: StitchElement | null;
  outline: StitchElement | null;
}

export type FillType =
  | 'tatami'
  | 'satinFill'
  | 'contour'
  | 'meander'
  | 'ripple'
  | 'guidedFill'
  | 'gradientFill'
  | 'patternFill'
  | 'crossStitch'
  | 'applique';
export type OutlineType =
  | 'running'
  | 'triple'
  | 'satin'
  | 'zigzag'
  | 'motifRun'
  | 'blanket'
  | 'manual'
  | 'satinColumn'
  | 'appliqueBorder';
export type StitchType = FillType | OutlineType;
export type ParamValue = number | boolean | string;
export type TieMode = 'auto' | 'on' | 'off';
export type TrimMode = 'auto' | 'always' | 'never';
export type ElementRole = 'fill' | 'outline';

export interface StitchElement {
  id: Id;
  role: ElementRole;
  type: StitchType;
  threadId: Id;
  /** Overrides only; effective values = type defaults ← fabric preset ← these. */
  params: Record<string, ParamValue>;
  /** User entry point; the engine snaps it to the geometry. */
  entry?: Vec2;
  /** User exit point. */
  exit?: Vec2;
  /** Satin direction lines (rungs); type-specific. */
  guides?: [Vec2, Vec2][];
  /** satinFill: outline parameters (0..1 of outer ring arc length) where the rails split. */
  railSplit?: [number, number];
  tieIn: TieMode;
  tieOut: TieMode;
  trimAfter: TrimMode;
  /** Consecutive subpath counts for grouped explicit satin columns (rails, then rungs). */
  satinGroups?: number[];
  /** Omitted source Bézier edges; topology prevents stale indices after node insertion/removal. */
  appliqueEdges?: { topology: string; omit: [number, number][] };
  /** Set on manual change; auto-digitize can skip. */
  userEdited?: boolean;
}

export interface Thread {
  id: Id;
  name: string;
  /** #rrggbb */
  color: string;
  chart?: string;
  code?: string;
}

export type SequenceEntry = { kind: 'element'; elementId: Id } | { kind: 'stop'; id: Id; note?: string };

export type FabricId = 'woven' | 'knit' | 'pile' | 'lightweight';

export interface DesignSettings {
  /** Same-colour connectors shorter than this (mm) are stitched; longer ones are trimmed. */
  trimThreshold: number;
  minStitchLength: number;
  maxStitchLength: number;
  tieLength: number;
  /** Stitches per minute, for time estimates and 1× simulation. */
  machineSpm: number;
  trimSeconds: number;
  colorChangeSeconds: number;
  /** Default tie behaviour used when an element's tie mode is 'auto'. */
  defaultTie: 'auto' | 'always' | 'never';
  /** Scale satin/stroke widths when shapes are resized. */
  scaleStrokeWidths: boolean;
}

export interface PaletteEdit {
  /** Index of the quantised colour this edit applies to. */
  index: number;
  /** Merge into another index. */
  mergeInto?: number;
  /** Replacement colour. */
  color?: string;
  /** Don't stitch this colour. */
  skip?: boolean;
}

export interface TraceSettings {
  colors: number | 'auto';
  palette: PaletteEdit[];
  /** 'auto' = detect from border/transparency, 'none' = stitch everything, or a #rrggbb colour. */
  background: 'auto' | 'none' | string;
  /** 0..1, higher = keep finer detail. */
  detail: number;
  /** 0..1, higher = smoother curves. */
  smoothness: number;
  lineArt: boolean;
}

export type Artwork = { matrix: Matrix; visible: boolean; opacity: number } & (
  | { kind: 'svg'; svg: string }
  | { kind: 'image'; dataUrl: string; pxWidth: number; pxHeight: number; trace: TraceSettings }
);

/** Embedded original font and reusable shaped outlines; no installed font dependency. */
export interface OpenTypeLettering {
  axes?: { tag: string; min: number; max: number; default: number }[];
  license?: string;
  name: string;
  data: string;
  direction: 'auto' | 'ltr' | 'rtl';
  language: string;
  variations: Record<string, number>;
  stitch: 'tatami' | 'satinFill';
  prepared?: {
    key: string;
    upem: number;
    leading: number;
    lines: {
      advance: number;
      glyphs: { id: number; cluster: number; x: number; y: number; path: string }[];
    }[];
  };
}

export interface LetteringOptions {
  font: 'geneva-simple' | 'geneva-rounded' | 'chopin' | 'opentype';
  openType?: OpenTypeLettering;
  text: string;
  /** Digitized cap height (10–20 mm) or OpenType em size (5–100 mm). */
  height: number;
  letterSpacing: number;
  wordSpacing: number;
  lineSpacing: number;
  align: 'left' | 'center' | 'right';
  arcAngle: number;
  /** Editable baseline in lettering-local coordinates; replaces the circular arc. */
  baseline?: PathGeom;
  baselineOffset?: number;
  baselineReverse?: boolean;
  monogram: boolean;
}

export interface LetteringGroup {
  baselineShapeId?: Id;
  options: LetteringOptions;
  shapeIds: Id[];
  matrix: Matrix;
}

export interface FabricProfile {
  name: string;
  baseFabric: FabricId;
  fillSpacing: number;
  satinSpacing: number;
  pullComp: number;
  fillUnderlay: 'none' | 'edge' | 'tatami' | 'edgeTatami';
  satinUnderlay:
    'auto' | 'none' | 'center' | 'edge' | 'zigzag' | 'centerZigzag' | 'edgeZigzag' | 'centerEdge';
  underlaySpacing: number;
  stabilizer: string;
  needle: string;
  thread: string;
  notes: string;
}

export interface AppliqueCutOptions {
  allowance: number;
  mirror: boolean;
  sheetWidth: number;
}

export interface MultiHoopOptions {
  width: number;
  height: number;
  margin: number;
  overlap: number;
  joinSeams?: boolean;
  keepObjects?: boolean;
  /** Explicit field centers in design millimetres and clockwise rotation in degrees. */
  placements?: { center: Vec2; angle: number }[];
}

export interface Design {
  schemaVersion: 1;
  name: string;
  fabric: FabricId;
  /** Portable calibration defaults; explicit element overrides still take precedence. */
  fabricProfile?: FabricProfile;
  /** Colour of the fabric (canvas background, exports on fabric); default DEFAULT_FABRIC_COLOR. */
  fabricColor?: string;
  threadChart: string;
  settings: DesignSettings;
  threads: Record<Id, Thread>;
  shapes: Record<Id, Shape>;
  /** Artwork stacking, bottom → top. */
  zOrder: Id[];
  /** Sewing order. */
  sequence: SequenceEntry[];
  artwork?: Artwork;
  lettering?: Record<Id, LetteringGroup>;
  /** Optional usable sewing field, centered on stitch bounds (not the outside hoop dimensions). */
  hoop?: Hoop;
  multiHoop?: MultiHoopOptions;
  appliqueCut?: AppliqueCutOptions;
}

export interface Hoop {
  width: number;
  height: number;
  margin: number;
  shape: 'rectangle' | 'ellipse';
}

export const CURRENT_SCHEMA_VERSION = 1 as const;

/** Fabric colour when a design doesn't set one: an off-white cotton. */
export const DEFAULT_FABRIC_COLOR = '#f5f3ef';

export function fabricColorOf(design: Pick<Design, 'fabricColor'> | null | undefined): string {
  return design?.fabricColor ?? DEFAULT_FABRIC_COLOR;
}
