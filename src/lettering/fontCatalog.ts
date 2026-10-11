// SPDX-License-Identifier: GPL-3.0-or-later
import sans from './fonts/opentype/NotoSans.ttf?url';
import serif from './fonts/opentype/NotoSerif.ttf?url';
import arabic from './fonts/opentype/NotoSansArabic.ttf?url';
import sansLicense from './fonts/opentype/NotoSans-OFL.txt?raw';
import serifLicense from './fonts/opentype/NotoSerif-OFL.txt?raw';
import arabicLicense from './fonts/opentype/NotoSansArabic-OFL.txt?raw';
export const FONT_CATALOG = [
  { name: 'Noto Sans', url: sans, license: sansLicense },
  { name: 'Noto Serif', url: serif, license: serifLicense },
  { name: 'Noto Sans Arabic', url: arabic, license: arabicLicense },
];
