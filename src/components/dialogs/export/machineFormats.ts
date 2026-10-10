// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Machine formats offered by the export dialog, with the notes it shows, plus what a JEF
 * file will display on the machine (its colours are mapped onto the Janome palette).
 */
import type { StitchPlan } from '@/engine/types';
import { buildFormatPattern } from '@/io/formats/encoder';
import { JEF_SETTINGS, jefPalette } from '@/io/formats/jef';
import { JEF_THREADS, type JefThread } from '@/io/formats/jefThreads';
import type { Design } from '@/model/types';
import { deltaEHex } from '@/threads/color';

export type MachineChoice = 'pes' | 'dst' | 'jef' | 'exp' | 'vp3';

export interface MachineFormatInfo {
  id: MachineChoice;
  /** Shown in the format picker. */
  title: string;
  /** Which machines read it. */
  machines: string;
  /** Colour handling and other limitations. */
  colors: string;
}

export const MACHINE_FORMATS: readonly MachineFormatInfo[] = [
  {
    id: 'pes',
    title: 'Brother PES (.pes)',
    machines: 'Brother and Baby Lock machines.',
    colors: 'Colours are stored as Brother’s palette (v1) or exact RGB with thread names (v6).',
  },
  {
    id: 'dst',
    title: 'Tajima DST (.dst)',
    machines:
      'Commercial and multi-needle machines (Tajima, Barudan, Happy, SWF, Ricoma and others); most other brands import it too.',
    colors:
      'DST has no thread colours: assign threads or needles at the machine. Colour changes and stops are both written as machine stops; trims as three short jumps.',
  },
  {
    id: 'jef',
    title: 'Janome JEF (.jef)',
    machines: 'Janome, Elna and Kenmore machines.',
    colors:
      'Colours are mapped to Janome’s 78-colour palette (shown below); sew with your own threads. The file names the smallest Janome hoop the design fits.',
  },
  {
    id: 'exp',
    title: 'Bernina / Melco EXP (.exp)',
    machines: 'Bernina machines and Melco commercial machines.',
    colors: 'EXP has no thread colours or design name. Colour changes and stops are both machine stops.',
  },
  {
    id: 'vp3',
    title: 'Husqvarna / Pfaff VP3 (.vp3)',
    machines: 'Husqvarna Viking and Pfaff machines.',
    colors:
      'Stores exact RGB, thread names, codes and brands. VP3 has no stop command, so a stop becomes an extra colour block with the same thread.',
  },
];

export function isMachineFormat(v: unknown): v is MachineChoice {
  return v === 'pes' || v === 'dst' || v === 'jef' || v === 'exp' || v === 'vp3';
}

export function machineFormatInfo(id: MachineChoice): MachineFormatInfo {
  return MACHINE_FORMATS.find((f) => f.id === id) ?? MACHINE_FORMATS[0];
}

export interface JefColorRow {
  /** 0-based entry in the JEF colour list. */
  entry: number;
  /** Colour slot (thread) this entry sews. */
  slot: number;
  /** A stop entry (repeats the previous thread). */
  stop: boolean;
  designColor: string;
  threadName?: string;
  threadCode?: string;
  /** JEF palette index (0 = the stop placeholder). */
  jefIndex: number;
  jef: JefThread | null;
  /** CIEDE2000 between the design colour and the JEF colour (0 without one). */
  deltaE: number;
}

/** JEF colour list as the writer builds it (CIEDE2000 matching, the export default). */
export function jefColorMapping(plan: StitchPlan, design: Pick<Design, 'name' | 'threads'>): JefColorRow[] {
  const pattern = buildFormatPattern(plan, design, JEF_SETTINGS);
  let slot = 0;
  return jefPalette(pattern).map((p, entry) => {
    if (p.slot >= 0) slot = p.slot;
    const t = pattern.threads[slot];
    const designColor = t?.color ?? '#000000';
    const jef = JEF_THREADS[p.index] ?? null;
    const row: JefColorRow = {
      entry,
      slot,
      stop: p.slot < 0,
      designColor,
      jefIndex: p.index,
      jef,
      deltaE: jef ? deltaEHex(designColor, jef.color) : 0,
    };
    if (t?.description) row.threadName = t.description;
    if (t?.catalogNumber) row.threadCode = t.catalogNumber;
    return row;
  });
}
