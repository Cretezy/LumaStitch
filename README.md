<div align="center">

<img src="public/favicon.svg" alt="" width="72" height="72">

# LumaStitch

**Turn SVGs and images into machine embroidery, right in your browser.**

Import artwork, auto-digitize it, fine-tune every stitch, watch the stitch-out, and export a `.pes` file for Brother and Baby Lock machines.

### [Open LumaStitch →](https://lumastitch.cretezy.com)

No account · No upload · Works offline · Free and open source (GPL-3.0)

<br>

<img src="docs/screenshots/editor.webp" alt="The LumaStitch editor showing a digitized mountain badge in realistic thread view, with the fill settings of the selected shape in the inspector" width="100%">

</div>

## Features

<img src="docs/screenshots/stitch-out.webp" alt="Animated stitch-out of the mountain badge" width="320" align="right">

- **Import SVG or images.** SVGs from Illustrator, Inkscape, Figma and friends keep their shapes, holes and transforms. PNG, JPG and WebP artwork is reduced to thread colours and traced into editable shapes.
- **Auto-digitize.** Every shape gets a sensible stitch type (tatami fill, satin columns, running stitch) and a thread colour, sewn in an optimised order with few trims.
- **Optimize stitch routes.** Exact small-route ordering, precedence-aware colour sequencing and an optional intersection router for running/bean networks. [Measured before/after and Ink/Stitch comparison](docs/routing/README.md).
- **Edit like a vector app.** Select, move, scale, rotate and edit nodes; draw shapes; combine them with booleans; set stitch angle, density, underlay, compensation and start/end points per shape.
- **Many stitch types.** Tatami, satin, contour, meander, ripple, gradient and pattern fills, cross-stitch, appliqué, triple run, bean, motif and blanket stitches.
- **What you see is what gets sewn.** The canvas, the simulator and every export come from the same stitch plan, with realistic thread rendering.
- **Simulator.** Play the stitch-out at machine speed or faster, step stitch by stitch, and jump between colours.
- **Export.** Brother PES (v1 and v6), DST, JEF, EXP and VP3, plus a PNG preview, SVG geometry, a printable PDF worksheet and an MP4/WebM stitch-out video.
- **Private by design.** Everything runs in your browser. Designs are saved in a local library (IndexedDB), never on a server, and can be backed up as `.lumastitch` files.

<br clear="right">

## Screenshots

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/image-import.webp" alt="Image import: a flower PNG reduced to five thread colours, with the original and the traced preview side by side"><p align="center"><sub><b>Image import</b>: colours reduced to threads, background left unstitched</sub></p></td>
    <td width="50%"><img src="docs/screenshots/simulator.webp" alt="The simulator part-way through the mountain badge, with the colour timeline below the canvas"><p align="center"><sub><b>Simulator</b>: the stitch-out in sewing order, with a colour timeline</sub></p></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/export.webp" alt="The export dialog for a PES file, showing the machine label, PES version and how each thread colour maps to the machine palette"><p align="center"><sub><b>Export</b>: PES with the colours the machine will show, plus checks</sub></p></td>
    <td width="50%"><img src="docs/screenshots/library.webp" alt="The home screen with the project library showing two designs"><p align="center"><sub><b>Library</b>: designs saved automatically in your browser</sub></p></td>
  </tr>
</table>

## Supported formats

| Direction | Formats                                                                                       |
| --------- | --------------------------------------------------------------------------------------------- |
| Import    | SVG, PNG, JPG, WebP, `.lumastitch` projects; `.pes` files open in a read-only viewer          |
| Machine   | Brother/Baby Lock PES (v1, v6), Tajima DST, Janome JEF, Melco EXP, Pfaff/Husqvarna Viking VP3 |
| Other     | PNG preview, SVG geometry, PDF production worksheet, MP4/WebM stitch-out video                |

The PES, DST, JEF, EXP and VP3 writers are byte-for-byte ports of [pyembroidery](https://github.com/EmbroidePy/pyembroidery), checked against it in the test suite. Results of sewing on a real machine (Brother SE600) are recorded in [docs/sew-tests.md](./docs/sew-tests.md).

## Documentation

- [SPEC.md](./SPEC.md): what LumaStitch does and why
- [ARCHITECTURE.md](./ARCHITECTURE.md): how it is built
- [LICENSE](./LICENSE) (GPL-3.0-or-later) and [NOTICE.md](./NOTICE.md) (third-party code and data)

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

The screenshots above are generated from a production build with `node scripts/readme-screenshots.mjs` (needs `cwebp`, `img2webp` and `ffmpeg`).

### Project layout

| Path                      | What                                                                                                           |
| ------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `src/model`               | Document types, factories, invariants, zod schema and migrations                                               |
| `src/store`               | Zustand stores (document with undo, UI, plan), commands and app actions                                        |
| `src/geom`                | Geometry kernel: flattening, Clipper2 wrapper, scanlines, medial axis, Paper.js adapter                        |
| `src/engine`              | Pure stitch engine (runs in a Web Worker): stitch types, sequencer, auto-digitize analysis, sequence optimiser |
| `src/raster`              | Image digitizer (quantise, clean, trace with Potrace) in its own worker                                        |
| `src/io`                  | SVG import, PES writer/reader, other machine formats, project files, exports                                   |
| `src/threads`             | Colour maths (CIELAB, ΔE2000), thread charts, k-means                                                          |
| `src/canvas`, `src/tools` | Canvas layers, stitch renderer, editing tools                                                                  |
| `src/simulator`           | Stitch-out playback                                                                                            |
| `src/components`          | React UI (shadcn/ui + Radix)                                                                                   |
| `tests/`                  | Fixtures (SVG, PES goldens), integration tests, pyembroidery tools                                             |

## Deployment

The app is static files served by Cloudflare Workers static assets (see `wrangler.jsonc`; there is no Worker script). Cloudflare Workers Builds deploys every push to `main`; `npm run deploy` builds and deploys by hand.

`public/_headers` sets long-lived caching for hashed assets and a strict Content-Security-Policy. `npx wrangler dev` serves `dist/` the way production does.

## Licence

LumaStitch is free software under the [GNU General Public License v3.0 or later](./LICENSE). It builds on pyembroidery, Ink/Stitch's thread palettes, Potrace, Paper.js, Clipper2 and others; see [NOTICE.md](./NOTICE.md).
