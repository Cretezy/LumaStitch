// SPDX-License-Identifier: GPL-3.0-or-later
import type { AnalyzeOptions, AnalyzeResult, AnalyzeShapeInput } from '@/engine/autodigitize/classify';
import type { OptimizeOpts } from '@/engine/sequence/optimize';
import type { StitchPlan } from '@/engine/types';
import type { Design, SequenceEntry } from '@/model/types';

export interface EngineApi {
  buildPlan(design: Design, revision: number): Promise<StitchPlan | { stale: true }>;
  analyze(input: { shapes: AnalyzeShapeInput[]; options: AnalyzeOptions }): Promise<AnalyzeResult>;
  optimizeSequence(design: Design, opts: OptimizeOpts): Promise<SequenceEntry[]>;
}
