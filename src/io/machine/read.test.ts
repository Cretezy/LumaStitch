// SPDX-License-Identifier: GPL-3.0-or-later
import { readFileSync, readdirSync } from 'node:fs';
import { expect, it } from 'vitest';
import { readMachine } from './read';
import { machineDesign } from './import';
import { buildPlan } from '@/engine/plan';
import { toMachineCommands, MC } from '@/io/pes/machineCommands';
import { parseProjectFile, serializeProject } from '@/model/schema';
import { pesFormat } from '@/io/export/pesFormat';
import { readPes } from '@/io/pes/pesReader';
import { writeVp3Pattern } from '@/io/formats/vp3';

const files = ['formats', 'pes'].flatMap((dir) =>
  readdirSync(`tests/fixtures/${dir}`)
    .filter((f) => /\.(pes|dst|jef|exp|vp3)$/.test(f))
    .map((f) => `tests/fixtures/${dir}/${f}`),
);
const reference = JSON.parse(readFileSync('tests/fixtures/machine-readers.json', 'utf8')).files as Record<
  string,
  number[][]
>;
it.each(files)('%s decodes to an editable, command-preserving plan', (file) => {
  const parsed = readMachine(new Uint8Array(readFileSync(file)), file.split('.').at(-1)!);
  expect(parsed.commands.map((c) => [c.x, c.y, c.cmd])).toEqual(reference[file]);
  const design = machineDesign(parsed, file);
  const reopened = parseProjectFile(serializeProject(design));
  const plan = buildPlan(reopened);
  expect(plan.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  const actual = toMachineCommands(plan).commands;
  const exported = readPes(pesFormat.write(plan, reopened, { version: 6 }));
  expect(exported.commands.filter((c) => c.cmd === MC.STITCH)).toEqual(
    parsed.commands.filter((c) => c.cmd === MC.STITCH),
  );
  expect(actual.filter((c) => c.cmd === MC.STITCH)).toEqual(
    parsed.commands.filter((c) => c.cmd === MC.STITCH),
  );
  for (const type of [MC.TRIM, MC.STOP, MC.COLOR_CHANGE])
    expect(actual.filter((c) => c.cmd === type).length).toBe(
      parsed.commands.filter((c) => c.cmd === type).length,
    );
});
it('rejects truncated records and unsupported files explicitly', () => {
  for (const ext of ['dst', 'jef', 'exp', 'vp3'])
    expect(() => readMachine(new Uint8Array([0x80]), ext)).toThrow();
});

it.each([
  [0, 0],
  [0, 50],
  [50, 0],
])('positions a later VP3 color block at (%i, %i)', (x, y) => {
  const commands = [
    { x: 100, y: 100, cmd: MC.STITCH },
    { x, y, cmd: MC.COLOR_CHANGE },
    { x, y, cmd: MC.STITCH },
    { x: x + 20, y: y + 30, cmd: MC.STITCH },
    { x: x + 20, y: y + 30, cmd: MC.END },
  ];
  const bytes = writeVp3Pattern({
    name: 'Return to origin',
    commands,
    threads: [{ color: '#ff0000' }, { color: '#0000ff' }],
  });
  const parsed = readMachine(bytes, 'vp3');
  const expected = commands.filter((c) => c.cmd === MC.STITCH);
  expect(parsed.commands.filter((c) => c.cmd === MC.STITCH)).toEqual(expected);
  const design = machineDesign(parsed, 'Return to origin');
  expect(
    readPes(pesFormat.write(buildPlan(design), design, { version: 6 })).commands.filter(
      (c) => c.cmd === MC.STITCH,
    ),
  ).toEqual(expected);
});

it('preserves explicit controls, duplicate needles and transformed command nodes', async () => {
  const { transformGeom } = await import('@/geom/pathData');
  const { translate } = await import('@/geom/matrix');
  const { removeNodes, insertNodeAt } = await import('@/geom/paperAdapter');
  const commands = [
    { x: 0, y: 0, cmd: MC.JUMP },
    { x: 0, y: 0, cmd: MC.STITCH },
    { x: 0, y: 0, cmd: MC.STITCH },
    { x: 30, y: 10, cmd: MC.STITCH },
    { x: 30, y: 10, cmd: MC.TRIM },
    { x: 35, y: 15, cmd: MC.JUMP },
    { x: 35, y: 15, cmd: MC.STOP },
    { x: 40, y: 20, cmd: MC.STITCH },
    { x: 40, y: 20, cmd: MC.END },
  ];
  const d = machineDesign({ commands, colors: [{ color: '#123456' }], name: '', notes: [] }, 'Commands');
  expect(toMachineCommands(buildPlan(d)).commands).toEqual(commands);
  const shape = d.shapes[d.zOrder[0]];
  const moved = transformGeom(shape.geom, translate(10, 20));
  expect(moved.subpaths[0].nodes.map((n) => n.command)).toEqual(
    shape.geom.subpaths[0].nodes.map((n) => n.command),
  );
  expect(
    removeNodes(shape.geom, [{ subpathIndex: 0, nodeIndex: 2 }]).subpaths[0].nodes.filter((n) => n.command),
  ).toHaveLength(4);
  expect(
    insertNodeAt(shape.geom, { subpathIndex: 0, segmentIndex: 2, t: 0.5 }).geom.subpaths[0].nodes.filter(
      (n) => n.command,
    ),
  ).toHaveLength(4);
});
