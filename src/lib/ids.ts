// SPDX-License-Identifier: GPL-3.0-or-later
import { customAlphabet } from 'nanoid';

const nano = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 10);

/** Fresh unique id for shapes, elements, threads, stops. */
export function newId(prefix = ''): string {
  return prefix + nano();
}
