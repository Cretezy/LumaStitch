# LumaStitch

Open-source, browser-based machine embroidery digitizer. Import an SVG or an image, auto-digitize it, adjust stitches per object, simulate the stitch-out, and export a `.pes` file for Brother and Baby Lock machines (DST, JEF, EXP and VP3 are also available, plus a PNG preview, SVG geometry, a PDF production worksheet and an MP4/WebM stitch-out video).

- Runs entirely in your browser. There is no account and no backend, and designs never leave your computer.
- Designs are kept in a local project library (IndexedDB) and can be saved as `.lumastitch` project files.
- The preview, the simulator and the export all come from the same stitch plan, so what you see is what gets sewn.

Specification: [SPEC.md](./SPEC.md) · Architecture: [ARCHITECTURE.md](./ARCHITECTURE.md) · Licence: GPL-3.0-or-later ([LICENSE](./LICENSE), [NOTICE.md](./NOTICE.md))

## Development

Requires Node 22.12 or newer.

```bash
npm install
npm run dev          # Vite dev server
npm test             # unit tests (Node) + browser tests (Chromium via Playwright)
npm run e2e          # end-to-end tests against a production build
npm run build        # type-check + production build into dist/
```

Browser tests need Playwright's Chromium once: `npx playwright install chromium`.

## Deployment (Cloudflare Workers static assets)

`dist/` is served by Cloudflare Workers static assets (see `wrangler.jsonc`; there is no Worker script). A push to `main` deploys in one of two ways:

- **GitHub Actions** (`.github/workflows/ci.yml`): add the repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`; after the tests pass, the `deploy` job runs `npx wrangler deploy`.
- **Workers Builds**: connect the GitHub repository in the Cloudflare dashboard:

- Build command: `npm ci && npm test && npm run build`
- Deploy command: `npx wrangler deploy`
- Non-production branches: `npx wrangler versions upload` for preview URLs

`public/_headers` sets long-lived caching for hashed assets and a strict Content-Security-Policy. `npx wrangler dev` serves `dist/` the way production does.

## Layout

| Path                      | What                                                                                                           |
| ------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `src/model`               | Document types, factories, invariants, zod schema and migrations                                               |
| `src/store`               | Zustand stores (document with undo, UI, plan), commands and app actions                                        |
| `src/geom`                | Geometry kernel: flattening, Clipper2 wrapper, scanlines, medial axis, Paper.js adapter                        |
| `src/engine`              | Pure stitch engine (runs in a Web Worker): stitch types, sequencer, auto-digitize analysis, sequence optimiser |
| `src/raster`              | Image digitizer (quantise, clean, trace with Potrace) in its own worker                                        |
| `src/io`                  | SVG import, PES writer/reader, project files, exports                                                          |
| `src/threads`             | Colour maths (CIELAB, ΔE2000), thread charts, k-means                                                          |
| `src/canvas`, `src/tools` | Canvas layers, stitch renderer, editing tools                                                                  |
| `src/simulator`           | Stitch-out playback                                                                                            |
| `src/components`          | React UI (shadcn/ui + Radix)                                                                                   |
| `tests/`                  | Fixtures (SVG, PES goldens), integration tests, pyembroidery tools                                             |

## Physical sew tests

Results of sew tests on the reference machine (Brother SE600) are recorded in [docs/sew-tests.md](./docs/sew-tests.md).
