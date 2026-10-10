// SPDX-License-Identifier: GPL-3.0-or-later
import { create } from 'zustand';

/** Panning feedback for the canvas cursor: Space held (ready to pan) and an active pan drag. */
export const usePanState = create<{ space: boolean; dragging: boolean }>(() => ({
  space: false,
  dragging: false,
}));
