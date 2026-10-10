// SPDX-License-Identifier: GPL-3.0-or-later
import { create } from 'zustand';

/**
 * Panning feedback for the canvas cursor: Space held (ready to pan), an active pan drag, and the
 * pointer over empty background with a selection tool (a drag there pans).
 */
export const usePanState = create<{ space: boolean; dragging: boolean; background: boolean }>(() => ({
  space: false,
  dragging: false,
  background: false,
}));
