// SPDX-License-Identifier: GPL-3.0-or-later
/** Render actual stitch-plan segments, not an artist's approximation of the routes. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
const before = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const after = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const dir = process.argv[4] ?? 'docs/routing';
mkdirSync(dir, { recursive: true });
for (const [name, data] of [
  ['before', before],
  ['after', after],
]) {
  writeFileSync(
    join(dir, name + '.json'),
    JSON.stringify(
      data.map(({ jumpSegments, stitchSegments, ...metrics }) => metrics),
      null,
      2,
    ) + '\n',
  );
}
const names = ['connected-grid', 'open-strokes-12', 'scale-128', 'long-edge-joins'];
const parts = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1380" viewBox="0 0 1000 1380">',
  '<rect width="1000" height="1380" fill="#f8fafc"/>',
  '<g font-family="system-ui,sans-serif" fill="#172033"><text x="28" y="36" font-size="23" font-weight="700">Routing: actual stitch plans before / after</text>',
  '<text x="28" y="62" font-size="14">Blue = stitches (including underpaths). Dashed red = jumps. All geometry is in mm.</text>',
];
const fmt = (x) => x.toFixed(1);
for (let row = 0; row < names.length; row++) {
  const a = before.find((x) => x.name === names[row]);
  const b = after.find((x) => x.name === names[row]);
  const bounds = a.bounds;
  const scale = Math.min(
    430 / Math.max(1, bounds.maxX - bounds.minX),
    215 / Math.max(1, bounds.maxY - bounds.minY),
  );
  for (const [col, data, label] of [
    [0, a, 'Before'],
    [1, b, 'After'],
  ]) {
    const x = 28 + col * 494,
      y = 92 + row * 319;
    parts.push(
      `<rect x="${x - 12}" y="${y - 14}" width="472" height="304" rx="10" fill="white" stroke="#dce2ec"/>`,
      `<text x="${x}" y="${y + 9}" font-size="17" font-weight="650">${label}: ${data.name}</text>`,
      `<text x="${x}" y="${y + 32}" font-size="13">Jumps ${fmt(data.jumpMm)} mm · trims ${data.trims} · travel ${fmt(data.travelMm)} mm</text>`,
    );
    const ox = x + 215 - (scale * (bounds.maxX + bounds.minX)) / 2;
    const oy = y + 168 - (scale * (bounds.maxY + bounds.minY)) / 2;
    const d = (lines) =>
      lines
        .map(
          ([ax, ay, bx, by]) =>
            `M${fmt(ax * scale + ox)},${fmt(ay * scale + oy)}L${fmt(bx * scale + ox)},${fmt(by * scale + oy)}`,
        )
        .join('');
    parts.push(
      `<path d="${d(data.stitchSegments)}" fill="none" stroke="#2c6d99" stroke-width="0.8" opacity="0.78"/>`,
      `<path d="${d(data.jumpSegments)}" fill="none" stroke="#d43c4b" stroke-width="1.5" stroke-dasharray="4 3"/>`,
    );
  }
}
parts.push('</g></svg>');
writeFileSync(join(dir, 'comparison.svg'), parts.join('\n') + '\n');
const rows = before.map((a, i) => {
  const b = after[i];
  return `| ${a.name} | ${a.colorChanges} → ${b.colorChanges} | ${a.trims} → ${b.trims} | ${fmt(a.jumpMm)} → ${fmt(b.jumpMm)} | ${fmt(a.travelMm)} → ${fmt(b.travelMm)} | ${fmt(a.medianMs)} → ${fmt(b.medianMs)} |`;
});
writeFileSync(
  join(dir, 'table.md'),
  '| Fixture | Colour changes | Trims | Jump mm | Travel mm | Median ms |\n| --- | ---: | ---: | ---: | ---: | ---: |\n' +
    rows.join('\n') +
    '\n',
);
