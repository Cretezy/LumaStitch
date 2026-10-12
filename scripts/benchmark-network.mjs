// SPDX-License-Identifier: GPL-3.0-or-later
import { createServer } from 'vite';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
const root = resolve('.');
const server = await createServer({
  root,
  configFile: false,
  resolve: { alias: { '@': resolve(root, 'src') } },
  server: { middlewareMode: true, watch: null, hmr: false, ws: false },
});
try {
  const { networkReferenceCases } = await server.ssrLoadModule('/tests/routing/network-reference.ts');
  writeFileSync(
    process.argv[2] ?? '/tmp/lumastitch-network-cases.json',
    JSON.stringify(networkReferenceCases(), null, 2) + '\n',
  );
} finally {
  await server.close();
}
