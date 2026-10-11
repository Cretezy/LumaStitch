// SPDX-License-Identifier: GPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { prepareMachineImport } from '@/io/machine/import';

export function stitchExamples() {
  const { design } = prepareMachineImport(new Uint8Array(readFileSync('docs/stitch-examples/after/satin-botanical/satin-botanical.pes')), 'satin-botanical.pes');
  design.name = 'Editable imported botanical';
  return [{ name: 'imported-botanical', design, optimize: false }];
}
