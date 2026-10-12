// SPDX-License-Identifier: GPL-3.0-or-later
import { exportSvg } from '@/io/export/svg';
import type { Design, MultiHoopOptions } from '@/model/types';
import { fieldCorners } from './placement';

/** Immediate vector placement preview, including invalid layouts awaiting worker validation. */
export function placementPreview(design: Design, options: MultiHoopOptions): string {
  const art = exportSvg(design),
    view = art
      .match(/viewBox="([^"]+)"/)![1]
      .split(' ')
      .map(Number);
  const points = [
    [view[0], view[1]],
    [view[0] + view[2], view[1] + view[3]],
    ...(options.placements ?? []).flatMap((p) => fieldCorners(p, options.width, options.height)),
  ];
  const x = Math.min(...points.map((p) => p[0])) - 5,
    y = Math.min(...points.map((p) => p[1])) - 5,
    w = Math.max(...points.map((p) => p[0])) + 5 - x,
    h = Math.max(...points.map((p) => p[1])) + 5 - y;
  const overlay = (options.placements ?? [])
    .map((p, i) => {
      const [cx, cy] = p.center;
      return `<g transform="translate(${cx} ${cy}) rotate(${p.angle})"><rect x="${-options.width / 2}" y="${-options.height / 2}" width="${options.width}" height="${options.height}" fill="#dbeafe" fill-opacity="0.12" stroke="#234a73" stroke-width="0.4"/><rect x="${-options.width / 2 + options.margin + 0.5}" y="${-options.height / 2 + options.margin + 0.5}" width="${options.width - 2 * options.margin - 1}" height="${options.height - 2 * options.margin - 1}" fill="none" stroke="#708090" stroke-width="0.25" stroke-dasharray="1 1"/><path d="M-3 0h6M0 -3v6M0 -${options.height / 2}l-2 4h4z" fill="#234a73" stroke="#234a73" stroke-width="0.3"/></g><text x="${cx + 3}" y="${cy - 3}" font-family="sans-serif" font-size="4" fill="#234a73">${i + 1} · ${p.angle}°</text>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}"><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#fffdf6"/>${art.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')}${overlay}</svg>`;
}
