// SPDX-License-Identifier: GPL-3.0-or-later
/** Auto-digitizer thresholds (SPEC §9). All lengths in mm. */
export const AUTO = {
  /** Colours closer than this ΔE00 are merged. */
  mergeDeltaE: 5,
  /** Stroke width classes. */
  runningMaxWidth: 0.6,
  tripleMaxWidth: 1.2,
  maxSatinWidth: 7.0,
  /** Fill classes. */
  minDetail: 0.8,
  thinRunMinLength: 3,
  /** Fills narrower than this get no underlay. */
  noUnderlayBelow: 3,
  /** Angle snapping. */
  angleSnap: 15,
  neighbourAngleTolerance: 20,
  neighbourAngleRotate: 45,
  /** Overlap removal. */
  overlapMargin: 0.4,
  /** Leftovers smaller than this area (mm²) are dropped. */
  minLeftoverArea: 0.8 * 0.8,
  /** Precedence: overlaps smaller than this (mm²) are ignored. */
  precedenceMinOverlap: 0.5,
} as const;
