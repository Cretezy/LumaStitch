// SPDX-License-Identifier: GPL-3.0-or-later
/** Public API of the threads/colour module (ARCHITECTURE §16). */
export * from './color';
export {
  INKSTITCH_COMMIT,
  findByCode,
  getChart,
  getChartMeta,
  hasChart,
  listCharts,
  peekChart,
  registerChart,
  searchChart,
  type ChartMeta,
  type ChartThread,
  type ThreadChart,
} from './charts';
export {
  labOf,
  mapColorsToChart,
  nearestThread,
  type ColorMatch,
  type HasColor,
  type NearestResult,
} from './nearest';
export {
  averageColor,
  kmeansLab,
  mergeCloseColors,
  mulberry32,
  reduceColors,
  type ColorCluster,
  type KMeansOptions,
  type KMeansResult,
  type ReduceOptions,
  type ReduceResult,
  type WeightedColor,
} from './kmeans';
