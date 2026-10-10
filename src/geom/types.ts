// SPDX-License-Identifier: GPL-3.0-or-later
/** Flattened geometry used by the engine. All coordinates in mm. */

/** Interleaved x0,y0,x1,y1,…; implicitly closed. */
export type Ring = Float64Array;
/** Interleaved x0,y0,x1,y1,…; open. */
export type Polyline = Float64Array;

export interface Polygon {
  /** Positive shoelace area (Σ x_i·y_{i+1} − x_{i+1}·y_i > 0). */
  outer: Ring;
  /** Negative shoelace area. */
  holes: Ring[];
}
/** Multi-polygon with normalised orientation. */
export type PolyShape = Polygon[];

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const EPS = 1e-6;
/** Curve flattening chord tolerance in mm. */
export const FLATTEN_TOLERANCE = 0.05;
