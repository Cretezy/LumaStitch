import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';
import { readdirSync, readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

/**
 * Emits sw.js: a minimal service worker that precaches every built file so the app keeps working
 * offline after its first load (SPEC §12 item 9). No network calls are made after load.
 */
function precacheServiceWorker(): Plugin {
  return {
    name: 'lumastitch-precache-sw',
    apply: 'build',
    generateBundle(_opts, bundle) {
      const files = Object.keys(bundle).filter((f) => !f.endsWith('.map'));
      // Files copied from public/ are not part of the bundle; precache them too (icons, manifest).
      const publicFiles = readdirSync(new URL('./public', import.meta.url)).filter((f) => !f.startsWith('_') && f !== 'sw.js');
      const version = `${pkg.version}-${Date.now().toString(36)}`;
      const urls = ['./', ...new Set([...files, ...publicFiles].map((f) => './' + f))];
      const source = `// Generated at build time. Precaches the app shell for offline use.
const CACHE = 'lumastitch-${version}';
const URLS = ${JSON.stringify(urls)};
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(URLS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('lumastitch-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    // Network first for the page so new deploys arrive; fall back to the cached shell offline.
    e.respondWith(fetch(req).catch(() => caches.match('./', { ignoreSearch: true, ignoreVary: true })));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true, ignoreVary: true }).then((hit) => hit || fetch(req)));
});
`;
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), precacheServiceWorker()],
  define: { 'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version) },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  worker: { format: 'es' },
  optimizeDeps: { include: ['dompurify', 'paper/dist/paper-core', 'd3-delaunay', 'clipper2-ts', 'comlink'] },
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 2000 },
});
