// SPDX-License-Identifier: GPL-3.0-or-later
import simple from './fonts/geneva-simple/glyphs.json';
import simpleMetadata from './fonts/geneva-simple/metadata.json';
import rounded from './fonts/geneva-rounded/glyphs.json';
import roundedMetadata from './fonts/geneva-rounded/metadata.json';
import chopin from './fonts/chopin/glyphs.json';
import chopinMetadata from './fonts/chopin/metadata.json';
import simpleLicense from './fonts/geneva-simple/LICENSE?raw';
import roundedLicense from './fonts/geneva-rounded/LICENSE?raw';
import chopinLicense from './fonts/chopin/LICENSE?raw';

export type DigitizedFontId = 'geneva-simple' | 'geneva-rounded' | 'chopin';
export type FontPath = {
  d: string;
  transforms: string[];
  satin: boolean;
  underlay: string;
  pull: number;
  stitchLength?: number;
};
interface DigitizedFont {
  name: string;
  glyphs: Record<string, FontPath[]>;
  metadata: {
    horiz_adv_x: Record<string, number>;
    kerning_pairs?: Record<string, number>;
    leading: number;
    horiz_adv_x_space: number;
    horiz_adv_x_default: number;
  };
  baseline: number;
  capHeight: number;
  min: number;
  max: number;
  defaultHeight: number;
  source: string;
  attribution: string;
  license: string;
}
const source =
  'https://github.com/inkstitch/embroidery-fonts/tree/084eac038bf1af5a3a8b881a6cf0cc3340cf6e9b/src/';
export const DIGITIZED_FONTS: Record<DigitizedFontId, DigitizedFont> = {
  'geneva-simple': {
    name: 'Geneva Simple Sans',
    glyphs: simple,
    metadata: simpleMetadata,
    baseline: 90 - 27.2685,
    capHeight: 62.9405 - 27.2685,
    min: 10,
    max: 20,
    defaultHeight: 10,
    source: source + 'geneva_simple',
    attribution:
      'Geneva Simple Sans / Ink/Stitch contributors, based on Hershey. CC-BY-SA 2.5 and Hershey notices.',
    license: simpleLicense,
  },
  'geneva-rounded': {
    name: 'Geneva Simple Sans Rounded',
    glyphs: rounded,
    metadata: roundedMetadata,
    baseline: 90 - 26.800407,
    capHeight: 63.30232 - 26.800407,
    min: 10.5,
    max: 21,
    defaultHeight: 10.5,
    source: source + 'geneva_rounded',
    attribution:
      'Geneva Simple Sans Rounded / Ink/Stitch contributors, based on Hershey. CC-BY-SA 2.5 and Hershey notices.',
    license: roundedLicense,
  },
  chopin: {
    name: 'Chopin Script',
    glyphs: chopin,
    metadata: chopinMetadata,
    baseline: 300 - 94.741878,
    capHeight: 282.82451 - 94.741878,
    min: 30.64,
    max: 45.96,
    defaultHeight: 38.3,
    source: source + 'chopin',
    attribution:
      'Adapted for Ink/Stitch by Célia Imbert Sabater; CC-BY-SA 4.0. Original Chopin Script by Claude Pelletier (Diogene), public domain per the source notice.',
    license: chopinLicense,
  },
};
export function digitizedFont(id: string): DigitizedFont | undefined {
  return Object.hasOwn(DIGITIZED_FONTS, id) ? DIGITIZED_FONTS[id as DigitizedFontId] : undefined;
}
