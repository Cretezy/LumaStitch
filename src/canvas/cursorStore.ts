// SPDX-License-Identifier: GPL-3.0-or-later
import { create } from 'zustand';
import type { Vec2 } from '@/model/types';

/** Pointer position in document mm (separate store so moves don't re-render the app). */
export const useCursor = create<{ pos: Vec2 | null }>(() => ({ pos: null }));
