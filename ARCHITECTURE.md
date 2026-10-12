# LumaStitch — Architecture

Status: **Draft v0.2** · 2026-10-10 · Companion doc: [SPEC.md](./SPEC.md) · Licence: GPL-3.0-or-later

## 1. Principles

1. **Client-only static SPA.** There is no backend. It is served as static assets from Cloudflare Workers (§23) and works offline after load.
2. **One source of truth.** The document is plain, serialisable JSON with no class instances, with all geometry in millimetres. Every change goes through commands, which provide undo/redo.
3. **Stitches are derived data.** `StitchPlan = buildPlan(Design)`. The plan is never edited directly and never persisted; it is regenerated on load. A future manual-stitch type would be just another stitch type whose parameters hold points.
4. **One plan feeds everything.** The preview, simulator, stats and exporter all read the same `StitchPlan`. This is how the "WYSIWYG" goal (G3) is met.
5. **Pure engine.** The stitch engine is TypeScript with no DOM or React. It runs in a Web Worker and is unit-tested in Node.
6. **Adapters around third-party geometry.** Paper.js and Clipper are only touched from `src/geom/`.
7. **Registries for extension.** Stitch types, export formats and thread charts are registered, not hard-coded.

## 2. Tech stack

| Concern                   | Choice                                                                                                                         | Why                                                                                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Build                     | **Vite** + **TypeScript** (strict)                                                                                             | Simple and fast; native worker support (`new Worker(new URL(...), { type: 'module' })`).                                                                      |
| UI                        | **React** + **Tailwind CSS v4** + **shadcn/ui** (Radix) + lucide-react                                                         | Requested stack; accessible primitives.                                                                                                                       |
| State                     | **Zustand** + **Immer**                                                                                                        | Minimal boilerplate. Usable outside React (tools, worker bridge). Structural sharing makes undo snapshots cheap.                                              |
| Vector geometry (editing) | **Paper.js** (`paper-core`, no view)                                                                                           | Booleans that preserve curves, Bézier maths, path-data parsing including arcs, nearest-point helpers.                                                         |
| Polygon ops (engine)      | **Clipper2** TypeScript port (`clipper2-ts`; alternatives `clipper2-js` or `clipper2-wasm`)                                    | Robust integer offset, union, difference and intersection on flattened polygons. Port to be chosen in the M0 spike.                                           |
| Medial axis               | **d3-delaunay**                                                                                                                | Voronoi-based skeleton for satin rails and width analysis.                                                                                                    |
| Image tracing             | **potrace** as WASM (`esm-potrace-wasm`; the approach used by Google's SVGcode). Fallback: imagetracerjs.                      | Best-quality bitmap-to-Bézier tracing. GPL-2.0-or-later, which is compatible with our licence. Quantisation, filtering and morphology are our own TypeScript. |
| Hosting                   | **Cloudflare Workers static assets** + Wrangler                                                                                | Requested. Static assets only, no Worker script.                                                                                                              |
| Worker RPC                | **Comlink**                                                                                                                    | Typed async calls; transfers typed arrays without copying.                                                                                                    |
| Sortable lists            | **dnd-kit**                                                                                                                    | Sequence panel.                                                                                                                                               |
| SVG sanitising            | **DOMPurify** (SVG profile)                                                                                                    | SVG files are untrusted input.                                                                                                                                |
| Storage                   | **idb-keyval** (IndexedDB)                                                                                                     | Autosave and recent projects.                                                                                                                                 |
| Schema                    | **zod**                                                                                                                        | Validating project files and migrations.                                                                                                                      |
| Tests                     | **Vitest** (Node, plus browser mode via Playwright for DOM/canvas code), **fast-check** (property tests), **Playwright** (e2e) |                                                                                                                                                               |
| Lint/format               | ESLint + Prettier                                                                                                              |                                                                                                                                                               |

**Rejected alternatives**

- **Python backend running pyembroidery or Ink/Stitch.** Needs a server, which hurts offline use and privacy. Ink/Stitch is also tied to Inkscape (`inkex`).
- **Pyodide running Ink/Stitch in the browser.** Tens of MB to download (Shapely, NetworkX, lxml), slow start-up, and still tied to `inkex`.

**Ink/Stitch as a reference.** LumaStitch is GPL-3.0-or-later, so Ink/Stitch's stitch algorithms (fill routing, satin, underlay, auto-satin and others) can be **ported to TypeScript** directly, not just studied. Ported files keep the original copyright notice, a link to the source file and commit, and an SPDX header. The same applies to pyembroidery (MIT) for PES, and to Ink/Stitch's thread palettes.

- **Fabric.js or Konva for the canvas.** Their object models would duplicate ours, and their node editing is weak. We render ourselves: an SVG overlay for editing plus Canvas2D for stitches.
- **WebGL renderer.** Not needed for the v1 targets. Revisit for Realistic mode above about 200k stitches.

## 3. System overview

```
┌──────────────────────────────── Main thread ─────────────────────────────────┐
│ React UI (shadcn)                                                            │
│  MenuBar · Toolbar · ToolPalette · Inspector · SequencePanel · Threads       │
│  CanvasView = [Canvas2D: grid] [SVG: shapes] [Canvas2D: stitches]            │
│               [SVG: editing overlay]                                         │
│        ▲ render                                │ pointer / keys → tools      │
│        │                                       ▼                             │
│ Zustand: documentStore (undoable) · uiStore (selection, tool, viewport,      │
│          view options, simulator) · planStore (latest StitchPlan, status)    │
│        │ design + revision (debounced)          ▲ StitchPlan (transferable)  │
│ geom/paperAdapter (booleans, node ops)          │                            │
└────────┼────────────────────────────────────────┼────────────────────────────┘
         ▼                                        │
┌──────────────────────────── Engine worker (Comlink) ─────────────────────────┐
│ resolve params → prepare (cached) → route (cached) → sequencer → postprocess │
│ auto-digitize analysis · sequence optimiser · diagnostics                    │
└──────────────────────────────────────────────────────────────────────────────┘
┌──────────────────────────── Raster worker (Comlink) ─────────────────────────┐
│ resample → filter → k-means (Lab) → masks → morphology → potrace (WASM)      │
└──────────────────────────────────────────────────────────────────────────────┘
      StitchPlan ──► stitch renderer · simulator · stats · PES writer
```

## 4. Repository layout

```
lumastitch/
├─ SPEC.md  ARCHITECTURE.md  LICENSE (GPL-3.0)  NOTICE.md (third-party attributions)
├─ index.html  vite.config.ts  tsconfig.json  components.json  wrangler.jsonc
├─ public/_headers        # cache + security headers for Workers static assets
├─ src/
│  ├─ main.tsx  App.tsx
│  ├─ model/              # Design types, factories, invariants, zod schema, migrations
│  ├─ store/              # documentStore (commands, history), uiStore, planStore
│  │  └─ commands/        # importSvg, transformShapes, booleanOp, setParams, reorder, autoDigitize…
│  ├─ geom/               # PURE except paperAdapter
│  │  ├─ types.ts         # Ring, PolyShape, Polyline
│  │  ├─ flatten.ts       # PathGeom → rings/polylines (no Paper, worker-safe)
│  │  ├─ clipper.ts       # offset/union/difference/intersection/makeValid
│  │  ├─ paperAdapter.ts  # PathGeom ⇄ paper.CompoundPath; booleans; node ops (main thread)
│  │  ├─ polyline.ts      # length, resample, nearest point, split, normals
│  │  ├─ polygon.ts       # area, bbox, centroid, contains, min-area rect, PCA
│  │  ├─ scanline.ts      # rows at angle/spacing → intervals
│  │  ├─ medialAxis.ts    # Voronoi skeleton, radii, pruning, diameter path
│  │  └─ matrix.ts
│  ├─ engine/             # PURE TS, no DOM; runs in worker and in Node tests
│  │  ├─ types.ts         # StitchRun, StitchPlan, flags, Diagnostic
│  │  ├─ registry.ts      # stitch type registry
│  │  ├─ params/          # ParamDef, defaults, fabric presets, resolveParams
│  │  ├─ stitches/        # running/ satin/ zigzag/ tatami/ contour/  (one folder per type)
│  │  ├─ underlay/        # fill + satin underlays
│  │  ├─ sequence/        # connectors, ties, trims, colour blocks, optimiser
│  │  ├─ postprocess.ts
│  │  ├─ plan.ts          # buildPlan(design, cache)
│  │  ├─ cache.ts
│  │  └─ autodigitize/    # colour clustering, classify, angle choice, rails, config.ts
│  ├─ raster/             # image digitizer: resample, filter, quantise, masks, morphology,
│  │                      #   potrace wrapper, line-art skeleton (pure TS + WASM, worker-only)
│  ├─ worker/             # engine.worker.ts · raster.worker.ts (Comlink expose) · clients
│  ├─ io/
│  │  ├─ svg-import/      # sanitize, units, transforms, styles, shapes → PathGeom
│  │  ├─ pes/             # pesWriter, pecEncoder, thumbnails, pecPalette, pesReader
│  │  ├─ formats/         # P2 machine formats: dst, jef, exp, vp3 (+ shared encoder)
│  │  ├─ export/          # format registry, validation
│  │  └─ project/         # save/open/autosave, migrations
│  ├─ threads/            # charts/*.json (generated from Ink/Stitch .gpl), colour math, nearest, k-means
│  ├─ library/            # local project library (IndexedDB), thumbnails, My threads
│  ├─ canvas/             # viewport, CanvasView, layers, stitchRenderer, hit index
│  ├─ tools/              # select, directSelect, pen, rect, ellipse, hand, zoom, angle, entryExit, satinDirection
│  ├─ simulator/          # playback controller, progress renderer, Timeline
│  ├─ components/         # panels, dialogs, inspector forms
│  │  └─ ui/              # shadcn-generated
│  └─ lib/                # ids (nanoid), hash, keymap, misc
├─ tests/
│  ├─ fixtures/svg/       # importer + auto-digitize fixtures
│  ├─ fixtures/pes/       # golden files generated with pyembroidery
│  └─ tools/              # python scripts to generate goldens / cross-check (dev only)
└─ e2e/
```

## 5. Units and coordinate systems

| Space          | Definition                                                                                                                                                                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Document**   | Millimetres, float64. +x right, **+y down** (same as SVG and PES). Imports are centred on the origin (0, 0), but the position has no meaning for export because machines centre the design. There is no hoop or artboard.                        |
| **Angles**     | Stored and shown in degrees, counter-clockwise from +x as seen on screen (Illustrator/Wilcom convention). Because y points down, the engine negates angles when building rotation matrices. This is done in one helper, `rotationFor(angleDeg)`. |
| **Screen**     | CSS px. Viewport `{ zoom: px per mm, pan: [x, y] }`, with `screen = doc · zoom + pan`. Canvas backing stores are scaled by `devicePixelRatio`.                                                                                                   |
| **PES**        | Integer units of 0.1 mm. `u = Math.round(mm · 10)`. Deltas are computed from the rounded absolute positions, so rounding never accumulates.                                                                                                      |
| **SVG import** | User units are converted to mm using the root `width`/`height` and `viewBox`. Unitless or px values are taken at 96 dpi (`25.4 / 96` mm per px).                                                                                                 |
| **Tolerances** | Curve flattening uses 0.05 mm chord error. Clipper scale is ×1000 (1 µm integer units). Geometric epsilon is 1e-6 mm.                                                                                                                            |

## 6. Document model (`src/model`)

```ts
export type Id = string; // nanoid
export type Vec2 = [x: number, y: number]; // mm

/** Bézier node in the style of Paper.js segments. Handles are relative to `p`. */
export interface Node {
  p: Vec2;
  in?: Vec2;
  out?: Vec2;
  smooth?: boolean;
}
export interface Subpath {
  closed: boolean;
  nodes: Node[];
}
export interface PathGeom {
  subpaths: Subpath[];
  fillRule: 'nonzero' | 'evenodd';
}

export interface Shape {
  id: Id;
  name: string;
  geom: PathGeom; // absolute mm, transforms baked in
  hidden?: boolean;
  locked?: boolean;
  art: { fill?: string; stroke?: string; strokeWidth?: number }; // original paint (artwork view, auto-digitize)
  fill: StitchElement | null; // always null if the shape has no closed subpath
  outline: StitchElement | null;
}

export type FillType = 'tatami' | 'satinFill' | 'contour';
export type OutlineType = 'running' | 'triple' | 'satin' | 'zigzag';
export type StitchType = FillType | OutlineType;
export type ParamValue = number | boolean | string;

export interface StitchElement {
  id: Id;
  role: 'fill' | 'outline';
  type: StitchType;
  threadId: Id;
  params: Record<string, ParamValue>; // overrides only (see §11.3)
  entry?: Vec2; // user entry point; engine snaps it to the geometry
  exit?: Vec2; // user exit point
  guides?: [Vec2, Vec2][]; // satin direction lines (rungs); type-specific
  railSplit?: [number, number]; // satinFill: outline params where rails split
  tieIn: 'auto' | 'on' | 'off';
  tieOut: 'auto' | 'on' | 'off';
  trimAfter: 'auto' | 'always' | 'never';
  userEdited?: boolean; // set on manual change; auto-digitize can skip
}

export interface Thread {
  id: Id;
  name: string;
  color: string;
  chart?: string;
  code?: string;
}

export type SequenceEntry = { kind: 'element'; elementId: Id } | { kind: 'stop'; id: Id; note?: string };

export interface Design {
  schemaVersion: 1;
  name: string;
  fabric: FabricId; // no hoop: design size = bounds of its shapes
  fabricColor?: string; // '#rrggbb'; default DEFAULT_FABRIC_COLOR (canvas and exports on fabric)
  threadChart: string;
  settings: DesignSettings; // see SPEC §8.8
  threads: Record<Id, Thread>;
  shapes: Record<Id, Shape>;
  zOrder: Id[]; // artwork stacking, bottom → top
  sequence: SequenceEntry[]; // sewing order
  artwork?: Artwork;
}

export type Artwork = { matrix: Matrix; visible: boolean; opacity: number } & (
  | { kind: 'svg'; svg: string } // sanitised SVG text
  | { kind: 'image'; dataUrl: string; pxWidth: number; pxHeight: number; trace: TraceSettings }
);
// TraceSettings = { colors: number | 'auto'; palette: PaletteEdit[]; background: 'auto' | 'none' | string;
//                   detail: number; smoothness: number; lineArt: boolean }  — kept so a re-trace is reproducible
```

**Resizing the design** (`resizeDesign(width?, height?)`) applies `transformShapes(allShapeIds, scaleAboutCentre)` and scales the artwork matrix to match. Stitches are regenerated, so density is preserved.

**Two orders.** `zOrder` is how the artwork _looks_ when layered. It drives artwork-view rendering, overlap removal and the auto-digitizer's ordering constraints. `sequence` is how the design is _sewn_. Import initialises both from SVG paint order. "Bring to front" changes only `zOrder`; reordering the Sequence panel changes only `sequence`. In stitch views, what appears on top follows `sequence`, because that is physically true.

**Fill and outline live on the shape.** One geometry drives both elements, so editing a path regenerates both. The sequence gives them independent order. This is Ink/Stitch's model (fill and stroke on one element) combined with Wilcom-style sequencing.

**Invariants** (`model/invariants.ts`, asserted in dev builds and after loading):

- Every element appears exactly once in `sequence`, and `sequence` only references elements that exist.
- `zOrder` is a permutation of the shape ids.
- Every `threadId` exists in `threads`.
- A shape with no closed subpath has `fill === null`.

A memoised selector builds an `elementId → { shapeId, role }` index.

**Transforming a shape** (`transformShapes(ids, matrix)`) bakes the matrix into node anchors and handles. It also transforms `entry`, `exit`, `guides` and `railSplit` points, adds the matrix's rotation to angle parameters (`angle`, and `underlayAngle` if overridden), and scales width parameters when the "scale stroke widths" preference is on.

## 7. State management (`src/store`)

| Store           | Contents                                                                                                             | Undoable | Persisted                  |
| --------------- | -------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------- |
| `documentStore` | `design`, `past[]`, `future[]`, `revision`                                                                           | yes      | IndexedDB autosave         |
| `uiStore`       | selection (shapes, elements, nodes), active tool, viewport, view options, panel state, drag preview, simulator state | no       | view prefs in localStorage |
| `planStore`     | latest `StitchPlan`, generation status, diagnostics                                                                  | no       | no                         |

**Commands.** `exec(label, recipe: (draft: Design) => void)` runs Immer `produce`, pushes the previous `design` onto `past` (structural sharing keeps this cheap), clears `future` and bumps `revision`. History is capped at 200 entries. Each history entry also stores the selection, so undo restores it.

Clipboard operations capture the document revision before awaiting browser access. Cut deletes only the originally selected editable shapes, even if selection changes while access is pending. Cut and paste cancel if the revision changes (an edit, undo/redo, close, or document load), preventing stale deletion or thread mappings from affecting newer content.

**Interactive drags.** While dragging, a transient `{ shapeIds, matrix }` (or a node delta) lives in `uiStore.dragPreview`. The overlay draws the transformed geometry, and the dragged shapes' stitches are dimmed. On pointer-up, exactly one command is executed. Escape cancels. There is no stitch regeneration mid-drag in v1.

**Command catalogue** (initial): `importSvg`, `addShape`, `deleteShapes`, `duplicateShapes`, `transformShapes`, `editNodes`, `booleanOp`, `pathOp`, `arrange`, `setElement` (type, enable/disable), `setParams`, `resetParam`, `setThread`, `upsertThread`, `reorderSequence`, `insertStop`, `removeStop`, `setEntryExit`, `setGuides`, `autoDigitize`, `optimizeSequence`, `setDesignSettings`.

**Plan regeneration.** A store subscription watches `revision` and calls `engine.buildPlan(design, revision)` after a debounce (about 80 ms). Stale results are discarded (§11.6).

## 8. SVG import (`src/io/svg-import`)

1. **Sanitise.** Read the file text and run DOMPurify with the SVG profile. This forbids `script`, `foreignObject`, `on*` attributes, and `javascript:` or external hrefs.
2. **Parse and mount.** Parse with `DOMParser`, then mount into a hidden, off-screen `<div>` in the live document. Mounting is required for `getComputedStyle` to apply `<style>` CSS rules.
3. **Root scale.** Build the `userToMm` matrix from `width`/`height` (mm, cm, in, pt, pc, px) and `viewBox`, using `preserveAspectRatio` (default xMidYMid meet).
4. **Expand and skip.** Expand `<use>` (clone the referenced node and apply its x/y). Skip `defs`, unused `symbol`, `clipPath`/`mask` contents, `marker` and `pattern`.
5. **Walk in document order** (which is paint order). For each `path | rect | circle | ellipse | line | polyline | polygon`:
   - **Matrix** = `userToMm × Π(ancestor transforms) × own transform`. Read via `transform.baseVal.consolidate()`, and include nested `<svg>` viewports. This avoids depending on layout (`getCTM`).
   - **Geometry.** Convert to path data (rect with rx/ry, ellipse to 4 cubics, and so on). Parse it with Paper (`new paper.CompoundPath(d)`, which turns arcs into cubics), apply the matrix and read the segments into a `PathGeom`.
   - **Style** (`getComputedStyle`): `fill`, `fill-rule`, `stroke`, `stroke-width` (multiplied by `sqrt(|det(matrix)|)`), the opacities, `display` and `visibility`. Colours are normalised to `#rrggbb`. `url(#gradient)` becomes the average of the stop colours, with a warning.
   - **Skip** hidden elements, fully transparent paint, and elements with no fill area and no stroke.
   - **clip-path** (P1): intersect with the clip geometry via the Paper boolean.
   - **Warn** on `text`, `image`, `filter`, `mask`, `pattern`.
6. **Name** each shape from `inkscape:label`, `data-name` (Illustrator), `id`, or tag plus index, prefixed with ancestor group names.
7. **Threads.** Create one per unique colour (exact). Mapping to a chart happens via the import option or auto-digitize.
8. **Default elements.** A closed shape with a fill gets a tatami fill element; a stroke gets a running outline element. If "Auto-digitize after import" is ticked, auto-digitize then replaces these.
9. **Place** the artwork's bounding box at the origin, scaled to the target width or height if one was given.
10. **Keep** the sanitised SVG and its matrix as the `artwork` backdrop. It is rendered via `<img src="blob:...">`, which never runs scripts.
11. **Unmount** and return `{ shapes, zOrder, threads, warnings }`.

## 9. Geometry kernel (`src/geom`)

**Representations**

- `PathGeom` (model): editable Béziers.
- `Ring = Float64Array` (`x0,y0,x1,y1,…`, implicitly closed). `PolyShape = { outer: Ring; holes: Ring[] }[]` (multi-polygon, normalised orientation). `Polyline = Float64Array` (open).

**Modules**

- `flatten.ts`: adaptive Bézier subdivision with a 0.05 mm chord tolerance. Contains no Paper code, so the worker bundle stays small and DOM-free.
- `clipper.ts`: `offset(polys, delta, join='round')`, `union`, `difference`, `intersection`, and `makeValid` (union with the fill rule, then PolyTree to outer/holes). It also offsets open paths (for the stroke-to-shape operation).
- `paperAdapter.ts` (main thread): converts `PathGeom ⇄ paper.CompoundPath`; booleans (`unite/subtract/intersect/exclude/divide`); `divideAt` for inserting nodes; nearest-point; path-data parsing; `simplify` (curve fitting). Offset path is done as flatten → Clipper offset → Paper `simplify` to refit curves.
- `scanline.ts`: rotate a polygon by −θ, intersect it with horizontal lines `y = k·s` (aligned to a global grid), and return the sorted x-intervals per row.
- `medialAxis.ts`: sample the boundary every ~0.3 mm, build the Voronoi diagram (d3-delaunay), and keep the edges whose endpoints are both inside the polygon. Each node gets a radius (its distance to the nearest site). Spurs shorter than k·radius are pruned. Returns a skeleton graph plus helpers: maximum width, width histogram, branch count, and the diameter path (longest path in the tree).
- `polyline.ts`: arc length, even resampling with corner preservation, nearest point and parameter, split at a parameter, smoothed normals, offset by per-vertex normal with a miter limit.
- `polygon.ts`: area, bounding box, centroid, point-in-polygon, convex hull, minimum-area rectangle (rotating calipers), PCA.

## 10. Canvas and editing (`src/canvas`, `src/tools`)

### 10.1 Layers (bottom to top, one shared viewport)

1. **Background** (Canvas2D): the design's fabric colour, grid, origin mark, and the design's bounding box with a W×H dimension label.
2. **Artwork backdrop**: `<img>` of the original SVG or image with a CSS transform (optional).
3. **Shapes** (SVG): one `<path>` per shape. Artwork view uses the original paint or thread colour. Stitch views use transparent fills that act as hit areas. The `d` strings are memoised by `geom` object identity, so only changed shapes re-render.
4. **Stitches** (Canvas2D): see §13.
5. **Editing overlay** (SVG): selection outlines, bounding-box handles, nodes and handles, angle/entry/exit/guide handles, marquee, pen preview, snap guides.

The SVG shape layer comfortably handles a few thousand shapes. Beyond that, a canvas fallback is a P2 item.

**Hit testing.** Shapes and handles use native SVG pointer events, with a minimum 6 px stroke hit width. Stitches are hit-tested through a uniform-grid spatial index of stitch segments, rebuilt per plan, which returns the owning element.

### 10.2 Tools

```ts
interface Tool {
  id: ToolId;
  cursor: string;
  shortcut?: string;
  onPointerDown?(e: CanvasPointerEvent, ctx: ToolContext): void;
  onPointerMove?(e: CanvasPointerEvent, ctx: ToolContext): void;
  onPointerUp?(e: CanvasPointerEvent, ctx: ToolContext): void;
  onDoubleClick?(e: CanvasPointerEvent, ctx: ToolContext): void;
  onKeyDown?(e: KeyboardEvent, ctx: ToolContext): void;
  Overlay?: React.FC; // tool-specific overlay content
}
// CanvasPointerEvent: { doc: Vec2; screen: Vec2; mods; hit: HitTarget | null; nativeEvent }
// ToolContext: { exec, ui, design, viewport, snap(pt) }
```

| Tool                     | Key               | Behaviour                                                                                                                                                                                         |
| ------------------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Select                   | V                 | Click or marquee select. Drag to move (Shift constrains the axis, Alt duplicates). Handles scale (Shift keeps proportions, Alt scales from the centre). Corner zones rotate (Shift snaps to 15°). |
| Direct select            | A                 | Node and handle editing. Double-click a segment to add a node. Delete removes nodes. Shift+C toggles smooth/corner. Alt-drag a handle breaks symmetry.                                            |
| Pen (P1)                 | P                 | Click for a corner, drag for a smooth node. Click the first node to close the path.                                                                                                               |
| Rectangle / Ellipse (P1) | M / L             | Shift for square/circle, Alt to draw from the centre.                                                                                                                                             |
| Hand / Zoom              | H, hold Space / Z |                                                                                                                                                                                                   |
| Stitch angle             | —                 | Drag across a fill to set its `angle`.                                                                                                                                                            |
| Entry / Exit             | —                 | Click to place entry or exit points on the selected element.                                                                                                                                      |
| Satin direction          | —                 | Draw guide lines and drag rail split points.                                                                                                                                                      |

Keyboard shortcuts live in one place (`lib/keymap.ts`) and are ignored while focus is in an input.

**Booleans** (`booleanOp(op, shapeIds)`): convert to Paper, run the operation, convert back. Results inherit stitch settings as described in SPEC FR-1.3. A result takes the `zOrder` slot of the topmost input (the backmost for Subtract) and the `sequence` slot of the first input's elements. New elements get fresh ids.

## 11. Stitch engine (`src/engine`)

### 11.1 Types

```ts
export const enum F {
  STITCH = 0,
  JUMP = 1,
  TRIM = 2,
  COLOR_CHANGE = 4,
  STOP = 8,
  END = 16,
  // informational only (rendering/stats); export ignores them
  TIE = 32,
  UNDERLAY = 64,
  TRAVEL = 128,
}

/** Output of one element generator: needle points in sewing order. */
export interface StitchRun {
  xy: Float64Array; // interleaved mm
  flags: Uint8Array; // per point: JUMP for internal jumps, UNDERLAY, TRAVEL, TIE
}

export interface StitchPlan {
  revision: number;
  x: Float32Array;
  y: Float32Array;
  flags: Uint8Array; // one entry per command
  element: Uint32Array; // index into elementIds
  elementIds: Id[];
  elementRanges: { elementId: Id; start: number; end: number }[];
  colorBlocks: { threadId: Id; color: string; start: number; end: number }[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  stats: {
    stitches: number;
    jumps: number;
    trims: number;
    colorChanges: number;
    stops: number;
    threadLengthMm: number;
    estSeconds: number;
  };
  diagnostics: Diagnostic[]; // { severity, code, message, elementId?, at?: Vec2 }
}
```

### 11.2 Pipeline (`buildPlan`)

```
prev = { pos: designStartPoint, thread: null }
for entry in design.sequence:
  if entry is stop → tie-off, TRIM, STOP
  else:
    el, shape  = lookup(entry)
    params     = resolveParams(el, design.fabric)                  // §11.3
    prepared   = cache(hash(type, shape.geom, params, el.guides, el.railSplit),
                       () => def.prepare(shape.geom, params, el))  // expensive: flatten, offsets, rows, rails
    hints      = { entry: el.entry ?? prev.pos, exit: el.exit ?? nextElementCentroid }
    run        = cache(prepared.key + quantize(hints, 0.5mm),
                       () => def.route(prepared, hints))           // pick start/end, order sections, emit points
    connect(prev, run.start, thread change?, trimAfter, ties)      // §11.5
    append(run)
postprocess → END
derive colorBlocks, elementRanges, bounds, stats, diagnostics
```

Splitting generation into `prepare` (heavy work that depends only on geometry and parameters) and `route` (cheap work that depends on neighbours) means reordering the sequence or moving a neighbour doesn't redo the heavy work.

### 11.3 Stitch type registry and parameters

```ts
interface StitchTypeDef<P = any, Prep = any> {
  id: StitchType;
  label: string;
  role: 'fill' | 'outline';
  params: ParamDef[]; // drives Inspector UI, defaults, validation
  defaults: P;
  aliasOf?: StitchType; // e.g. 'triple' reuses 'running' with bean = 1
  appliesTo(shape: ShapeInfo): boolean; // e.g. fills need a closed subpath
  prepare(geom: PathGeom, params: P, el: StitchElement, ctx: EngineCtx): Prep;
  route(prep: Prep, hints: { entry?: Vec2; exit?: Vec2 }, ctx: EngineCtx): StitchRun;
}

interface ParamDef {
  key: string;
  label: string;
  help?: string;
  kind: 'length' | 'number' | 'angle' | 'fraction' | 'boolean' | 'enum';
  unit?: 'mm' | '°' | '%';
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: string }[];
  group: 'basic' | 'underlay' | 'compensation' | 'advanced';
  visibleIf?: (p: Record<string, ParamValue>) => boolean;
}
```

- **Resolution**: `effective = { ...def.defaults, ...FABRIC_PRESETS[fabric][type], ...el.params }`. The Inspector shows inherited values as muted and overrides with a reset dot.
- **Adding a stitch type** means a new folder in `engine/stitches/<type>/` that exports a `StitchTypeDef`, plus one line in `registry.ts`. The Inspector form is generated from `ParamDef`s.
- `EngineCtx` = `{ settings, diag(code, msg, at?), tolerance }`.

### 11.4 Algorithms

**Multi-part fills (all fill types).** A fill whose polygon has several connected parts is sewn one part at a time, in the shortest order, each part finishing next to the following one, with a trimmed jump between parts. Tatami (and gradient and pattern fills, which share its routing) does this natively (see Tatami step 5); satin fill, contour, ripple, meander and cross-stitch are wrapped by `perPart` (`stitches/multipart.ts`), which prepares each part as its own shape and routes them in that order.

**Running / triple**

- Flatten to a polyline. Split it at corners (turn angle > 30°). Resample each piece at `n = ceil(len / L)` evenly spaced points, so no stitch is longer than `L` and stitch lengths stay even.
- Up to 12 open subpaths: an exact bitmask DP jointly chooses order and direction, minimizing endpoint jumps plus half the final exit-hint distance. It accounts for even-pass strokes ending back at their entry. Larger jobs and closed/mixed subpaths: every subpath is tried as the first one and the rest follow greedily; the order with the least jump length wins (up to 40 subpaths). A closed path ends where it starts, so its start point (a vertex inserted on the ring) is then chosen to minimise the distance from the previous path's end plus the distance to the next path; open paths start at whichever end makes that sum smaller. The same centreline ordering is the fallback for large or closed/mixed satin outlines.
- Jumps between subpaths carry `TRIM` (there is nothing to travel through; a short stitched connector would cross bare fabric or the fill), so only hops of 1 mm or less are sewn. Blanket and motif runs do the same.
- Bean repeats: each stitch a→b becomes a→b→a→b (bean = 1) or a→b→a→b→a→b (bean = 2).
- Passes: alternate forward and reverse traversal.
- **Connect intersecting paths** is an opt-in advanced running/triple parameter (`connectBranches`, default false), available for one pass. `running/network.ts` splits flattened lines at shared endpoints, crossings and collinear overlap endpoints, retaining parallel edges for intentional duplicate strokes. Each connected component is an open Chinese-postman problem: choose entry/exit vertices, find shortest paths between odd-degree vertices after toggling the endpoints, match parity defects, duplicate those shortest paths, then use Hierholzer's algorithm for an Euler walk. Matching is exact for up to 16 parity defects; above that it uses nearest-pair matching and four pair-exchange passes. Every original edge gets its full bean stitches on the final traversal; earlier traversals use single `TRAVEL` stitches. Components are visited nearest first, with one jump between components and none within them. Entry/exit hints choose the nearest graph vertices. Geometry above 1,000 input segments, 1,000 graph vertices or 3,000 edges falls back to normal path routing with a diagnostic. This operates within one element; it does not merge separate objects or cross colour changes/stops.


**Satin column (outline)**

For up to 12 open columns, generate both sewing directions with their complete underlay and solve the order/direction jointly using their actual first and last needle points. The objective is connector length plus half the exit-hint distance. This accounts for even-pass underlays returning to the starting end and for rail offsets. Larger or closed/mixed jobs retain centreline ordering, with the actual underlay pass count; the chosen open-column direction is preserved during sewing.

1. **Rails.** Resample the centreline finely (~0.2 mm). Compute smoothed normals. Then `railA/B = c ± n·(w/2 + pullComp)`, with a miter limit at sharp corners. A closed centreline gives two closed rails.
2. **Pairing.** Walk the centreline in steps of `density / 2`. Each step adds one penetration, alternating between rail A and rail B at the corresponding normalised position, which gives a zigzag with `density` peak-to-peak.
3. **Short stitches (P1).** Where the inner rail's spacing drops below about 50% of the outer rail's, alternate penetrations on the inner rail are pulled toward the centre (inset about 15–25%).
4. **Underlay**, emitted first. Centre walk: a run along the centreline. Edge walk: a run along both rails inset by `underlayInset`. Zigzag underlay: a zigzag at `zigzagUnderlaySpacing` between the inset rails. Passes alternate direction. `route` picks the starting end so the total pass count leaves the exit nearest `hints.exit`.
5. **Split satin (P1).** Stitches longer than `splitAbove` get evenly spaced intermediate penetrations, staggered between neighbouring stitches.

**Satin fill (shape)**

- **Auto-turning.** The rails are the two parts of the outer ring, split at two points. The defaults are the boundary points nearest the ends of the medial-axis diameter path; the user can override them with `railSplit`. Rail B is reversed. Correspondence comes from user `guides` (rungs) plus automatic rungs from skeleton nodes (perpendicular projections onto both rails), with arc-length interpolation between rungs. Pull compensation offsets the rails outward along their normals. From there, stitches are paired exactly like a satin column.
- **Fixed angle.** This is the fallback for holes or branches. Scanline intervals at the given angle each become one edge-to-edge stitch, sewn back and forth per section (the same section decomposition as tatami). Intervals longer than `splitAbove` are split.

**Zigzag**: the same rails as the satin column (no pull compensation) and the same pairing, with `spacing` peak-to-peak. No underlay.

**Tatami fill**

1. **Prepare.** `poly = makeValid(flatten(geom))`, then `offset(poly, +pullComp)`, then rotate by −θ so rows are horizontal.
2. **Rows.** `y_k = k·s` on a global grid, so shapes sharing an angle line up. Intersect with the polygon to get the x-intervals per row.
3. **Sections.** Sweep the rows and link each interval to the one that overlaps it in the next row, but only while the link is 1:1. A split or merge starts a new section. Each section is a strip that can be sewn back and forth in one pass.
4. **Penetrations.** In row `k`, the penetrations are `x = (j + frac(k·offset))·L` on a global grid (so the texture is uniform across sections), plus both interval endpoints. A penetration that would leave an end stitch shorter than `minStitch` is dropped.
5. **Parts.** The fill polygon's connected parts (e.g. the letters of a word set as one path) are sewn one at a time: edge run, underlay and top layer of a part, then the next. Each part has its own inside router (travel never leaves a part, and the smaller graphs are much faster). Sections are split wherever consecutive rows fall in different parts (wide underlay spacing can link rows of neighbouring letters), and wherever a long row-to-row turn (> max(1 mm, 2.5 × spacing)) doesn't follow the outline: it leaves the fill (a bar meeting a narrower ear above it), or the outline between the two row ends bulges more than half a row spacing from it (a stem meeting a wider bar, where the turn would be a diagonal across the bar). Turns along slanted or curved edges (a circle's caps) bulge far less and stay in one section, which keeps round shapes to a few sections. Part ordering uses actual flattened-ring gaps at every size, including edge-interior closest points. Up to 14 parts, Held–Karp dynamic programming gives the shortest gap-based open path; above that, deterministic multi-start nearest-neighbour seeds are improved with 2-opt and single-part relocation. Up to 64 parts use at most 16 starts, 65–300 use four, and larger jobs use one with a 32-position improvement neighbourhood. Eight improvement passes bound the work. The part nearest a requested exit is reserved for last. The gap objective is a geometric proxy, not a guarantee of minimum generated jump length. Each part is entered at its edge point nearest the current position (a short edge-to-edge jump), then inside travel to the first section; each part except the last finishes at the section nearest the next part.
6. **Ordering and travel.** Each section can start at any of its four corners (top/bottom × left/right); the exit follows from the row-count parity. Up to 10 sections in a part: an exact bitmask DP over (sections sewn, last section, start corner). Each hop's cost is the travel `travelTo` will actually sew (it mirrors its decisions: direct when short and clear, else the router's path, else trim + jump at 3× distance + 10 mm). Travel that runs over (or within 0.6 mm of) rows already sewn stays visible on top: those millimetres cost 4× extra plus 8 mm per hop; over rows sewn later it is hidden and costs only its length. Where travel would show, a trim + jump is also considered (its length + 20 mm), but only if the jump line crosses no section still to be sewn (that would lock the thread in), including the section it lands on beyond its last 1.5 mm (a jump up a letter's stem to the stem's far corner is sewn over by the stem): a cut beats a permanent line across the fill, not a small blip. The distance from the last exit to the exit hint weighs 1.0, so an outgoing jump is no longer discounted against hidden internal travel. 11 to 30 sections (letters at diagonal angles easily have 20): a beam search with the same costs (the best 64 partial orders survive each step, each extended to the 8 nearest unsewn sections; hop costs are computed lazily and memoised). More: a greedy pass (nearest few corners, re-ranked by how much of the travel would be visible). Travel between sections is a shortest path **inside** the inset polygon: a visibility graph over the Douglas–Peucker-simplified inset rings (0.3 mm), searched with A\*. Nodes, edges and the point-in-polygon test all use the same simplified rings (mixing exact and simplified geometry rejected most paths along curves); node-to-node visibility is cached across queries. **Row-to-row turns** go straight when they stay within 0.15 mm of the layer; otherwise they walk along the layer's outline between the two row ends (with points the minimum stitch length would merge dropped first, so no corner gets cut), and only fall back to the router when the walk is long. It is sewn as a `TRAVEL` running stitch. If no inside path exists, or it is more than 3× the straight-line distance, the connector becomes tie-off + trim + jump instead; the sequencer sews hops of 1 mm or less as a single stitch.
7. **Underlay**, emitted before the top layer (per part). Edge run: running stitch around `offset(poly, −inset)`. Tatami underlay: the same algorithm at θ+90°, with `underlaySpacing` and `underlayStitchLength`, on the inset polygon. The underlay exit connects to the top layer's entry by inside travel.
8. **Entry and exit.** The entry hint is where the previous element finished (or a user entry point). The exit hint is a user exit point or, when the next element uses the same thread, the point of the next shape's outline closest to this shape (`exitToward` in `plan.ts`, alternating nearest-point steps, cached per shape pair); the last part finishes at the section nearest it. A user exit point also travels to the exit. Everything is then rotated back by +θ.

**Contour fill (P1).** Repeatedly offset inward by `spacing` until empty. Resample each ring. Connect ring k to ring k+1 at their nearest points, going inner → outer.

### 11.5 Sequencer: connectors, ties and trims

For each transition from the previous element's exit E to the next element's entry S:

| Situation                                                      | Emitted                                                                               |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Same thread, `dist(E,S) ≤ trimThreshold`, `trimAfter ≠ always` | Direct stitch(es) E→S, no ties.                                                       |
| Same thread, longer distance (or `trimAfter = always`)         | Tie-off, TRIM, JUMP to S, tie-in.                                                     |
| `trimAfter = never`                                            | Stitched connector, split at the maximum stitch length. Warning if longer than 10 mm. |
| Thread changes                                                 | Tie-off, TRIM, COLOR_CHANGE, JUMP to S, tie-in.                                       |
| Stop entry                                                     | Tie-off, TRIM, STOP. The next element starts with a jump and tie-in.                  |

- **Ties.** A tie-in is 3 tiny stitches of length `tieLength` along the first segment, back, then forward again. A tie-off does the same along the last segment, reversed. `auto` means on wherever there is a trim, colour change, stop, or the start/end of the design.
- **Postprocess.** Split stitches longer than `maxStitchLength` (not jumps). Merge stitches shorter than `minStitchLength` only when removing the point deviates from the replacement segment by at most 0.01 mm (ties exempt). Preserve corners and reversals even below the minimum length so dense fill rows keep their direction. Remove zero-length duplicates. Append END.

### 11.6 Worker, caching and cancellation

```ts
interface EngineApi {
  buildPlan(design: Design, revision: number): Promise<StitchPlan | { stale: true }>;
  analyze(input: AnalyzeInput): Promise<AnalyzeResult>; // auto-digitize analysis
  optimizeSequence(design: Design, opts: OptimizeOpts): Promise<SequenceEntry[]>;
}
```

- **Transfer.** v1 sends the whole `Design` each revision (structured clone takes a few ms for typical designs). The worker diffs by hash. If profiling shows a need, switch to sending patches.
- **Caches.** Two LRUs, `prepared` and `runs`, each capped at about 2,000 entries. The key is FNV-1a/xxhash over a stable serialisation of `{type, geom, effectiveParams, guides, railSplit}` (plus quantised hints for runs).
- **Cancellation.** Every 10 ms or so the generation loop yields (`await new Promise(r => setTimeout(r))`) so newer messages are received. If a newer revision has arrived, it returns `{ stale: true }`. The main thread also ignores results whose revision is older than the current one.
- **Transferables.** The plan's typed arrays are transferred, not copied.

## 12. Auto-digitizer (`src/engine/autodigitize` + `store/commands/autoDigitize.ts`)

```
main      collect target shapes (selection or all, minus userEdited if "keep my edits")
worker    colours: merge (ΔE00 < 5), k-means in Lab if > maxColors, nearest chart thread
main      overlap removal with Paper booleans (keeps curves): for each fill bottom→top,
          subtract union(inset(fills above, overlapMargin)); split disconnected parts
          (optionally also untouched multi-part fills: "Split separate parts", off by default);
          strokes wider than maxSatin → outline-stroke into fill shapes
worker    per region: flatten, area, holes, medial axis → widths, branchiness → classify
          (SPEC §9); tatami angle from min-area rect + neighbour rule; satin railSplit
worker    sequence optimiser
main      exec('Auto-digitize', draft => apply all)  → one undo step; show summary
```

All thresholds live in `autodigitize/config.ts`. Long main-thread steps yield between shapes and report progress to the dialog.

### 12.1 Image digitizer (`src/raster`, raster worker)

This implements SPEC FR-10 and §9.1. It has its own worker, so tracing never competes with stitch generation.

```ts
interface RasterApi {
  load(bitmap: ImageBitmap, targetMm: { width?: number; height?: number }): Promise<ImageInfo>; // resample + filter, cached
  quantize(opts: QuantizeOpts): Promise<QuantizeResult>; // palette, suggested k, background guess, label-map preview
  trace(opts: TraceSettings, preview: boolean): Promise<TracedShapes>; // preview = ¼ resolution for the dialog
}
// TracedShapes = { shapes: { color: string; geom: PathGeom; lineArt?: boolean }[]; warnings: string[] }
```

**Pipeline** (each stage is cached by its inputs, so moving the detail slider doesn't re-run quantisation):

1. **Decode.** `createImageBitmap(file)` runs on the main thread and the bitmap is transferred to the worker. The worker uses `OffscreenCanvas` to resample to about 0.1 mm per px at the target size, capped at about 4 MP, and reads the result as `ImageData`.
2. **Pre-filter.** A separable bilateral filter, or a 3×3 median for speed in preview mode. Transparent pixels are marked as background.
3. **Quantise.** k-means++ in CIELAB on a pixel sample of about 50k, then full assignment into a `Uint8Array` label map. **Auto k**: run k = 2…16 and take the elbow, where the drop in within-cluster error is under 8%. **Blend absorption**: label-map pixels whose colour sits on the segment between two neighbouring clusters, and which form thin runs (2 px or less), are relabelled to the nearer of those two clusters.
4. **User palette edits** (merge, recolour, don't stitch) are applied as a label remap, which is cheap.
5. **Masks.** One bitmask per stitched label. Apply morphological open then close (radius from `detail`). Connected components (two-pass union-find) smaller than `minDetailArea` are relabelled to the neighbour sharing the longest border, and the masks are rebuilt.
6. **Trace.** potrace (`esm-potrace-wasm`) runs per mask, with `turdsize` (speckle size), `alphamax` (corner threshold) and `opttolerance` driven by `smoothness`. The SVG path output is parsed into `PathGeom` with the px → mm matrix applied.
7. **Line art (P1).** Run a distance transform on dark masks. If the maximum width is under 1.5 mm, skeletonise (Zhang–Suen), walk the skeleton into polylines, simplify (Douglas–Peucker 0.1 mm) and record the mean width. These become stroke shapes, which the vector rules map to running or satin.
8. **Hand-off.** The main thread runs `exec('Import image', …)` to create the shapes, threads (exact colours, or mapped to a chart or My threads), the `artwork` backdrop with its `TraceSettings`, and the default sequence. If auto-digitize is on, it runs with `removeOverlaps = false` and `cutoutGrowth = overlapMargin`.

**Cutout growth** happens at plan-build time, not in the stored geometry. For each fill whose `cutout` flag is set (by the image digitizer), the engine's `prepare` offsets the polygon by the overlap margin, clipped to `union(regions sewn later that touch it)`. This happens before pull compensation, so the shared seam is covered by whichever region is sewn last. The flag lives in element params (`cutoutGrowth: number`, default 0), so reordering the sequence correctly changes which side grows.

**Sequence optimiser**

1. **Precedence graph.** For each pair (a, b) of elements of different shapes with a's shape below b's in `zOrder`, add an edge a→b if their regions intersect (fill or outline, whatever the roles): a bounding-box test first, then polygon intersection area > 0.5 mm². Each shape's fill gets an edge to its own outline. So a lower shape can be finished, fill and outline, before the shape above it.
2. **Boundaries and fixed order.** Manual stops split optimization into independent segments; the stops and their notes stay in place. Unselected elements are chained in their original relative order. If this conflicts with stacking and creates a cycle, that segment is returned unchanged; constraints are never silently released.
3. **Seed and search.** A greedy topological seed starts near the design's top-left, prefers the current thread and complete colour closures, and estimates travel through bounding boxes. `sequence/routeOrder.ts` then optimizes lexicographically: colour changes first, centre-distance travel second. Up to 14 elements, a Held–Karp DP over (visited mask, last element) finds the exact optimum of that model while enforcing predecessors. Larger segments use deterministic multi-start nearest-neighbour search, 2-opt and single-node relocation, preserving precedence and accepting only improvements to the model; the original valid greedy seed remains an incumbent. Work limits are shared with multipart ordering above. Distances are symmetric and cached for up to 512 nodes.
4. **Actual stitch-plan refinement.** For segments of 2–128 elements, compare the proposed order, its reverse, the greedy seed and the original sequence, retaining only precedence-valid candidates. Prepared geometry is shared with a plan cache. Choose actual colour changes first, then `3 × jump mm + travel mm + 10 × trims`. Stop evaluating further candidates after a plan exceeds 100,000 commands. For at most 16 elements and 20,000 commands, refine the best order with adjacent colour-block swaps and same-colour neighbour swaps: at most two rounds of eight valid, distinct complete-plan evaluations. Stop early when a round makes no improvement. This corrects centre-distance errors for wide fills; it is not a global optimum of machine output. More internal travel may buy fewer trims or shorter jumps. Entry/exit joins use closest points on flattened boundary segments, including segment interiors and intersections, rather than sampled vertices.
5. **Evidence.** [Routing benchmarks](docs/routing/README.md) include full-plan before/after metrics, rendered paths, exhaustive small-route oracles and a pinned Ink/Stitch graph-algorithm comparison. Large routes, full fill routing, physical sew quality and proprietary software parity are not claimed to be globally optimal or equivalent.

## 13. Stitch rendering (`src/canvas/stitchRenderer.ts`)

- The canvas is sized to the viewport × DPR. It redraws when the plan, viewport, view options or highlight change.
- **Flat mode.** One `Path2D` per colour block (top stitches and underlay separately) is built in document units once per plan. Stitches are drawn at the real thread width (0.4 mm, plus under a pixel so neighbouring fill rows overlap; at least 2 device px), so fills read as solid areas without moiré; underlay goes first and thinner. Zoomed in (threads at least 9 px wide, so flat stays flat at export sizes), each block is stroked twice (a slightly darker or, for dark threads, lighter separation colour, then the thread colour narrower) and penetration marks are drawn, so the stitch structure stays readable. Joins are round (no miter spikes at satin turns). Jumps are a thin two-tone dashed `Path2D` (toggle), readable on light and dark threads. Needle-point dots are drawn only above a zoom threshold.
- **Realistic mode.** Each stitch is a 0.4 mm thread lit from the upper left. Per plan, a cached table gives every stitch a shade level from its angle to the light (threads across the light catch a brighter, off-centre sheen; threads along it look flatter) plus a small stable per-stitch variation, and its normal toward the light. Stitches are drawn in sewing order in small batches (so later stitches lie on top), each batch bucketed by shade level so a pass is one stroke per level: soft offset shadow, dark edge, rim, shaded body and sheen and specular lines offset toward the light; body and highlights are pulled in from both ends so stitches taper into their needle holes. Underlay is drawn first in each batch, dark and flat. The level of detail follows the on-screen thread width: threads under 1.6 px get only the shaded body, under 3.5 px a dark edge and a sheen line, wider ones (the video and PNG export sizes included) the full tube with its shadow. Off-screen stitches are skipped. In realistic view the background also gets a subtle woven-fabric texture that fades out when zoomed out.
- **Rasteriser note.** Skia's software rasteriser is up to ~8× slower when anti-aliased edges of neighbouring strokes share pixels (a 0.4 mm stroke on 0.4 mm row spacing) and for strokes under 2 px, so solid strokes are widened by under a pixel and kept ≥ 2 px.
- **Gestures.** During pan or zoom, the cached bitmap is transformed (`drawImage` with scale and offset). A full re-render happens about 120 ms after the gesture ends. This keeps 60 fps on large designs in both modes.
- **Highlight.** Selected or hovered elements get a halo, drawn into the sewing sequence just before the element's first stitch: the element covers its own halo, so it shows as an outline, and stitches sewn later still lie on top. Others can optionally be dimmed (washed out, with the highlighted elements drawn again on top).
- **Diagnostics** markers are drawn on top.
- The same functions also produce PNG export and the PES thumbnails (at low resolution).

## 14. Simulator (`src/simulator`)

- **Controller.** A `requestAnimationFrame` loop runs outside React. It holds `{ playing, speed, index (float), stopAtColorChange }` and pushes a throttled snapshot (~10 Hz) to `uiStore` for counters, the timeline and Sequence panel highlighting.
- **Speeds.** 1× equals `machineSpm / 60` stitches per second. Presets are 1×, 2×, 5×, 10×, 25× and 100×, plus "max" (as fast as frames allow).
- **Progress rendering.** An offscreen canvas holds the stitches drawn so far. Moving forward from i to j draws only the stitches (i, j]. Seeking backwards, or changing the viewport, redraws 0..j. Flat mode is fast enough to redraw 100k segments directly. Realistic mode keeps an `ImageBitmap` checkpoint every 10k stitches, invalidated when the viewport changes.
- **Overlay.** A needle crosshair at the current point, the upcoming jump drawn dashed, and the current thread swatch.
- **Timeline.** Colour-block segments proportional to stitch count, ticks for trims and stops, a draggable handle, and a hover tooltip (stitch number, element name).
- **Time model.** `t = stitches · 60 / spm + trims · trimSeconds + colourChanges · colorChangeSeconds`.

## 15. PES export (`src/io/pes`)

The reference is **pyembroidery** (MIT): `PesWriter.py`, `PecWriter.py`, `EmbThreadPec.py`. Port it carefully, keep its quirks, and credit it in file headers.

### 15.1 Pipeline

`StitchPlan` → `toMachineCommands()` produces absolute integer 0.1 mm coordinates with commands `STITCH | JUMP | TRIM | COLOR_CHANGE | STOP | END`. It then:

- rounds absolute coordinates and computes deltas from the rounded values;
- encodes a **trim** as the jump that follows it with the TRIM flag set (PEC has no standalone trim);
- encodes a **stop** as a colour change to the same thread, which repeats the palette index in the colour list;
- validates (§15.5), then writes the PES header, the PES body and the PEC section.

### 15.2 File layout (v1)

```
"#PES0001"                                 8 bytes
uint32le   pecOffset
PES body   v1 header (scale-to-fit, hoop flag 0=100×100 / 1=130×180 chosen from the design bounds, block count),
           then CEmbOne + CSewSeg blocks (absolute stitches per colour block).
           Port pyembroidery write_version_1 exactly. Its "truncated" variant
           (empty body) is available as a debug option.
PEC @pecOffset
  "LA:" + label padded to 16 + "\r"        label = design name, printable ASCII, max 8 chars as pyembroidery
  0x20 ×12, 0xFF 0x00, 0x06 (icon bytes per row), 0x26 (icon rows = 38)
  colour list:
    numColours > 0: 0x20 ×12, (numColours − 1), palette index ×numColours
    numColours = 0: 0x20 0x20 0x20 0x20 0x64 0x20 0x00 0x20 0x00 0x20 0x20 0x20 0xFF
    then 0x20 × (463 − numColours)
  stitch block:
    0x00 0x00, uint24le stitchBlockLength (from the block start), 0x31 0xFF 0xF0,
    uint16le width, uint16le height (design extents, 0.1 mm, rounded half-to-even),
    uint16le 0x01E0, uint16le 0x01B0
    encoded stitches … 0xFF                 positions are relative to (0, 0); there are no
                                            0x9000|(−minX/−minY) origin fields (pyembroidery 1.5.1)
  thumbnails: (1 + numColours) × 228 bytes  (48×38 px, 1 bit per pixel, 6 bytes per row;
                                            one for the whole design, then one per colour slot)
```

**v6** (`#PES0060`) adds a full header with hoop dimensions, design metadata and a thread table (catalogue code, RGB, description, chart/brand). Port `write_version_6`. v1's header hoop flag only distinguishes 100×100 and 130×180. Machines read the PEC section, so this is believed harmless for larger designs, but it needs to be verified on a larger-field machine when one is available. The SE600 (100×100) is unaffected.

### 15.3 Stitch encoding (PEC)

- **Per axis.** A small delta uses one byte, `d & 0x7F` (pyembroidery's short-form condition is `-64 < d < 63`). Otherwise two bytes big-endian: `0x8000 | (flag << 8) | (d & 0x0FFF)`, with `flag ∈ {0, 0x10 JUMP, 0x20 TRIM}`.
- **Jumps** write both axes in long form with a flag. pyembroidery uses JUMP for the first move and TRIM for later jumps; match it. After a jump, the first real stitch is preceded by a `(0, 0)` stitch when both deltas are non-zero, and a colour change that directly follows a jump is preceded by a `(0, 0)` stitch (pyembroidery quirks; match them).
- **Normalisation before encoding** (pyembroidery's encoder with the PES writer settings): a jump from (0, 0) to the first stitch, a jump to the first stitch after every trim or colour change, at most one trim per move, moves longer than 2047 units split into equal jumps, and STOP written as a colour change that repeats the colour slot. Coordinates are rounded half-to-even, as Python does.
- **Colour change**: `0xFE 0xB0` followed by alternating `0x02` / `0x01`. **End**: `0xFF`.
- Deltas range over ±2047 units (±204.7 mm); longer moves are split into equal jumps as above.
- The output is byte-identical to pyembroidery 1.5.1 for v1 and v6 on the golden fixtures (`tests/fixtures/pes`, generated by `tests/tools/make_goldens.py`).

### 15.4 Colours

- `pecPalette.ts` holds the 64 Brother PEC colours, from pyembroidery's `EmbThreadPec`.
- v1 maps each colour slot to a PEC index by ΔE2000; distinct colours claim distinct palette entries in order of first use (pyembroidery's own red-mean metric and `set()` order are available as `colorMatch: 'pyembroidery'` for byte-exact comparisons). The export dialog shows a "machine will display" swatch row computed with the same assignment.
- v6 also writes the real RGB values and chart codes.

### 15.5 Validation

- **Errors**: empty plan; a delta out of range after splitting; zero colours.
- **Warnings**: stitches over 12 mm; more than about 200 trims. Optional sewing-field warnings are appended independently (SPEC §7).

### 15.6 Reader and verification

- `pesReader.ts` parses the PEC stitch block (plus the v6 thread table) back into commands. It powers "Open .pes" (P1) and the tests.
- **Golden tests.** Small synthetic patterns are written by both our writer and pyembroidery (`tests/tools/make_goldens.py`, run manually; outputs committed) and compared byte for byte.
- **Round trip.** Plan → PES → read → identical command list and stats.
- **Manual checks**: open in Ink/Stitch and PE-Design or a viewer, then sew on the machine. Results go in `docs/sew-tests.md`.

### 15.7 Export registry

```ts
interface ExportFormat {
  id: string;
  ext: string;
  label: string;
  mime: string;
  kind: 'machine' | 'document';
  validate(plan: StitchPlan, design: Design): Diagnostic[];
  write(plan: StitchPlan, design: Design, opts: unknown): Uint8Array | Promise<Blob>;
}
```

Machine formats write synchronously; document formats (the PDF worksheet) are async. Registered in order: `pes` (the default), `dst`, `jef`, `exp`, `vp3`, `pdf`. Adding a format never touches the engine.

### 15.8 Other machine formats and the worksheet (P2)

- **DST, JEF, EXP, VP3** (`src/io/formats`) are ports of pyembroidery's writers. A shared encoder reproduces pyembroidery's normalisation with each writer's settings (DST: max jump/stitch 121; JEF and EXP: 127, jump to the first stitch after a trim; VP3: jumps up to 3200, stitches up to 255, stops become colour blocks because VP3 has no stop). Output is byte-identical to pyembroidery 1.5.1 on the golden patterns (`tests/fixtures/formats`, `tests/tools/make_goldens_formats.py`), and pyembroidery reads our files back with the same stitch counts, colour changes and extents (`tests/tools/crosscheck_formats.py`).
- Per-format notes: DST and EXP carry no colours (the dialog lists the thread order to set at the machine); JEF maps colours to the 78-colour Janome palette and names the smallest Janome hoop that fits (a format-specific hoop warning); VP3 stores exact RGB, brand and code.
- `validateMachineExport(plan, format)` adds per-format limits to the shared checks of §15.5.
- **PDF worksheet** (`src/io/export/pdfWriter.ts`, `pdf.ts`): a dependency-free PDF 1.4 writer (Helvetica, WinAnsi text, embedded JPEG). A4 sheet with design name, date, size, stitch/colour/trim/stop counts, estimated time, fabric and stabiliser, a realistic preview and the colour sequence table (continued over further pages when long).
- **Stitch-out video** (`src/io/export/video.ts`): the simulator's playback rendered offscreen and encoded with WebCodecs through mediabunny (MPL-2.0), as MP4/H.264 or, where H.264 encoding isn't available, WebM (VP9, VP8 or AV1). Timing is a length in seconds or a multiple of the machine's stitch rate; penetrations advance at a constant rate and jumps, trims and colour changes are instant. Frames are drawn incrementally (`createStitchOutRenderer`, shared with the dialog's live preview), 30 fps, then the finished design is held (2 s by default, 0–10 s). The "Made with LumaStitch" watermark with the app icon (`src/io/export/watermark.ts`, on by default) is drawn on the frame canvas with the needle, above the stitches; the PNG export adds a strip below the design for it instead. Encoding runs faster than real time and can be stopped.

## 16. Threads and colour (`src/threads`)

- Charts are JSON: `{ id, name, brand, threads: [{ code, name, color }] }`. They are generated from Ink/Stitch's GIMP `.gpl` palette files (GPL, compatible) by `scripts/import-palettes.ts`, with attribution in `NOTICE.md`. The **Brother PEC 64** palette, needed for PES v1 export, comes from pyembroidery.
- **Exact colours are the default.** A `Thread` with no `chart` is simply a colour. Charts and My threads only matter for colour mapping and for the names and codes shown in the colour sequence. The machine never sees a brand.
- **My threads** (P1) is a user-level palette in IndexedDB (`library/myThreads.ts`), shared across designs. It can be built from scratch, from a chart, or from the colours of an existing design. Auto-digitize and the image digitizer can restrict mapping to it.
- Colour maths: sRGB → linear → XYZ (D65) → CIELAB, ΔE2000, nearest-thread lookup, and k-means in Lab for colour reduction.

## 17. Persistence (`src/io/project`)

- **Local library** (`src/library`, P0). IndexedDB stores: `designs` (id → design JSON), `meta` (id → name, updatedAt, thumbnail PNG blob rendered from the stitch plan), `prefs`, and `myThreads`. At first launch the app calls `navigator.storage.persist()` so the browser doesn't evict designs under storage pressure. The home screen lists `meta`. Opening a design loads it into `documentStore`, and autosave writes back to its entry. Library backup and restore (P1) is a zip of project files.
- **Project file** (`*.lumastitch`, JSON): `{ format: 'lumastitch-project', schemaVersion, design }`. Loading parses, validates with zod, runs `migrate[v]` up to the current version, and checks invariants. The stitch plan is never stored.
- **Autosave.** About 1 s after each command, write the open design to its library entry. Startup reopens the last open design.
- **Files.** Use the File System Access API (`showOpenFilePicker` / `showSaveFilePicker`) where available, so Save writes in place. Otherwise fall back to `<input type=file>` and `<a download>`.

## 18. UI composition (`src/components`)

- `AppShell`: `MenuBar`, `Toolbar` (Import, Auto-digitize, view mode, Simulate, Export), `ToolPalette`, `CanvasView`, `Sidebar` (tabs: `Inspector`, `SequencePanel`, `ThreadsPanel`, `IssuesPanel`), `StatusBar`, and `SimulatorBar` (Simulate mode only).
- `Inspector`: a Shape section (X/Y/W/H/rotation, name, hide/lock), then **Fill** and **Outline** sections. Each has an enable switch, type `Select`, thread swatch picker, and a `ParamForm` generated from `ParamDef`s: Basic is open; Underlay, Compensation and Advanced are collapsed. Controls are a slider + number input with unit, `Select`, `Switch`, and an angle dial. Multiple selections show "Mixed".
- `SequencePanel`: a virtualised list of colour-block headers (swatch, block number, stitch count) and element rows (role icon, shape name, stitch count), plus stop rows. dnd-kit handles reordering. During simulation it highlights and auto-scrolls to the current element.
- `HomeScreen`: the project library grid (thumbnail, name, edited date; open, rename, duplicate, delete), plus New design, Open file and Import buttons. Routing is just "home vs. editor" state, so no router is needed.
- `DesignSizeField`: W × H in mm with an aspect lock, at the top of the sidebar. It calls `resizeDesign`.
- Dialogs: `ImportDialog` (SVG), `ImageImportDialog` (original vs. traced preview, target size, colour count and editable swatches, background, detail and smoothness sliders, line-art toggle, auto-digitize checkbox), `AutoDigitizeDialog`, `MyThreadsDialog` (P1), `ExportDialog` (version, palette mapping preview, validation list), `DesignSettingsDialog`, `ThreadPickerDialog`, `ShortcutsDialog`.

## 19. Performance budget

| Operation                   | Budget     | Technique                                          |
| --------------------------- | ---------- | -------------------------------------------------- |
| Single element regeneration | < 100 ms   | `prepare`/`route` caches; worker                   |
| Full plan, 50k stitches     | < 2 s      | worker; typed arrays; transfer                     |
| Pan/zoom, 100k stitches     | 60 fps     | cached `Path2D` / bitmap transform during gestures |
| Simulator                   | 60 fps     | incremental drawing; rAF outside React             |
| SVG import, 2,000 paths     | < 3 s      | single DOM pass; memoised `d` strings              |
| Undo snapshot               | O(changed) | Immer structural sharing                           |

## 20. Testing

- **Unit (Vitest, Node)**:
  - `geom`: flatten tolerance, offset, scanline, medial axis on known shapes (rectangle, ring, L-shape, Y-shape).
  - Each stitch generator, as property tests with fast-check on random polygons: every penetration lies within `offset(poly, pullComp + tol)`; no stitch exceeds its maximum; row spacing equals density; satin alternates rails; output is deterministic.
  - Sequencer: tie, trim, colour-change and stop emission.
  - PES encoder: golden files.
  - ΔE2000: Sharma et al. reference vectors.
- **Browser mode (Vitest + Playwright)**: the SVG importer (needs real `getComputedStyle`), Paper adapter booleans, and canvas rendering snapshots (P1).
- **E2E (Playwright)**: import fixture → auto-digitize → export → read back with `pesReader` → assert stats; undo/redo across commands; reload restores the design.
- **Fixtures**: `tests/fixtures/svg/` (basic shapes, holes, transforms, CSS classes, units, Illustrator, Inkscape and Figma exports, stroke widths, unsupported features) and `tests/fixtures/pes/` (goldens), plus `tests/fixtures/raster/` (flat logos, anti-aliased clip art, transparent PNGs, a noisy JPG and a photo, each with its expected colour count and background).
- **Raster unit tests**: k-means determinism (seeded RNG), auto-k on synthetic n-colour images, blend absorption on anti-aliased edges, connected components, morphology, and potrace output bounds in mm.
- **Physical sew tests**: `docs/sew-tests.md` records the machine (reference: Brother SE600, 4×4" hoop), fabric, settings, photo and verdict for each milestone.

## 21. Risks and spikes

| Risk                                                                 | Mitigation                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Machine rejects or misreads the PES                                  | Port pyembroidery exactly; golden tests; **sew test at the end of M1**; offer the v6 option.                                                                                                                                                    |
| Fill quality (gaps, visible travel, too many trims)                  | Port Ink/Stitch's fill routing where it beats ours; inside-only travel; diagnostics; iterate with sew tests.                                                                                                                                    |
| Image tracing quality (noisy regions, slivers, gaps between colours) | Edge-preserving pre-filter; absorb anti-aliasing blends; morphological cleanup; cutouts plus overlap growth; editable swatches; a fixture set of real logos and clip art with expected colour counts.                                           |
| SE600 has no automatic trimming (confirmed by a user)                | Every jump is a hand cut, and a jump that later stitching covers is locked in. Multi-part fills are sewn part by part with edge-to-edge jumps; inside travel is preferred over trims; hops ≤ 1 mm are sewn; the trim threshold is configurable. |
| Paper.js booleans fail on messy imports; Paper.js updates slowly     | It sits behind `paperAdapter`. Fallback: Clipper on flattened geometry, then `simplify` to refit curves.                                                                                                                                        |
| Paper.js can't run in a worker (unverified)                          | **M0 spike.** If it can't, run booleans on the main thread in chunks with progress. The engine never depends on Paper.                                                                                                                          |
| Clipper2 JS port maturity                                            | **M0 spike**: compare `clipper2-ts`, `clipper2-js` and `clipper2-wasm` on correctness tests and speed.                                                                                                                                          |
| Auto-satin rail detection on complex shapes                          | Conservative classification with a tatami fallback; manual rail-split and guide handles.                                                                                                                                                        |
| Huge SVGs (10k+ paths)                                               | Warning on import; optional simplify; canvas shape layer as a P2 fallback.                                                                                                                                                                      |
| Scope creep toward full Illustrator parity                           | Hold to P0/P1/P2; vector tools limited to the SPEC list.                                                                                                                                                                                        |

## 22. Build order

| Milestone                            | Scope                                                                                                                                                                                                                                                                                                                                                                     | Exit criteria                                                      |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **M0 Foundations**                   | Scaffold (Vite, React, TS, Tailwind, shadcn); GPL `LICENSE`; Cloudflare Workers deploy from the repo (§23); AppShell layout; viewport (pan, zoom, grid, dimensions); model, stores, undo; local library + autosave; SVG import → shapes rendered; select and move; design size field. Spikes: Paper.js in a worker, Clipper2 port choice, `esm-potrace-wasm` in a worker. | Fixture SVGs import at the correct size; main branch auto-deploys. |
| **M1 Vertical slice to the machine** | Engine worker; running, satin column and tatami (jumps between sections, no underlay); basic sequencer (trims, colour changes, ties); flat preview; PES v1 writer + reader; export dialog.                                                                                                                                                                                | Round-trip tests pass; **sew test #1**.                            |
| **M2 Configure and sequence**        | ParamDef-driven Inspector; fabric presets and inheritance; threads panel and Brother chart; Sequence panel with drag and drop; stops; trim and tie options; stats; design settings; autosave and project files.                                                                                                                                                           | Full manual workflow works without auto-digitize.                  |
| **M3 Simulator**                     | Playback, speeds, timeline, stepping, element highlight.                                                                                                                                                                                                                                                                                                                  | Matches read-back PES exactly.                                     |
| **M4 Stitch quality**                | Tatami inside travel; fill and satin underlays; pull compensation; satin fill (auto rails, guides); zigzag; contour fill; angle and entry/exit tools.                                                                                                                                                                                                                     | **Sew test #2** on woven and knit fabric.                          |
| **M5 Vector editing**                | Transform handles; node editing; pen, rectangle and ellipse; booleans; path operations; align; snapping.                                                                                                                                                                                                                                                                  | Boolean fixtures pass; undo for all.                               |
| **M6 Auto-digitizer**                | Colour mapping; overlap removal; classification; satin rails; sequence optimiser; dialog and summary.                                                                                                                                                                                                                                                                     | Acceptance criterion 2 on the logo fixtures.                       |
| **M7 Image digitizer**               | Raster worker; resample, filter, quantise, auto-k, background; masks and cleanup; potrace; cutout growth; `ImageImportDialog` with live preview; hand-off to auto-digitize. Line-art mode is P1.                                                                                                                                                                          | Acceptance criterion 3; **sew test #3** with a traced logo.        |
| **M8 Polish**                        | Realistic rendering; Issues panel; My threads; PES v6; PNG/SVG export; open `.pes`; library backup; shortcuts dialog; performance pass.                                                                                                                                                                                                                                   | All SPEC §12 criteria.                                             |

## 23. Deployment (Cloudflare Workers static assets)

The app is a static Vite build served by Workers static assets. There is no Worker script (`main`), so every request is a static asset request.

```jsonc
// wrangler.jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "lumastitch",
  "compatibility_date": "2026-10-01",
  "previews": {},
  "assets": {
    "directory": "./dist",
    "not_found_handling": "single-page-application",
  },
}
```

```
# public/_headers  (copied into dist/ by Vite)
/assets/*
  Cache-Control: public, max-age=31536000, immutable
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Content-Security-Policy: default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self'
```

- **CI/CD**: connect the GitHub repo in the Cloudflare dashboard (Workers Builds). Build command: `npm ci && npm run build`. Deploy command: `npx wrangler deploy`. Non-production branches use `npx wrangler preview`; the empty `previews` block inherits the static asset configuration. CI also runs `npm test` before the build.
- **Local**: `npm run dev` (Vite). `npx wrangler dev` serves `dist/` the same way production does, which is useful for checking `_headers` and the SPA fallback.
- **Limits to remember**: each static asset must be under 25 MiB (the potrace WASM is far below this). Vite's content-hashed `/assets/*` filenames make long-lived immutable caching safe, while `index.html` is revalidated, so a new deploy reaches users on their next load.
- **No cross-origin isolation** (COOP/COEP) is needed in v1, because nothing uses `SharedArrayBuffer`. If threaded WASM is added later, add those headers to `_headers`.
- **Offline (P2)**: a service worker precaching the build (e.g. `vite-plugin-pwa`) makes the app installable and fully offline.


## Digitized lettering

`src/lettering` lays out the pinned Geneva Simple Sans, Geneva Simple Sans Rounded and Chopin Script embroidery fonts. Licensed source SVG, metadata and the reproducible extraction script are retained; JSON contains the original paths, transforms, underlay and compensation. Rail/rung intersection topology identifies the two satin rails; monotonic rung positions pair arc-length samples. `satinColumn` generates density-controlled satin and underlay from these explicit rails without skeleton inference. SVG paths and ordinary running underpaths preserve the font's authored sewing order.

Layout supports source kerning/advance widths, NFC characters, multiline alignment/spacing, a circular baseline using rigid glyph rotations, and three-initial monograms. Unsupported characters and sizes are errors. `Design.lettering` stores text options, member shape IDs and an affine matrix. Whole-block transforms update that matrix; geometry changes to individual members or member deletion detach the editable text. Text regeneration replaces members in place in the sequence as one undo step. The resulting shapes remain ordinary editable geometry. Batch project/PES ZIP generation runs in a dedicated worker and terminates after export.


## Density inspection and sewing fields

`engine/density.ts` counts exact circular neighborhoods using radius/2 spatial buckets. Identical coordinates are aggregated and wholly contained buckets contribute their total without pairwise scans. Command flags exclude jumps/trims/stops/changes/end while retaining every penetration, including ties and underlay. A dedicated worker returns command-indexed counts; `DensityLayer` draws fixed quantitative bins and a radius/peak legend without changing the plan.

`Design.hoop` optionally records a rectangular or elliptical usable sewing field and inset margin. `engine/hoop.ts` centers it on plan bounds and checks each needle/jump destination; control records are ignored. `HoopLayer` displays the usable boundary; all machine format adapters and the export dialog append non-blocking fit warnings. Coordinates and encoded hoop metadata remain controlled by each exporter. Fields are not scaled when artwork is resized.

## Editable machine imports

`io/machine/read.ts` bounds-checks DST/JEF/EXP/VP3 records and delegates PES to the existing PEC reader. `machineImport.worker.ts` decodes and constructs a `Design`: one manual outline per color block, with optional `Node.command` values `jump`, `trim`, or `stop` (absent means needle down). Distinct thread IDs preserve same-color changes. `preserveCommands` bypasses generator cleanup, resampling, automatic ties and short-hop conversion. Coordinate transforms and node deletion/insertion retain command attributes. The inspector changes command kind as one undo step; path reconstruction operations are guarded while preservation is enabled.

PES pattern construction detects command-preserving elements and disables PEC's legacy synthetic jump-ending needle. Existing generated-design byte goldens remain unchanged. Imported block precedence prevents optimization from silently rearranging authored programs. `tests/fixtures/machine-readers.json` contains independent pyembroidery 1.5.1 command streams for 48 files; tests verify every decoded command, project round trip, plan command counts and every re-exported PES needle position.

## Guided fill

`stitches/guidedFill` treats open `PathGeom` subpaths as Bézier guides and closed subpaths as fill boundaries. Guides flatten at at most 0.03 mm. Translated copies use projected bounding limits; parallel mode extends endpoint tangents before offsets; buffer mode retains finite round caps. Clipper2 offset contours resolve self-intersections, and `clipPolylines` intersects open paths with a hole-aware polygon at 1 µm resolution. Needle chords are clipped again after resampling. Tatami preparation supplies straight underlay; rows sew adjacent curves using nearest endpoints and rotate closed contours toward entry and travel through a 0.25 mm inset visibility region. Geometry-limited work is bounded with explicit diagnostics. Long inter-row moves exceed a configurable exposed-travel limit and are trimmed. Guided-fill no-inside-path jumps remain jumps even below the global short-hop threshold. Rendering separates open guide paths so SVG implicit closure cannot alter filled artwork.

## Fabric calibration profiles

Optional `Design.fabricProfile` stores a validated, portable snapshot. Parameter resolution is type defaults → starter fabric → supported custom profile defaults → element overrides; plan cache keys already include resolved parameters, so profile edits invalidate generated stitches. Inspector, transforms and SVG export use the same resolver. `fabric/profiles.ts` stores up to 100 profiles in IndexedDB preferences and verifies writes; versioned JSON backups validate through the same schema. Applying/removing a profile is a document command; library edits do not mutate project snapshots. PDF worksheets select profile metadata and bound its displayed text to the available sidebar space.

## Multi-hooping packages

`hooping/split.ts` partitions the already-generated needle program at midlines of an overlapping rectangular grid. Each segment is split at all crossed grid boundaries; original endpoint ownership is counted exactly once. Tile-local programs retain color order and propagate source STOPs to all tiles touched since the previous stop. Visits add locks, trims and jumps; optional neighboring endpoints on one seam join within 1 mm. A symmetric basting frame and shared cross pairs establish placement and a stable local origin. Tile projects use command-preserving manual elements, while the original vector project is retained separately.

`hooping/archive.ts` writes numbered projects and the selected machine format, decodes the bytes to validate needle/jump field fit (including DST trim oscillations), and bundles a manifest, actual-size SVG placement diagram and instructions. `hooping.worker.ts` isolates splitting/export from the UI. `Design.multiHoop` stores the last successful dimensions/options; cancellation terminates the worker. Work is capped at 64 fields and 500,000 source commands.

## Satin branch routing

Satin outline preparation optionally builds the shared intersection graph (`running/network.ts`). The bounded open Chinese-postman walk marks the final visit to every edge as top stitching and prior visits as underpaths. `satin/branches.ts` merges consecutive same-role edges through degree-two vertices so flattened curve samples do not become separate satin caps. At each junction it completes the column's underlay and top. Even pass counts add a covered center walk to the far end before beginning reversed underlay, ensuring the final top always follows the graph direction. Short transverse caps return to junction centers. Disconnected components retain jumps/trims; default-off paths use the existing column router.

## Satin splitting

`satin/split.ts` constructs an uncompensated centerline or explicit-rail column, cuts its paired rail samples at a chosen centerline arc length and returns two rail geometries with identical seam endpoints. Interior sample pairs become direction guides so differing rail arc lengths cannot rematch and change the authored stitch angles. Reconstructed columns are validated before the document command replaces the source. Effective common satin parameters and resolved auto-underlay are snapshotted; pull compensation remains a generator parameter. The existing shape replacement command preserves stacking/sequence position and provides one undo step. `SatinSplitDialog` previews both rails and the cut; runtime remains bounded to 2,000 samples.

## Partial appliqué and cutting geometry

For opt-in partial covers, plan preparation unions later visible appliqué polygons inset by half their own cover widths. Geometry and width keys enter the prepared-run cache. The appliqué generator subtracts a further cover-half-width plus 0.1 mm inset from its cover centerlines using Clipper2 open-path difference, then routes the remaining open/closed covers. Placement and tack-down use the complete original rings. Pre-cut mode changes only the phase-stop policy.

`applique/cutting.ts` offsets repaired artwork by `-coverWidth/2 + allowance`, preserves holes, numbers connected fabric pieces in sequence order, optionally mirrors each locally, and lays them in rows. Per-piece and sheet SVGs contain cut contours only; the reference layout adds labels. DXF uses closed LWPOLYLINE entities on CUT, millimetre INSUNITS and inverted y coordinates for CAD. A cancellable Comlink worker returns the ZIP, manifest and layout; successful options are saved as optional `Design.appliqueCut`. Independent ezdxf 1.4.4 validation checks closed contours, units, dimensions and a clean audit on the example files.

## Lettering baseline reflow

`LetteringOptions.baseline` stores the path in lettering-local coordinates; optional offset/reverse fields control placement. The layout engine maps each advance-center onto flattened baseline arc length and applies its tangent rotation to the original digitized glyph, preserving glyph shape. `LetteringGroup.baselineShapeId` identifies a non-sewing shape included in the group's member list. Source path consumption and baseline creation share the lettering command's undo transaction.

`lettering/baseline.ts` detects guide-only geometry edits before document reconciliation, maps the edited guide back through the inverse group matrix and regenerates member geometries with stable IDs and retained stitch parameters. Position-dependent element hints are cleared. Invalid fits throw a specific error that rejects the command without a history entry. Whole-group transforms update the matrix and bypass reflow; baseline-only transforms preserve the link. Dashed baseline guides appear in SVG and Canvas2D editing layers but never enter the sewing sequence. Batch projects include the same editable guide/link structure.

## OpenType lettering

`lettering/shapeFont.ts` loads `harfbuzzjs` in the lettering worker, validates SFNT headers/table bounds and uses a HarfBuzz face/font/buffer to shape NFC text with variations, direction and language. Glyph IDs, UTF-16 clusters, positions, SVG outlines and font metrics are stored in `LetteringOptions.openType.prepared`; original base64 font data and license/axis metadata are stored alongside them. Shape keys include a font-data checksum and all shaping inputs. Synchronous layout rejects stale prepared data, allowing baseline reflow and document commands to remain synchronous without loading WASM in the editor. Worker RPC listeners register before the dynamic WASM import; top-level-await initialization must not delay `Comlink.expose`, or early messages can be lost. Interactive font work has a 30-second timeout and terminates its worker.

`lettering/opentype.ts` scales font units to mm, flips font Y-up coordinates and combines positioned outlines into nonzero fill geometry per line. Standard fill union handles shared contours and counters. Path/arc layout flattens outlines at 0.03 mm and continuously maps them through baseline arc length and normals, with tangent extension for overhanging outlines. Fill elements use the same sequence, persistence and baseline reflow paths as digitized outlines. Batch export reshapes each name before creating standalone projects. Font assets imported by URL are included in the offline service-worker precache; fonts never require a remote font service. Unicode 17 paragraph itemization supplies script- and direction-specific runs to HarfBuzz for mixed text, as described below.

## Appliqué edge selection

`StitchElement.appliqueEdges` stores omitted source subpath/segment index pairs and a node-count/open-closed topology signature. `applique/edges.ts` flattens each source Bézier edge at 0.03 mm, assigns inset-cover samples to their nearest source edge, and extracts retained cover runs. Samples include regular 0.1 mm positions plus selected-edge endpoints/midpoints projected onto the cover, preserving very short omissions. Visibility transitions refine to 0.005 mm; original contour vertices remain in retained intervals. Closed runs are joined across their parameter seam. Complexity is bounded to 500 source edges and 20 million distance comparisons. Changed topology raises a generation diagnostic; cached preparation includes the selection metadata. Selection indices need no coordinate transforms.

The appliqué generator uses selected cover runs before applying later-fabric masks; complete placement and tack-down rings are unchanged. `appliqueBorder` reuses phase generation with explicit open/closed centerline paths instead of inset fill rings. Double-running tack-down reverses an open path on its return pass. Open-border disconnections and selected cover gaps carry explicit trim flags that the plan emitter preserves even for short hops. Open borders have no fabric polygon, cutting piece or coverage mask. The edge dialog previews actual manually selected cover paths and saves all changes through one undo transaction.

## Grouped satin rail networks

`StitchElement.satinGroups` records consecutive subpath counts (two rails followed by rungs) inside one satin-column object. `satin/group.ts` validates compatible settings and sequence contiguity, embeds existing element guides as editable rung subpaths, and creates/ungroups objects through the normal replacement transaction. Preparation slices geometry by those counts and creates each original variable-width column separately. The preparation cache includes group metadata.

`stitches/satinColumn/network.ts` simplifies centerlines at 0.01 mm for graph construction while retaining an arclength map to each original column. Endpoints may snap to neighboring centerlines within 0.05 mm; the rail geometry is unchanged. Running-network edges and traversal steps now carry source indices and oriented source-arclength intervals, retaining ownership at crossings and parallel/overlapping edges. Degree-two, same-source, same-role visits merge before rail slicing. Repeated visits sew center underpaths; last visits sew sliced original rails and selected underlay. A coverage ledger lets a prior center walk replace the center pass for `center`/`centerEdge`, changing even pass parity to odd and eliminating a redundant return walk. Other even-pass combinations add a covered center walk so the final satin follows the graph direction. Disconnected components carry explicit trim flags, preserved even for short jumps. Graph-limit fallback retains all original column stitches/underlay flags and reports a diagnostic.


### Rotated hoop geometry

`hooping/placement.ts` handles rigid world/local transforms and convex rectangular coverage. Custom ownership uses the nearest center among fields containing a point. Each source chord is split at clipped field-entry/exit parameters and at relevant center bisectors; adjacent intervals with the same owner are merged. Every interval midpoint is checked, so covered endpoints cannot hide an uncovered interior. Same-seam joins additionally verify ownership along the whole connector. Design stitches stay within the symmetric frame, 0.5 mm inside the usable field, preventing format writers from shifting the local origin during recentering.

Registration intersects rectangles inset 2 mm, chooses a separated pair inside each safe overlap, and builds a breadth-first spanning tree from the first placement. Each later hoop shares two crosses with an earlier parent. Crosses use common world orientation and are transformed/quantized separately for each local machine program. `hooping/optimize.ts` scans 36 regular-grid orientations (5° steps) with lexicographic field-count/bounding-area/absolute-angle scoring; it produces editable placements and relies on the ordinary export coverage validation. It does not optimize arbitrary field packing or preserve source vector objects across cuts. The worker exposes both layout optimization and package generation. `hooping/preview.ts` provides an immediate vector overlay while the worker validates the complete needle program.


### Whole-object hoop assignment

`hooping/objects.ts` groups actual plan needles by source shape, including both fill and outline. A shrinking candidate set checks every quantized needle and incoming sewn endpoint against each field's convex local frame. Before assignment, a 10 mm spatial index records individual sewn-chord bounding boxes expanded by 0.25 mm per side. Cell group bounds provide a broad-phase test; individual chord boxes determine conservative cross-shape overlap. A disjoint-set structure joins touching source shapes transitively into layer groups. The intersection of all member candidate sets identifies common fitting fields. An empty intersection leaves every member under ordinary seam ownership; otherwise all members select the same nearest field to the combined needle bounding-box center. Within-field traversal retains their original sewing order. Manifest layerGroup identifiers refer to the first source shape in a touching group; repeated identifiers establish membership without quadratic metadata. Pair checks consume the shared work budget even for shapes already connected, so large dense cells cannot bypass the computation limit. `split.ts` bypasses ownership cuts only for these checked element indices; all source controls, stops and field-local quantization still use the normal pipeline. Manifest entries retain source object identities without pretending that machine stitch projects reconstruct vector objects.


### Unicode bidirectional lettering

`lettering/textRuns.ts` resolves Unicode 17 embedding levels over complete Unicode scalars, intersects Script/Script_Extensions sets into logical script spans, and partitions those spans by resolved directional level. Runs are ordered visually but shaped from logical text. `Buffer.addText` receives the full original NFC string plus UTF-16 substring offsets, retaining source clusters and shaping context. HarfBuzz handles RTL glyph mirroring; the bidi layer does not mirror characters a second time. Default-ignorable controls are removed after shaping. Each line remains one nonzero-filled outline group and uses the existing path/arc layout and batch pipeline.

The MIT `bidi-js` 1.1.0 implementation is vendored with Unicode 17 data, scalar indexing and a corrected local-line whitespace index. Official tables are reproduced by `scripts/generate-lettering-unicode.py`; a deterministic 481-case subset runs in CI. `tests/tools/check_bidi.mjs` validates all 91,707 official character cases and 770,241 class/direction cases against Unicode 17. `check_bidi_shaping.py` separately uses native FriBidi and uharfbuzz to verify the four illustrated glyph programs. Full font coverage is still required within a text block; font fallback, automatic line wrapping and vertical text layout are not supplied by this horizontal lettering workflow.

## Conservative machine object recognition

`recognition/detect.ts` splits needle runs at every control command. Tatami inference estimates a dominant axial angle using length-weighted orientation bins and doubled-angle averaging, groups projected rows within 0.14 mm, and requires at least six monotonic alternating rows with four needles each. Regular spacing must be 0.2–1.2 mm; short turns and slowly changing row ends bound the inferred single boundary. Half-row cap extensions estimate unsampled edges. At most eight total leading/trailing nodes may be excluded to retain small entry travel and ties. Holes and original stitch phasing are not inferred.

Satin inference scans alternating long chords with short same-rail steps. At least ten paired penetrations, regular center progression and smooth local turns are required. Paired rail samples are reduced jointly to at most 128 positions with a 0.1 mm interpolation-error guard; monotonic guide correspondence is validated by the existing rail-column constructor. Detected spacing overrides fabric defaults; underlay, pull compensation, split satin and short-stitch effects are disabled on inferred objects because their original settings are unknown.

`recognition/recognize.ts` validates the selection before detection (50,000 commands, 100 candidates). Conversion replaces only selected intervals; all remaining original nodes and controls stay in manual shapes with `preserveCommands`. Thread IDs and source sequence slots are retained through `replaceShapeGroups` as one undo transaction. Existing engine connection rules may add boundary trims/jumps. The lazy review dialog overlays source needles and inferred geometry and permits individual candidate exclusion. Thirty independent pyembroidery fixtures span six rotations and all five formats; artifact, regeneration and browser persistence tests exercise the complete workflow.

## Digitized font catalog

`lettering/digitizedFonts.ts` registers three pinned font datasets with per-font SVG guide coordinates, metadata, nominal size ranges and source notices. The layout cache key includes font ID and character; validation, advances, kerning and line spacing resolve through the selected font. Existing Geneva Simple geometry/output stays unchanged. The extractor accepts a font directory argument, retains source path transforms, recognizes inherited dash styles as running paths and carries explicit running lengths. Licensed source SVGs and metadata remain alongside extracted JSON. `archiveLetteringDesigns` collects font IDs across each batch and writes their complete source notices under `licenses/`, with attribution in README. New font IDs extend the saved lettering schema; generated shape/element structures remain the same.
