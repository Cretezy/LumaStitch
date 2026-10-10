import { expect, it } from 'vitest';
import { importSvg } from './index';

/** SPEC §10: import a 2 MB SVG with 2,000 paths in under 3 s. */
it('imports a ~2 MB SVG with 2,000 paths in under 3 s', () => {
  const parts: string[] = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="200mm" height="200mm" viewBox="0 0 2000 2000"><style>.a{fill:#c00}.b{fill:#036;stroke:#000;stroke-width:2}</style>',
  ];
  let rnd = 1;
  const r = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647) * 2000;
  for (let i = 0; i < 2000; i++) {
    let d = `M${r().toFixed(3)} ${r().toFixed(3)}`;
    for (let k = 0; k < 17; k++)
      d += ` C${r().toFixed(3)} ${r().toFixed(3)} ${r().toFixed(3)} ${r().toFixed(3)} ${r().toFixed(3)} ${r().toFixed(3)}`;
    parts.push(
      `<g transform="translate(${(i % 7) - 3} ${(i % 5) - 2})"><path class="${i % 2 ? 'a' : 'b'}" id="p${i}" d="${d} Z"/></g>`,
    );
  }
  parts.push('</svg>');
  const svg = parts.join('\n');
  expect(svg.length).toBeGreaterThan(1_900_000);
  const t0 = performance.now();
  const res = importSvg(svg);
  const dt = performance.now() - t0;
  console.log(
    `importSvg: ${res.shapes.length} shapes, ${(svg.length / 1e6).toFixed(2)} MB in ${dt.toFixed(0)} ms`,
  );
  expect(res.shapes.length).toBe(2000);
  expect(dt).toBeLessThan(3000);
});
