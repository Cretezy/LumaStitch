// SPDX-License-Identifier: GPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { letteringBatch } from '@/lettering/batch';
import { DEFAULT_LETTERING } from '@/lettering/layout';
import { inspectFont, prepareOpenType } from '@/lettering/shapeFont';
import type { LetteringOptions } from '@/model/types';
export function stitchExamples() {
  return [
    { name: 'sans', font: 'NotoSans', text: 'Luma', height: 30, weight: 700, color: '#216d82' },
    { name: 'serif', font: 'NotoSerif', text: 'Stitch', height: 26, weight: 700, color: '#884362' },
    { name: 'arabic', font: 'NotoSansArabic', text: 'سَلَام', height: 35, weight: 600, color: '#397548' },
    {
      name: 'arabic-curve',
      font: 'NotoSansArabic',
      text: 'سَلَام',
      height: 35,
      weight: 600,
      color: '#397548',
    },
  ].map(({ name, font, text, height, weight, color }) => {
    const imported = inspectFont(
      new Uint8Array(readFileSync(`src/lettering/fonts/opentype/${font}.ttf`)),
      font,
    );
    const options: LetteringOptions = {
      ...DEFAULT_LETTERING,
      font: 'opentype',
      text,
      height,
      align: 'center',
      ...(name === 'arabic-curve'
        ? {
            baseline: {
              fillRule: 'nonzero',
              subpaths: [
                {
                  closed: false,
                  nodes: [
                    { p: [0, 25], out: [25, -12] },
                    { p: [90, 25], in: [-25, -12] },
                  ],
                },
              ],
            },
          }
        : {}),
      openType: {
        ...imported,
        license: readFileSync(`src/lettering/fonts/opentype/${font}-OFL.txt`, 'utf8'),
        direction: 'auto',
        language: font === 'NotoSansArabic' ? 'ar' : 'en',
        variations: { wght: weight },
        stitch: 'tatami',
      },
    };
    return { name, optimize: false, design: letteringBatch([text], prepareOpenType(options), color)[0] };
  });
}
