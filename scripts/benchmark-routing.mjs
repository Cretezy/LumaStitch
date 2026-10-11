// SPDX-License-Identifier: GPL-3.0-or-later
/** node scripts/benchmark-routing.mjs [source-root] [output.json]
 * To measure an old revision, copy tests/routing into its workspace and link node_modules first.
 */
import { createServer } from 'vite';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
const root = resolve(process.argv[2] ?? '.');
const server = await createServer({
  root,
  configFile: false,
  resolve: { alias: { '@': resolve(root, 'src') } },
  server: { middlewareMode: true, watch: null, hmr: false, ws: false },
});
try {
  const { measureRouting } = await server.ssrLoadModule('/tests/routing/measure.ts');
  const result = measureRouting();
  if (process.argv[3])
    writeFileSync(
      process.argv[3],
      JSON.stringify(
        process.argv.includes('--paths')
          ? result
          : result.map(({ jumpSegments, stitchSegments, ...metrics }) => metrics),
        null,
        2,
      ) + '\n',
    );
  console.table(
    result.map(({ name, colorChanges, jumps, trims, jumpMm, travelMm, medianMs }) => ({
      name,
      colorChanges,
      jumps,
      trims,
      jumpMm: jumpMm.toFixed(2),
      travelMm: travelMm.toFixed(2),
      medianMs: medianMs.toFixed(1),
    })),
  );
} finally {
  await server.close();
}
