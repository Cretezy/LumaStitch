// SPDX-License-Identifier: GPL-3.0-or-later
// Public API of the PES codec (ported from pyembroidery, MIT, Copyright (c) 2018 Tatarize).
export {
  MC,
  MC_NAME,
  PES_MAX_JUMP,
  PES_MAX_STITCH,
  commandBounds,
  normalizeForPes,
  toMachineCommands,
  toUnits,
  type Bounds,
  type MachineCmd,
  type MachineCmdName,
  type MachineCommand,
  type MachineProgram,
  type NormalizedPes,
} from './machineCommands';
export {
  PEC_PALETTE,
  PEC_PALETTE_SIZE,
  buildUniquePalette,
  colorDistanceRedMean,
  nearestPecIndex,
  nearestPecIndexBy,
  nearestPecIndexRedMean,
  cpythonSetOrder,
  findNearestIndex,
  metricOf,
  type ColorMatch,
  type ColorMetric,
  type PaletteThread,
  type PecThread,
} from './pecPalette';
export { pecLabel, writePec, type PecColorInfo, type PecInput } from './pecEncoder';
export { PEC_ICON_BYTES, PEC_ICON_HEIGHT, PEC_ICON_WIDTH, graphicToString } from './pecGraphics';
export {
  buildPesPattern,
  pesLabelFor,
  writePes,
  writePesPattern,
  type PesPattern,
  type PesThreadInfo,
  type PesWriteOptions,
} from './pesWriter';
export { PesReadError, readPes, type PesColor, type PesMetadata, type PesReadResult } from './pesReader';
