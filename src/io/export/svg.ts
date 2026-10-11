// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * SVG export of the edited geometry (SPEC FR-6.5): one <path> per visible shape, in artwork
 * stacking order, sized in millimetres. Fill and stroke use the stitch element's thread
 * colour; shapes without stitch elements keep their original artwork paint.
 */
import { geomToD, subpathKind } from '@/canvas/pathD';
import { resolveParams } from '@/engine/params/resolve';
import { flattenGeom } from '@/geom/flatten';
import { emptyBBox, extendBBox } from '@/geom/polygon';
import type { Design, Shape } from '@/model/types';

export interface SvgExportOptions {
  /** Extra space around the design bounds, mm. Default 2. */
  margin?: number;
}

/** Default stroke width for outlines without a width parameter (≈ one thread). */
const THREAD_WIDTH_MM = 0.4;

/** Escapes text for use in XML content and double-quoted attributes. */
export function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&apos;',
  );
}

/** Removes characters that are not allowed in XML 1.0 documents. */
function xmlSafe(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '');
}

/** A valid, unique XML id derived from a shape name. */
function makeId(name: string, used: Set<string>): string {
  let base = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9_.-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!base) base = 'shape';
  if (!/^[A-Za-z_]/.test(base)) base = '_' + base;
  let id = base;
  for (let k = 2; used.has(id); k++) id = `${base}_${k}`;
  used.add(id);
  return id;
}

const num = (v: number) => String(Math.round(v * 1000) / 1000).replace(/^-0$/, '0');

interface ShapePaint {
  fill: string;
  stroke: string | null;
  strokeWidth: number;
}

function paintOf(design: Design, shape: Shape): ShapePaint {
  const colorOf = (threadId: string) => design.threads[threadId]?.color ?? '#000000';
  if (!shape.fill && !shape.outline) {
    return {
      fill: shape.art.fill ?? 'none',
      stroke: shape.art.stroke ?? null,
      strokeWidth: shape.art.strokeWidth ?? THREAD_WIDTH_MM,
    };
  }
  let strokeWidth = THREAD_WIDTH_MM;
  if (shape.outline) {
    const w = resolveParams(shape.outline, design.fabric).width;
    if (typeof w === 'number' && w > 0) strokeWidth = w;
    else if (shape.art.strokeWidth && shape.art.strokeWidth > 0) strokeWidth = shape.art.strokeWidth;
  }
  return {
    fill: shape.fill ? colorOf(shape.fill.threadId) : 'none',
    stroke: shape.outline ? colorOf(shape.outline.threadId) : null,
    strokeWidth,
  };
}

/** The visible shapes of a design as an SVG document (mm units). */
export function exportSvg(design: Design, opts: SvgExportOptions = {}): string {
  const margin = opts.margin ?? 2;
  const shapes = design.zOrder.map((id) => design.shapes[id]).filter((s): s is Shape => !!s && !s.hidden);

  const bbox = emptyBBox();
  const items = shapes.map((shape) => {
    const paint = paintOf(design, shape);
    const flat = flattenGeom(shape.geom);
    const sb = emptyBBox();
    for (const r of flat.rings) extendBBox(sb, r);
    for (const p of flat.polylines) extendBBox(sb, p);
    if (Number.isFinite(sb.minX)) {
      const half = paint.stroke ? paint.strokeWidth / 2 : 0;
      extendBBox(bbox, [sb.minX - half, sb.minY - half, sb.maxX + half, sb.maxY + half]);
    }
    return { shape, paint };
  });
  if (!Number.isFinite(bbox.minX)) Object.assign(bbox, { minX: 0, minY: 0, maxX: 0, maxY: 0 });

  const x0 = bbox.minX - margin;
  const y0 = bbox.minY - margin;
  const w = Math.max(bbox.maxX - bbox.minX + margin * 2, 1);
  const h = Math.max(bbox.maxY - bbox.minY + margin * 2, 1);

  const used = new Set<string>();
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${num(w)}mm" height="${num(h)}mm" viewBox="${num(x0)} ${num(y0)} ${num(w)} ${num(h)}">`,
    `  <title>${escapeXml(xmlSafe(design.name || 'Untitled'))}</title>`,
  ];
  for (const { shape, paint } of items) {
    const guided = shape.fill?.type === 'guidedFill';
    const d = geomToD(guided ? subpathKind(shape.geom, true) : shape.geom);
    if (!d) continue;
    const name = xmlSafe(shape.name || 'Shape');
    const attrs = [
      `id="${makeId(name, used)}"`,
      `data-name="${escapeXml(name)}"`,
      `d="${d}"`,
      `fill="${escapeXml(paint.fill)}"`,
      `fill-rule="${shape.geom.fillRule}"`,
    ];
    if (paint.stroke) {
      attrs.push(
        `stroke="${escapeXml(paint.stroke)}"`,
        `stroke-width="${num(paint.strokeWidth)}"`,
        'stroke-linejoin="round"',
        'stroke-linecap="round"',
      );
    } else attrs.push('stroke="none"');
    lines.push(`  <path ${attrs.join(' ')}/>`);
    if (guided)
      lines.push(
        `  <path data-role="guide" d="${geomToD(subpathKind(shape.geom, false))}" fill="none" stroke="#008b9b" stroke-width="0.2" stroke-dasharray="1 0.6"/>`,
      );
  }
  lines.push('</svg>', '');
  return lines.join('\n');
}
