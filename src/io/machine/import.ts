// SPDX-License-Identifier: GPL-3.0-or-later
import { MC } from '@/io/pes/machineCommands';
import { createDesign, createElement, createShape, createThread } from '@/model/factories';
import type { Node, Shape } from '@/model/types';
import { readMachine, type MachineReadResult } from './read';

export function prepareMachineImport(data: Uint8Array, fileName: string) {
  const result = readMachine(data, fileName.split('.').at(-1)!);
  return {
    design: machineDesign(result, fileName.replace(/\.[^.]+$/, '')),
    notes: result.notes,
    stitches: result.commands.filter((c) => c.cmd === MC.STITCH).length,
    colors: result.colors.length,
  };
}

/** Editable needle nodes, grouped by explicit color changes, with control commands attached to nodes. */
export function machineDesign(input: MachineReadResult, name: string) {
  const design = createDesign({ name: name || input.name || 'Imported stitches' });
  let colorIndex = 0;
  let shape: Shape | null = null;
  const begin = () => {
    const color = input.colors[colorIndex] ?? { color: '#000000', name: `Color ${colorIndex + 1}` };
    // Distinct thread IDs retain explicit same-color change commands.
    const t = createThread(color.color, color.name, { code: color.code });
    design.threads[t.id] = t;
    shape = createShape(
      `Imported ${colorIndex + 1}: ${t.name}`,
      { fillRule: 'nonzero', subpaths: [{ closed: false, nodes: [] }] },
      { stroke: t.color, strokeWidth: 0.15 },
    );
    shape.outline = createElement('outline', 'manual', t.id, { preserveCommands: true });
    shape.outline.tieIn = 'off';
    shape.outline.tieOut = 'off';
    design.shapes[shape.id] = shape;
    design.zOrder.push(shape.id);
    design.sequence.push({ kind: 'element', elementId: shape.outline.id });
  };
  begin();
  let lastX = 0,
    lastY = 0;
  for (const c of input.commands) {
    if (c.cmd === MC.END) break;
    if (c.cmd === MC.COLOR_CHANGE) {
      if (c.x !== lastX || c.y !== lastY)
        shape!.geom.subpaths[0].nodes.push({ p: [c.x / 10, c.y / 10], command: 'jump' });
      colorIndex++;
      begin();
    } else {
      const node: Node = { p: [c.x / 10, c.y / 10] };
      if (c.cmd === MC.JUMP) node.command = 'jump';
      else if (c.cmd === MC.TRIM) node.command = 'trim';
      else if (c.cmd === MC.STOP) node.command = 'stop';
      else if (c.cmd !== MC.STITCH) throw new Error(`Unsupported machine command ${c.cmd}.`);
      shape!.geom.subpaths[0].nodes.push(node);
    }
    lastX = c.x;
    lastY = c.y;
  }
  return design;
}
