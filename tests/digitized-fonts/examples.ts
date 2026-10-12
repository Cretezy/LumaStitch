// SPDX-License-Identifier: GPL-3.0-or-later
import { letteringBatch } from '@/lettering/batch';
import { DEFAULT_LETTERING } from '@/lettering/layout';
import type { LetteringOptions } from '@/model/types';
export function stitchExamples() {
  const cases: {name: string; color: string; options: Partial<LetteringOptions>}[] = [
    {name: 'rounded', color: '#2d6b64', options: {font: 'geneva-rounded', text: 'LumaStitch', height: 12}},
    {name: 'script', color: '#854766', options: {font: 'chopin', text: 'Luma', height: 34}},
    {name: 'script-monogram', color: '#a57830', options: {font: 'chopin', text: 'ABC', height: 44, monogram: true}},
  ];
  return cases.map(({name, color, options}) => ({name, optimize: false, design: letteringBatch([options.text!], {...DEFAULT_LETTERING, ...options}, color)[0]}));
}
