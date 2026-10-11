// SPDX-License-Identifier: GPL-3.0-or-later
import { letteringBatch } from '../../src/lettering/batch';
import { DEFAULT_LETTERING } from '../../src/lettering/layout';

export function stitchExamples() {
  return [
    { name: 'lettering-multiline', options: { text: 'LumaStitch\nMade with care', align: 'center' as const, height: 10 } },
    { name: 'lettering-arc', options: { text: 'STITCH CLUB', arcAngle: 100, height: 12 } },
    { name: 'lettering-monogram', options: { text: 'ABC', monogram: true, height: 18 } },
  ].map(({ name, options }) => ({ name, optimize: false, design: letteringBatch([options.text], { ...DEFAULT_LETTERING, ...options }, '#234a73')[0] }));
}
