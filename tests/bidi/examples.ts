// SPDX-License-Identifier: GPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { letteringBatch } from '@/lettering/batch';
import { DEFAULT_LETTERING } from '@/lettering/layout';
import { inspectFont, prepareOpenType } from '@/lettering/shapeFont';
import type { LetteringOptions } from '@/model/types';
export function stitchExamples() {
  return [
    {
      name: 'arabic-ltr',
      font: 'NotoSansArabic',
      text: 'Luma سَلَام 123',
      direction: 'ltr',
      color: '#296450',
    },
    {
      name: 'arabic-rtl',
      font: 'NotoSansArabic',
      text: 'Luma سَلَام 123',
      direction: 'rtl',
      color: '#296450',
    },
    {
      name: 'hebrew',
      font: 'NotoSansHebrew',
      text: 'Luma שָׁלוֹם (123)',
      direction: 'auto',
      color: '#365e8e',
    },
    {
      name: 'mixed-curve',
      font: 'NotoSansArabic',
      text: 'Luma سَلَام 123',
      direction: 'auto',
      color: '#884362',
    },
  ].map(({ name, font, text, direction, color }) => {
    const imported = inspectFont(
      new Uint8Array(readFileSync(`src/lettering/fonts/opentype/${font}.ttf`)),
      font,
    );
    const options: LetteringOptions = {
      ...DEFAULT_LETTERING,
      font: 'opentype',
      text,
      height: 18,
      align: 'center',
      openType: {
        ...imported,
        license: readFileSync(`src/lettering/fonts/opentype/${font}-OFL.txt`, 'utf8'),
        direction: direction as 'auto' | 'ltr' | 'rtl',
        language: '',
        variations: { wght: 700 },
        stitch: 'tatami',
      },
    };
    if (name === 'mixed-curve')
      options.baseline = {
        fillRule: 'nonzero',
        subpaths: [
          {
            closed: false,
            nodes: [
              { p: [0, 30], out: [45, -22] },
              { p: [180, 30], in: [-45, -22] },
            ],
          },
        ],
      };
    return { name, optimize: false, design: letteringBatch([text], prepareOpenType(options), color)[0] };
  });
}
