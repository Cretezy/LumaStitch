// SPDX-License-Identifier: GPL-3.0-or-later
import * as Comlink from 'comlink';
import { archiveLetteringDesigns } from '@/lettering/archive';
import { letteringBatch } from '@/lettering/batch';
import type { LetteringOptions } from '@/model/types';
async function letteringArchive(names: string[], options: LetteringOptions, color: string) {
  if (!names.length || names.length > 100 || names.join('').length > 5000)
    throw new Error('Use 1–100 names and at most 5,000 characters.');
  if ((options.openType?.data.length ?? 0) * names.length > 100_000_000)
    throw new Error('Embedded fonts exceed the 100 MB batch limit. Export fewer names at a time.');
  const prepareOpenType =
    options.font === 'opentype'
      ? (await import('@/lettering/shapeFont')).prepareOpenType
      : (o: LetteringOptions) => o;
  return archiveLetteringDesigns(
    names.flatMap((text) => letteringBatch([text], prepareOpenType({ ...options, text }), color)),
  );
}
// Register the message listener before loading WASM: a top-level-await dependency
// would let early Comlink requests arrive before expose() and silently lose them.
Comlink.expose({
  letteringArchive,
  async inspectFont(bytes: Uint8Array, filename: string) {
    return (await import('@/lettering/shapeFont')).inspectFont(bytes, filename);
  },
  async prepareOpenType(options: LetteringOptions) {
    return (await import('@/lettering/shapeFont')).prepareOpenType(options);
  },
});
