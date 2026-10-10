// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * What a PES v1 file will show on the machine: each colour slot of the export (one per
 * colour block, stops included) with the design colour and the PEC palette colour the
 * writer assigns to it (same unique-palette mapping as writePes with CIEDE2000).
 */
import type { StitchPlan } from '@/engine/types';
import {
  PEC_PALETTE,
  buildUniquePalette,
  normalizeForPes,
  toMachineCommands,
  type PecThread,
} from '@/io/pes';
import type { Design } from '@/model/types';
import { deltaEHex } from '@/threads/color';

export interface ColorSlotRow {
  /** 0-based colour slot in the file. */
  slot: number;
  blockIndex: number;
  designColor: string;
  threadName?: string;
  threadCode?: string;
  pecIndex: number;
  pec: PecThread | null;
  /** CIEDE2000 between the design colour and the PEC colour. */
  deltaE: number;
  /** True when this slot repeats the previous thread (a stop). */
  stop: boolean;
}

/** ΔE above which the dialog points out a visible difference. */
export const DELTA_E_HINT = 10;

export function pecColorMapping(plan: StitchPlan, design: Pick<Design, 'threads'>): ColorSlotRow[] {
  const { colorSlots } = normalizeForPes(toMachineCommands(plan));
  const colors = colorSlots.map((b) => (plan.colorBlocks[b]?.color ?? '#000000').toLowerCase());
  const indexes = buildUniquePalette(colors, 'ciede2000');
  return colorSlots.map((b, slot) => {
    const block = plan.colorBlocks[b];
    const thread = block ? design.threads[block.threadId] : undefined;
    const pecIndex = indexes[slot] ?? -1;
    const pec = pecIndex >= 0 ? (PEC_PALETTE[pecIndex] ?? null) : null;
    const prev = slot > 0 ? plan.colorBlocks[colorSlots[slot - 1]] : undefined;
    const row: ColorSlotRow = {
      slot,
      blockIndex: b,
      designColor: colors[slot],
      pecIndex,
      pec,
      deltaE: pec ? deltaEHex(colors[slot], pec.color) : 0,
      stop: !!prev && !!block && prev.threadId === block.threadId,
    };
    if (thread?.name) row.threadName = thread.name;
    if (thread?.code) row.threadCode = thread.code;
    return row;
  });
}
