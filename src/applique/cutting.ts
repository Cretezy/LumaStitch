// SPDX-License-Identifier: GPL-3.0-or-later
import { flattenGeom } from '@/geom/flatten';
import { makeValid, offset } from '@/geom/clipper';
import { polyShapeBBox } from '@/geom/polygon';
import type { Ring } from '@/geom/types';
import { resolveParams } from '@/engine/params/resolve';
import { num } from '@/engine/params/types';
import { buildElementIndex, getElement } from '@/model/factories';
import { appliqueCutSchema, serializeProject } from '@/model/schema';
import type { AppliqueCutOptions, Design } from '@/model/types';
import { zipFiles, type ZipEntry } from '@/library/zip';
const round = (v: number) => Math.round(v * 1000) / 1000;
const path = (rings: Ring[]) =>
  rings
    .map(
      (r) =>
        Array.from(
          { length: r.length / 2 },
          (_, i) => `${i ? 'L' : 'M'}${round(r[i * 2])} ${round(r[i * 2 + 1])}`,
        ).join(' ') + 'Z',
    )
    .join(' ');
export function cuttingSvg(rings: Ring[], width: number, height: number) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${round(width)}mm" height="${round(height)}mm" viewBox="0 0 ${round(width)} ${round(height)}"><path d="${path(rings)}" fill="none" stroke="#000000" stroke-width="0.1"/></svg>`;
}
/** DXF millimetres; CAD +y is up, so invert the SVG/document y coordinate. */
export function cuttingDxf(rings: Ring[]) {
  const lines: (string | number)[] = [
    0,
    'SECTION',
    2,
    'HEADER',
    9,
    '$ACADVER',
    1,
    'AC1015',
    9,
    '$INSUNITS',
    70,
    4,
    9,
    '$MEASUREMENT',
    70,
    1,
    0,
    'ENDSEC',
    0,
    'SECTION',
    2,
    'ENTITIES',
  ];
  for (const r of rings) {
    lines.push(0, 'LWPOLYLINE', 100, 'AcDbEntity', 8, 'CUT', 100, 'AcDbPolyline', 90, r.length / 2, 70, 1);
    for (let i = 0; i < r.length; i += 2) lines.push(10, round(r[i]), 20, round(-r[i + 1]));
  }
  lines.push(0, 'ENDSEC', 0, 'EOF');
  return lines.join('\n') + '\n';
}
export function appliqueCuttingArchive(design: Design, input: AppliqueCutOptions) {
  const options = appliqueCutSchema.parse(input),
    index = buildElementIndex(design),
    seen = new Set<string>();
  const files: ZipEntry[] = [],
    encoder = new TextEncoder(),
    sheet: Ring[] = [],
    labels: string[] = [],
    pieces = [];
  let x = 5,
    y = 5,
    rowHeight = 0,
    sheetWidth = options.sheetWidth;
  for (const entry of design.sequence) {
    if (entry.kind !== 'element' || seen.has(entry.elementId)) continue;
    seen.add(entry.elementId);
    const ref = index.get(entry.elementId),
      el = getElement(design, ref);
    if (!el || !ref || el.type !== 'applique') continue;
    const shape = design.shapes[ref.shapeId];
    if (shape.hidden || !design.threads[el.threadId]) continue;
    const width = Math.max(0.5, num(resolveParams(el, design.fabric, design.fabricProfile), 'width', 3));
    if (Math.abs(options.allowance) >= width / 2)
      throw new Error(
        `${shape.name}: cutting allowance must be smaller than half the cover width (${width / 2} mm).`,
      );
    const base = makeValid(flattenGeom(shape.geom, 0.03).rings, shape.geom.fillRule);
    const cut = offset(base, -width / 2 + options.allowance);
    if (!cut.length) throw new Error(`${shape.name}: no fabric remains at this cut offset.`);
    for (const poly of cut) {
      if (pieces.length >= 250) throw new Error('Cutting packages are limited to 250 pieces.');
      const bounds = polyShapeBBox([poly]),
        w = bounds.maxX - bounds.minX,
        h = bounds.maxY - bounds.minY;
      if (!Number.isFinite(w + h) || w <= 0 || h <= 0) throw new Error('Invalid cutting bounds.');
      const rings = [poly.outer, ...poly.holes].map((r) =>
        Float64Array.from(r, (v, i) =>
          i % 2 ? v - bounds.minY : options.mirror ? bounds.maxX - v : v - bounds.minX,
        ),
      );
      const number: number = pieces.length + 1,
        name = `piece-${String(number).padStart(3, '0')}`;
      files.push(
        { name: `${name}.svg`, data: encoder.encode(cuttingSvg(rings, w, h)) },
        { name: `${name}.dxf`, data: encoder.encode(cuttingDxf(rings)) },
      );
      if (x + w + 5 > sheetWidth && x > 5) {
        x = 5;
        y += rowHeight + 10;
        rowHeight = 0;
      }
      sheetWidth = Math.max(sheetWidth, w + 10);
      sheet.push(...rings.map((r) => Float64Array.from(r, (v, i) => v + (i % 2 ? y : x))));
      labels.push(
        `<text x="${round(x + w / 2)}" y="${round(y + h / 2)}" text-anchor="middle" font-family="sans-serif" font-size="3" fill="#c23b45">${number}</text>`,
      );
      pieces.push({
        number,
        name: shape.name,
        shapeId: shape.id,
        elementId: el.id,
        threadId: el.threadId,
        svg: `${name}.svg`,
        dxf: `${name}.dxf`,
        widthMm: round(w),
        heightMm: round(h),
        holes: poly.holes.length,
        sourceBounds: bounds,
        sheetPositionMm: [round(x), round(y)],
        precut: el.params.precut === true,
      });
      x += w + 10;
      rowHeight = Math.max(rowHeight, h);
    }
  }
  if (!pieces.length) throw new Error('The sewing sequence has no visible appliqué pieces.');
  const height = y + rowHeight + 5,
    svg = cuttingSvg(sheet, sheetWidth, height),
    layout = svg.replace('</svg>', labels.join('') + '</svg>');
  const manifest = {
    version: 1,
    design: design.name,
    units: 'mm',
    options,
    sheetSizeMm: [round(sheetWidth), round(height)],
    pieces,
  };
  const instructions = `LumaStitch appliqué cutting package\n\nNumbered pieces follow the current sewing sequence. Individual SVG/DXF files contain only closed cut contours, including holes. sheet.svg and sheet.dxf arrange pieces with 10 mm gaps; layout.svg adds numbers for reference only (do not send labels to a cutter). SVG dimensions are millimetres. DXF uses INSUNITS=4 (mm), CUT-layer closed polylines, and +y up. Confirm dimensions in the cutter application; disable automatic fit/scale.\n\nThe nominal fabric edge is the placement centerline, half the cover width inside the artwork boundary. Allowance offsets that edge; positive values enlarge fabric and shrink holes. Mirroring flips each patch horizontally, for backing-side cutting, without changing the sewing design. Patch allowance is independent of stitch pull compensation. Re-export after changing geometry or cover width.\n\nUse the placement stop to position the patch. Enable Pre-cut fabric on appliqué objects to omit the trimming stop after tack-down. Omit covered satin removes only edges fully covered by later appliqué fabric; it leaves placement/tack-down complete. source.lumastitch preserves the sewing design and cutting settings. These are geometry exports, not cutter-specific machine commands. Verify a sample's cut size and registration before production.\n`;
  files.push(
    { name: 'sheet.svg', data: encoder.encode(svg) },
    { name: 'sheet.dxf', data: encoder.encode(cuttingDxf(sheet)) },
    { name: 'layout.svg', data: encoder.encode(layout) },
    { name: 'manifest.json', data: encoder.encode(JSON.stringify(manifest, null, 2)) },
    { name: 'README.txt', data: encoder.encode(instructions) },
    {
      name: 'source.lumastitch',
      data: encoder.encode(serializeProject({ ...design, appliqueCut: options })),
    },
  );
  return { archive: zipFiles(files), manifest, layout };
}
