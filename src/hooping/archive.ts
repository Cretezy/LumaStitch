// SPDX-License-Identifier: GPL-3.0-or-later
import { buildPlan } from '@/engine/plan';
import { getMachineFormat } from '@/io/export/registry';
import { readMachine } from '@/io/machine/read';
import { MC } from '@/io/pes/machineCommands';
import { escapeXml } from '@/io/export/svg';
import { serializeProject } from '@/model/schema';
import type { Design, MultiHoopOptions } from '@/model/types';
import { zipFiles, type ZipEntry } from '@/library/zip';
import { splitHoopings, type Hooping } from './split';
import { fieldCorners, toWorld } from './placement';

export function hoopingLayout(parts: Hooping[], options: MultiHoopOptions): string {
  const corners = parts.flatMap((p) => fieldCorners(p, options.width, options.height));
  const left = Math.min(...corners.map((p) => p[0])) - 6,
    top = Math.min(...corners.map((p) => p[1])) - 8,
    right = Math.max(...corners.map((p) => p[0])) + 6,
    bottom = Math.max(...corners.map((p) => p[1])) + 8;
  const lines = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${right - left}mm" height="${bottom - top}mm" viewBox="${left} ${top} ${right - left} ${bottom - top}">`,
    `<rect x="${left}" y="${top}" width="${right - left}" height="${bottom - top}" fill="#fffdf6"/>`,
  ];
  for (const p of parts) {
    const [x, y] = p.center;
    for (const shape of Object.values(p.design.shapes)) {
      const thread = shape.outline && p.design.threads[shape.outline.threadId];
      if (!thread || thread.code === 'REG') continue;
      const path: string[] = [];
      for (const sub of shape.geom.subpaths) {
        let move = true;
        for (const node of sub.nodes) {
          if (node.command) {
            move = true;
            continue;
          }
          const point = toWorld(node.p, p);
          path.push(`${move ? 'M' : 'L'}${point[0]} ${point[1]}`);
          move = false;
        }
      }
      lines.push(
        `<path d="${path.join('')}" fill="none" stroke="${escapeXml(thread.color)}" stroke-width="0.15" opacity="0.65"/>`,
      );
    }
    lines.push(`<g transform="rotate(${p.angle} ${x} ${y})">`);
    lines.push(
      `<rect x="${x - options.width / 2}" y="${y - options.height / 2}" width="${options.width}" height="${options.height}" fill="none" stroke="#234a73" stroke-width="0.3"/>`,
    );
    lines.push(
      `<rect x="${x - options.width / 2 + options.margin}" y="${y - options.height / 2 + options.margin}" width="${options.width - 2 * options.margin}" height="${options.height - 2 * options.margin}" fill="none" stroke="#708090" stroke-width="0.2" stroke-dasharray="1 1"/>`,
    );
    lines.push(`<path d="M${x} ${y - options.height / 2}l-2 4h4z" fill="#234a73"/>`);
    lines.push(`</g>`);
    lines.push(
      `<text x="${x}" y="${y}" font-family="sans-serif" font-size="4" text-anchor="middle" fill="#234a73">${p.number}${p.angle ? ` · ${p.angle}°` : ''}${p.originalNeedles ? '' : ' (registration only)'}</text>`,
    );
    for (const [a, b] of p.marks)
      lines.push(`<path d="M${a - 1} ${b}h2M${a} ${b - 1}v2" stroke="#c23b45" stroke-width="0.25"/>`);
  }
  lines.push(
    `<text x="${left + 2}" y="${bottom - 2}" font-family="sans-serif" font-size="2.5">${escapeXml('Print at 100%. Positions and sewing order: manifest.json. Red crosses are shared registration marks.')}</text></svg>`,
  );
  return lines.join('\n');
}
export function hoopingArchive(design: Design, options: MultiHoopOptions, formatId = 'pes') {
  const format = getMachineFormat(formatId);
  if (!format) throw new Error('Choose a machine format.');
  const parts = splitHoopings(design, options),
    enc = new TextEncoder(),
    files: ZipEntry[] = [];
  const entries = parts.map((part) => {
    const name = `hoop-${String(part.number).padStart(2, '0')}`;
    const plan = buildPlan(part.design),
      errors = format.validate(plan, part.design).filter((d) => d.severity === 'error');
    if (errors.length) throw new Error(`Hooping ${part.number}: ${errors.map((d) => d.message).join(' ')}`);
    const bytes = format.write(plan, part.design, { version: 6 });
    const decoded = readMachine(bytes, format.ext);
    const rx = (options.width / 2 - options.margin) * 10,
      ry = (options.height / 2 - options.margin) * 10;
    if (
      decoded.commands.some(
        (p) =>
          (p.cmd === MC.STITCH || p.cmd === MC.JUMP) &&
          (Math.abs(p.x) > rx + 1e-6 || Math.abs(p.y) > ry + 1e-6),
      )
    )
      throw new Error(`Hooping ${part.number}: encoded machine movements exceed the selected field.`);
    files.push(
      { name: `${name}.${format.ext}`, data: bytes },
      { name: `${name}.lumastitch`, data: enc.encode(serializeProject(part.design)) },
    );
    return {
      number: part.number,
      row: part.row,
      column: part.column,
      file: `${name}.${format.ext}`,
      project: `${name}.lumastitch`,
      centerMm: part.center,
      clockwiseDegrees: part.angle,
      placement: part.placement,
      registrationParent: part.registrationParent,
      sharedRegistrationMm: part.marks,
      sourceNeedles: part.originalNeedles,
      wholeObjects: part.wholeObjects,
      stats: plan.stats,
    };
  });
  const manifest = {
    version: 1,
    design: design.name,
    units: 'mm',
    coordinates: '+x right, +y down',
    options,
    sourceStitches: entries.reduce((n, p) => n + p.sourceNeedles, 0),
    hoopings: entries,
  };
  const layout = hoopingLayout(parts, options);
  const instructions = `LumaStitch multi-hooping package\n\nSew numbered files in manifest order. Each begins with a temporary basting frame and shared registration crosses in the registration thread, then a STOP before design colors. Align the shared pair of crosses with the previous neighboring hooping; the two points establish position and rotation. The symmetric frame fixes machine-file centering. Do not remove it from the program or use automatic resize/fit on the machine. Remove temporary basting/registration thread after assembly. Registration-only hoopings bridge empty areas of the rectangular layout.\n\nCoordinates in manifest.json are millimetres in the original design. Every numbered machine file uses local coordinates centered on its stated centerMm and rotated clockwise by clockwiseDegrees in the placement template. Rotate the fabric placement, not the machine program. registrationParent identifies an earlier field sharing its registration pair for custom layouts. Local file coordinates are quantized to 0.1 mm; for rotated placements the reconstructed positions can differ by up to 0.08 mm from the quantized source. The saved placement list order may differ from the connected sewing order. layout.svg is an actual-size placement template; print at 100% and verify scale. These are overlapping rectangular fields, not a machine-specific multi-position hoop format.\n\nWhen keepObjects is enabled, wholeObjects lists source shapes whose complete fill and outline needle programs fit in one field and were kept together there. Touching source shapes form connected layer groups. A whole group moves into a shared fitting field, retaining its source sewing order; if no field fits every member, the complete group retains its existing seams. The optional layerGroup identifier is the first source shape ID in a touching group; wholeObjects entries sharing it moved together. Oversized shapes still split at ownership boundaries. These assignments preserve generated stitch groups, not reconstructed editable vector objects in the numbered files. Stitch segments are split at ownership boundaries inside overlaps; original penetrations are retained and extra seam penetrations, locks, trims and registration stitches are added. Source sequence and stops are retained within each hooping. The numbered projects contain editable machine stitches, not reconstructed vector objects. source.lumastitch preserves the original design and settings. Changing density requires regenerating the package from the source.\n\nSoftware fit and command checks do not establish physical registration accuracy. Sew a sample on the intended machine/fabric/stabilizer before a production piece.\n`;
  files.push(
    { name: 'manifest.json', data: enc.encode(JSON.stringify(manifest, null, 2)) },
    { name: 'layout.svg', data: enc.encode(layout) },
    { name: 'README.txt', data: enc.encode(instructions) },
    { name: 'source.lumastitch', data: enc.encode(serializeProject({ ...design, multiHoop: options })) },
  );
  return { archive: zipFiles(files), manifest, layout };
}
