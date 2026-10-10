import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import { fileURLToPath, URL } from 'node:url';

const alias = { '@': fileURLToPath(new URL('./src', import.meta.url)) };

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
          exclude: ['**/*.browser.test.ts', 'node_modules/**'],
          testTimeout: 30000,
        },
      },
      {
        resolve: { alias },
        // Pre-bundle every dependency the browser tests reach: otherwise Vite discovers one mid-run
        // on a cold cache (CI), re-optimises and reloads, and the running test files fail.
        optimizeDeps: {
          include: [
            'clipper2-ts',
            'comlink',
            'd3-delaunay',
            'dompurify',
            'esm-potrace-wasm',
            'idb-keyval',
            'immer',
            'mediabunny',
            'nanoid',
            'paper/dist/paper-core',
            'zod',
            'zustand',
          ],
        },
        test: {
          name: 'browser',
          include: ['src/**/*.browser.test.ts', 'tests/**/*.browser.test.ts'],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: 'chromium' }],
          },
          testTimeout: 30000,
        },
      },
    ],
  },
});
