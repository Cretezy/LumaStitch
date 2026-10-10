# LumaStitch — Product Specification

Status: **Draft v0.2** · 2026-10-10 · Companion doc: [ARCHITECTURE.md](./ARCHITECTURE.md) · Licence: GPL-3.0-or-later

## 1. Overview

**LumaStitch** is an open-source, browser-based app for turning artwork into machine embroidery. It is similar in purpose to Ink/Stitch (the Inkscape extension), Hatch Embroidery and Wilcom EmbroideryStudio. Designs start from an imported SVG file or a raster image (PNG, JPG, WebP). You give each shape stitch settings, preview and simulate the stitch-out, then export a `.pes` file for Brother (and Baby Lock) embroidery machines.

The app is deliberately smaller than those products: one window, one workflow and sensible defaults. An **Auto-digitize** button does most of the work, and per-object controls let you fix the rest.

It runs entirely in the browser and is served as static files from Cloudflare Workers. There is no account and no backend, and designs never leave the user's computer. Designs persist locally in the browser and can be saved to and opened from files.

### 1.1 Target user

A hobbyist or small-business owner with a home embroidery machine that reads `.pes`. They have logos or artwork as SVG or as images, and want a reliable `.pes` without learning a professional digitizing package. They already know which hoops they own and what size they want the design to be. They may know basic vector tools (Illustrator, Inkscape or Figma) but may not know embroidery terms, so the UI explains them through tooltips and help text (see the §2 glossary).

### 1.2 Goals

| #   | Goal                                                                                                              |
| --- | ----------------------------------------------------------------------------------------------------------------- |
| G1  | Get from an SVG or image to a sewable `.pes` in minutes using auto-digitize.                                      |
| G2  | Show every automatic decision and let the user override it per object.                                            |
| G3  | **What you see is what gets sewn.** The preview, the simulator and the export all come from the same stitch data. |
| G4  | Keep it simple: one screen and progressive disclosure (basic settings visible, advanced ones collapsed).          |
| G5  | Make it extensible: adding a stitch type or export format is a self-contained change.                             |

### 1.3 Priorities used in this document

- **P0**: must have for v1
- **P1**: should have for v1 (may slip to v1.x)
- **P2**: later, but the architecture must allow it

## 2. Glossary

| Term                           | Meaning                                                                                                                                   |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Stitch / penetration           | A needle position. The thread between two consecutive penetrations is one stitch.                                                         |
| Stitch length                  | Distance between consecutive penetrations.                                                                                                |
| Running stitch                 | A single line of stitches along a path. Used for outlines and fine detail.                                                                |
| Triple (bean) run              | A running stitch where each stitch is sewn forward, back and forward again, giving a bold line.                                           |
| Satin stitch                   | Dense zigzag stitches spanning the full width of a narrow column. Smooth and shiny. Used for borders and lettering, roughly 1–8 mm wide.  |
| Zigzag stitch                  | An open, low-density zigzag along a path. Used for tack-downs and decorative edges.                                                       |
| Fill / tatami                  | Rows of running stitches covering an area.                                                                                                |
| Density / row spacing          | Distance between adjacent rows (fill) or zigzag peaks (satin). Smaller means denser.                                                      |
| Stitch offset / stagger        | How much each fill row's penetrations shift relative to the previous row. This avoids visible lines and creates the texture pattern.      |
| Stitch angle                   | Direction of fill rows or satin stitches.                                                                                                 |
| Underlay                       | A sparse layer sewn first. It stabilises the fabric and lifts the top stitches.                                                           |
| Pull compensation              | Widening a shape slightly, because stitches pull the fabric inwards and make shapes narrower than drawn.                                  |
| Rails / rungs                  | The two edges of a satin column, and the cross-lines that control stitch direction.                                                       |
| Entry / exit point             | Where an object's stitching starts and ends.                                                                                              |
| Connector                      | Movement between two objects: a stitched travel run, or a jump.                                                                           |
| Jump                           | A needle move without penetrating the fabric.                                                                                             |
| Trim                           | The machine cuts the thread, usually before a long jump.                                                                                  |
| Tie-in / tie-off (lock stitch) | Tiny back-and-forth stitches that secure the thread at the start or end of a run.                                                         |
| Colour change                  | The machine stops so the operator can change thread.                                                                                      |
| Stop                           | The machine stops without a planned colour change (for example to place appliqué fabric). Encoded in PES the same way as a colour change. |
| Hoop                           | The frame holding the fabric. Its sewing field limits the design size.                                                                    |
| Element                        | One stitched thing in the sequence: a shape's **fill** or a shape's **outline**.                                                          |

## 3. Input and output

### 3.1 Input: SVG

SVG 1.1 and SVG 2 files exported from Illustrator, Inkscape, Figma, Affinity and similar tools.

| Support                       | SVG features                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Full (P0)                     | `path`, `rect` (incl. rounded), `circle`, `ellipse`, `line`, `polyline`, `polygon`; nested `g`; `transform` on any element; `viewBox` and `width`/`height` with units (mm, cm, in, pt, px at 96 dpi); presentation attributes, `style` attributes and `<style>` CSS classes; `fill-rule`; compound paths with holes; `use` / `symbol`; `display` / `visibility`. |
| Approximate                   | Gradients: average colour of the stops, with a warning. Opacity: fully transparent paint is ignored, otherwise opacity is ignored. `clip-path`: applied as an intersection (P1, otherwise ignored with a warning).                                                                                                                                               |
| Embedded `image`              | P1: sent to the image digitizer (§3.2). Until then, ignored with a warning.                                                                                                                                                                                                                                                                                      |
| Not supported (warning shown) | `text` (convert to outlines first), `mask`, `pattern`, `filter`, `marker`, `foreignObject`, scripts, animation.                                                                                                                                                                                                                                                  |

### 3.2 Input: raster images

PNG, JPG and WebP (P0), up to about 4000×4000 px. Images are converted to vector shapes by the **image digitizer** (FR-10, §9.1), then go through the same pipeline as SVG.

Images have no reliable physical size, so the user sets the target width or height in mm on import.

Best results come from flat-colour artwork: logos, clip art, cartoons, icons. Photos are accepted but the result is posterised, and the dialog says so.

### 3.3 Output

| Format                            | Priority | Notes                                                                                                                                                                                                                                                                |
| --------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.pes` (Brother, Baby Lock)       | P0       | PES v1 with PEC section is the default (widest machine compatibility). PES v6 is an option (exact thread colours and brands for PE-Design and newer machines). Includes stitches, jumps, trims, colour changes, stops, thread colours and machine-screen thumbnails. |
| Project file (`.lumastitch`)      | P0       | Full editable design (JSON).                                                                                                                                                                                                                                         |
| PNG preview                       | P1       | Rendered stitch preview.                                                                                                                                                                                                                                             |
| SVG (geometry only)               | P1       | Edited shapes.                                                                                                                                                                                                                                                       |
| PDF worksheet, DST, JEF, EXP, VP3 | P2       | The export layer is format-agnostic.                                                                                                                                                                                                                                 |

## 4. Core workflow

1. **New design.** Choose the fabric type (default: the last one used, initially woven). There is no hoop to pick (§7).
2. **Import an SVG or image** and set the size you want: keep the SVG's own size, or type a target width or height in mm. SVG shapes become selectable objects. Images go through the image digitizer first, with a live preview of the traced colour regions. Everything is centred on the canvas origin. The import dialog has an "Auto-digitize after import" option, on by default.
3. **Auto-digitize** (optional, repeatable). Assigns stitch types, settings, threads and order to everything (or to the selection).
4. **Edit shapes and paths** with vector tools as needed.
5. **Adjust stitch types and settings** for each fill and outline.
6. **Arrange the sequence**, thread colours and stop breakpoints.
7. **Preview and simulate** the stitch-out.
8. **Export `.pes`.**

The steps don't have to happen in order. Any step can be revisited, and stitches regenerate automatically after every change.

## 5. UI overview

```
┌────────────────────────────────────────────────────────────────────────────────┐
│ File Edit Object Path Stitch View Help                                          │
│ [Import] [Auto-digitize] [Artwork | Stitches | Realistic] [Simulate] [Export]   │
├────┬────────────────────────────────────────────────────────┬──────────────────┤
│ V  │  · · · · · · · · · · · · · · · · · · · · · · · · · ·  │ DESIGN 92×61 mm ⛓ │
│ A  │  · ┌─────────────── 92 × 61 mm ───────────────┐ · ·  │ INSPECTOR        │
│ P  │  · │                                          │ · ·  │ Shape  X Y W H ∠ │
│ M  │  · │   canvas: artwork + stitch preview       │ · ·  │ ▾ Fill: Tatami   │
│ L  │  · │   selection, nodes, angle handles        │ · ·  │   density 0.40 … │
│ H  │  · └──────────────────────────────────────────┘ · ·  │ ▾ Outline: Satin │
│ Z  │  · · · · · · · · · · · · · · · · · · · · · · · · · ·  ├──────────────────┤
│ ∠  │                                                        │ SEQUENCE         │
│ ⚑  │                                                        │ ■ 1 Red   4,210  │
│    │                                                        │   Fill · Heart   │
│    │                                                        │ ■ 2 Black 1,980  │
│    │                                                        │   Outline · Heart│
│    │                                                        │   ⏸ Stop         │
├────┴────────────────────────────────────────────────────────┴──────────────────┤
│ ▶ ❚❚  1× 5× 25× ━━●━━  |■■■■■■■■|■■■■|■■■■■■■■■■■|  12,340 / 18,902   12:40   │ ← Simulate mode only
│ X 12.3  Y -4.1 mm · 150% · 18,902 st · 3 colours · 2 trims · 92×61 mm · ⚠ 2    │
└────────────────────────────────────────────────────────────────────────────────┘
```

- **Left**: tool palette (select, direct-select, pen, rectangle, ellipse, hand, zoom, stitch-angle, start/end point).
- **Centre**: unbounded canvas with optional grid and rulers, the shapes, and the stitch preview. A dimension label on the design's bounding box shows its size.
- **Right**: a **Design size** field (W × H in mm, aspect lock) at the top, then tabs for Inspector, Sequence, Threads and Issues.
- **Home**: a local project library (thumbnails, open, duplicate, delete) is shown when no design is open.
- **Bottom**: status bar. In Simulate mode, the playback bar appears above it. Editing is disabled while simulating.

## 6. Functional requirements

Numbering extends the original requirements (FR-1 to FR-6). FR-7 onward are new.

### FR-1 SVG import and vector editing

| ID      | Pri | Requirement                                                                                                                                                                                                                                                                                                                                                                       |
| ------- | --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-1.1  | P0  | Import an SVG file. Every visible geometry element becomes an individually selectable **shape** with its transforms applied and its coordinates in mm. Groups are flattened, with group names kept as name prefixes. Compound paths keep their holes.                                                                                                                             |
| FR-1.1a | P0  | Import dialog: keep the original size or set a target width or height in mm (aspect locked); centred on the origin; a list of skipped or approximated features.                                                                                                                                                                                                                   |
| FR-1.1b | P1  | Import additional SVGs into an existing design.                                                                                                                                                                                                                                                                                                                                   |
| FR-1.2  | P0  | **Selection and transform.** Click, shift-click and marquee select. Move by dragging or arrow keys (0.1 mm; Shift for 1 mm). Scale with bounding-box handles (Shift keeps proportions, Alt scales from the centre). Rotate by dragging just outside a corner (Shift snaps to 15°). Numeric X/Y/W/H/rotation fields in mm. Flip H/V, duplicate, copy/paste, delete, hide and lock. |
| FR-1.2a | P0  | **Node editing** (direct-select): move nodes and Bézier handles, multi-select nodes, add a node (double-click a segment), delete a node, toggle corner/smooth, open/close a path.                                                                                                                                                                                                 |
| FR-1.2b | P1  | Pen tool for new paths; rectangle and ellipse tools.                                                                                                                                                                                                                                                                                                                              |
| FR-1.2c | P1  | Align and distribute; snapping to grid, nodes and bounding boxes; rulers.                                                                                                                                                                                                                                                                                                         |
| FR-1.2d | P1  | Arrange (bring forward/back) changes artwork stacking. Sewing order is controlled separately (FR-5.1).                                                                                                                                                                                                                                                                            |
| FR-1.3  | P0  | **Boolean operations**: Unite, Subtract (front from back), Intersect and Exclude. Divide is P1. Unite, Intersect and Exclude keep the topmost shape's stitch settings. Subtract keeps the back shape's settings.                                                                                                                                                                  |
| FR-1.4  | P1  | Path operations: combine / break apart, reverse direction, offset path, simplify, outline stroke (stroke to filled shape), join endpoints.                                                                                                                                                                                                                                        |
| FR-1.5  | P0  | Undo and redo for every document change, at least 100 steps. A drag counts as one step.                                                                                                                                                                                                                                                                                           |
| FR-1.6  | P0  | Zoom and pan: wheel zooms at the cursor, Space-drag or middle-drag pans, fit design (⌘0), fit selection, 100% (⌘1).                                                                                                                                                                                                                                                               |
| FR-1.7  | P1  | **Artwork backdrop**: the original imported SVG or image is kept as a locked reference layer with adjustable opacity. Auto-digitize can be re-run from it.                                                                                                                                                                                                                        |
| FR-1.8  | P0  | **Design size**: set the whole design's width or height in mm (aspect lock on by default). Geometry scales and stitches are regenerated at the new size, so density stays correct. This is the main advantage over resizing a finished stitch file. Satin and stroke widths scale along with it, but can be locked.                                                               |

### FR-2 Stitch configuration

| ID     | Pri | Requirement                                                                                                                                                                                                                                    |
| ------ | --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-2.1 | P0  | Each shape has an independent **Fill** element and **Outline** element. Each can be turned off and has its own stitch type, thread and parameters. Open paths have an outline only.                                                            |
| FR-2.2 | P0  | Stitch types in v1. **Fill**: Tatami, Satin. **Outline**: Running, Triple run, Satin, Zigzag. P1: Contour fill. P2: motif run, pattern/motif fill, gradient fill, meander, ripple, E-stitch/blanket, appliqué, cross-stitch, manual stitching. |
| FR-2.3 | P0  | Per-element parameters including density, stitch length, stitch offset, angle, underlay, pull compensation, entry/exit points, tie-in/tie-off and trim-after. The full list is in §8.                                                          |
| FR-2.4 | P0  | Multi-select editing: a change applies to every selected element of a compatible type. Differing values show as "Mixed".                                                                                                                       |
| FR-2.5 | P1  | **Inheritance**: parameter values default from the design's fabric preset. Overridden values are marked and can be reset individually. Changing the fabric updates every value that hasn't been overridden.                                    |
| FR-2.6 | P1  | On-canvas handles for the fill angle (drag a direction line), entry and exit points, satin direction lines and satin rail split points.                                                                                                        |
| FR-2.7 | P1  | Copy and paste stitch settings between elements.                                                                                                                                                                                               |
| FR-2.8 | P0  | When a parameter changes, the preview updates within about 200 ms for a typical element.                                                                                                                                                       |

### FR-3 Stitch preview

| ID     | Pri | Requirement                                                                                                                                                          |
| ------ | --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-3.1 | P0  | View modes: **Artwork** (vector shapes), **Stitches** (flat stitch lines over faded artwork) and **Realistic** (thread-like rendering with thickness and sheen; P1). |
| FR-3.2 | P0  | Toggles: jumps and trims, needle points, grid, design dimensions, artwork backdrop. Underlay highlight is P1.                                                        |
| FR-3.3 | P0  | Clicking a stitch selects its element. Hovering highlights it.                                                                                                       |
| FR-3.4 | P0  | Design info in the status bar: stitch count, colour count, size (W×H mm), trims, colour changes and stops, estimated sewing time.                                    |
| FR-3.5 | P1  | Problem highlighting on the canvas (see FR-9).                                                                                                                       |

### FR-4 Stitch-out simulation

| ID     | Pri | Requirement                                                                                                                                                                                                                                                                                                  |
| ------ | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| FR-4.1 | P0  | Animate the stitches in exactly the exported order, generated from the same stitch data as the export. Shows a needle marker and the current thread colour. Jumps and trims are visible.                                                                                                                     |
| FR-4.2 | P0  | Controls: play/pause; speed from 1× (real machine speed) up to about 100× plus "max"; a timeline scrubber split into colour blocks with trim and stop markers; step ±1 stitch; jump to the previous/next element or colour change; current and total stitch count; simulated elapsed and total machine time. |
| FR-4.3 | P0  | The element being sewn is highlighted in the Sequence panel. Clicking an element in the panel moves the playhead to its start (P1).                                                                                                                                                                          |
| FR-4.4 | P1  | Optional pause at each colour change or stop, like the machine.                                                                                                                                                                                                                                              |
| FR-4.5 | P0  | Keyboard: Space for play/pause, ←/→ to step, Shift+←/→ for the previous/next element, Home/End.                                                                                                                                                                                                              |

### FR-5 Sequencing and thread management

| ID      | Pri | Requirement                                                                                                                                                                                                                                                                                                                                                           |
| ------- | --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-5.1  | P0  | The **Sequence panel** lists every element in sewing order, grouped into colour blocks. Drag to reorder elements or whole blocks. Also: move up/down/to start/to end (⌘[ and ⌘]), and multi-select.                                                                                                                                                                   |
| FR-5.1a | P0  | Default order after import is the SVG paint order, with each shape's fill before its outline.                                                                                                                                                                                                                                                                         |
| FR-5.1b | P1  | **Optimize order** minimises colour changes, then travel and trims, without sewing a lower layer after an upper layer that overlaps it.                                                                                                                                                                                                                               |
| FR-5.2  | P0  | **Threads.** The design has a list of thread swatches. Assign a thread to elements, or edit a thread to change every element that uses it. A thread is just a colour plus an optional name and code. Pick any colour, or pick from brand charts (Brother, Madeira, Isacord, Robison-Anton, Sulky and others, from Ink/Stitch's palettes) with search by name or code. |
| FR-5.2a | P0  | By default, imported colours are kept exactly. Optionally, they can be mapped to the nearest thread in a chart or in My threads (CIEDE2000).                                                                                                                                                                                                                          |
| FR-5.2b | P1  | **My threads**: a palette of the spools the user actually owns, for example a generic 40-colour kit, entered once and shared by all designs. Auto-digitize can be limited to these colours, so every colour in the design is one the user has on hand.                                                                                                                |
| FR-5.3  | P0  | **Colour changes** are inserted automatically wherever consecutive elements use different threads. **Stop breakpoints** can be inserted, moved and deleted anywhere in the sequence (for manual thread changes, appliqué, or a same-colour stop).                                                                                                                     |
| FR-5.4  | P0  | Per-element connection settings: trim after (auto / always / never), tie-in and tie-off (auto / on / off).                                                                                                                                                                                                                                                            |

### FR-6 Export

| ID     | Pri | Requirement                                                                                                                                                                                                                                           |
| ------ | --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-6.1 | P0  | Export a valid `.pes` containing the full stitch data, sequence, colour changes, stops, trims and thread colours, plus thumbnails.                                                                                                                    |
| FR-6.2 | P0  | Validation before export. **Errors** block export: no stitches, or out of format range. **Warnings** allow export: very long stitches, many trims, and similar. There is no hoop check (§7). Machines centre the design in whatever hoop is attached. |
| FR-6.3 | P0  | PES version choice: **v1** (default; colours mapped to Brother's 64-colour PEC palette, previewed in the dialog) or **v6** (exact RGB plus thread brand and code).                                                                                    |
| FR-6.4 | P0  | The file name defaults to the design name. The design name is embedded as the machine label (keep it to 8 characters or fewer for reliable display).                                                                                                  |
| FR-6.5 | P1  | Export a PNG preview and an SVG of the geometry.                                                                                                                                                                                                      |
| FR-6.6 | P1  | Open a `.pes` for viewing and simulation only. The same reader is used to verify our own exports.                                                                                                                                                     |

### FR-7 Auto-digitize (new)

| ID     | Pri | Requirement                                                                                                                                                                                                                                             |
| ------ | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-7.1 | P0  | One-click **Auto-digitize** for the whole design or the selection. A short dialog offers fabric, colours (exact / thread chart / My threads), maximum colours, remove overlaps, minimum detail size and outline handling. It remembers the last values. |
| FR-7.2 | P0  | The result is ordinary editable elements with no hidden state. The whole run undoes as one step.                                                                                                                                                        |
| FR-7.3 | P0  | It follows the rules in §9.                                                                                                                                                                                                                             |
| FR-7.4 | P1  | A summary afterwards, for example "14 fills, 6 satins, 3 runs, 4 colours, 2 tiny details dropped", with a link to select the dropped items.                                                                                                             |
| FR-7.5 | P1  | "Keep my edits" option: elements whose settings the user changed by hand are left alone.                                                                                                                                                                |

### FR-8 Project and settings (new)

| ID     | Pri | Requirement                                                                                                                                                                                                                    |
| ------ | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| FR-8.1 | P0  | Design settings: name, fabric preset, thread chart, machine speed (stitches per minute), trim threshold, default tie behaviour, minimum and maximum stitch length.                                                             |
| FR-8.2 | P0  | Autosave to browser storage after every change. The open design is restored on reload.                                                                                                                                         |
| FR-8.3 | P0  | Save and open project files (`.lumastitch`) containing geometry, settings, sequence, threads and the artwork backdrop.                                                                                                         |
| FR-8.4 | P0  | **Local project library**: every design is kept in browser storage with a thumbnail, name and last-edited date. Open, rename, duplicate and delete. The app asks the browser for persistent storage so designs aren't evicted. |
| FR-8.5 | P1  | Back up the whole library to a single file, and restore from one.                                                                                                                                                              |

### FR-9 Diagnostics (new)

| ID     | Pri | Requirement                                                                                                                                                                                                                                                           |
| ------ | --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-9.1 | P1  | An **Issues** panel listing warnings; clicking one selects the affected element. Checks: satin wider than the maximum or narrower than about 1 mm; tiny objects; long stitches; heavy stacking (too many overlapping layers); excessive trims; import approximations. |

### FR-10 Image (raster) digitizing (new)

| ID      | Pri | Requirement                                                                                                                                                         |
| ------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-10.1 | P0  | Import PNG, JPG or WebP. The **Image import dialog** shows the original and a live traced preview side by side, and the user sets the target width or height in mm. |
| FR-10.2 | P0  | **Colours**: auto-suggest a colour count (adjustable from 2 to 16). The resulting colours appear as swatches the user can merge, recolour or mark "don't stitch".   |
| FR-10.3 | P0  | **Background**: detect the background colour from the image border (or transparency) and leave it unstitched by default. This can be toggled.                       |
| FR-10.4 | P0  | **Detail**: a single "detail / smoothness" slider controls the minimum region size, despeckling and curve smoothing.                                                |
| FR-10.5 | P0  | **Trace**: produces ordinary vector shapes (one or more per colour) that are fully editable, then optionally auto-digitizes them using the vector rules (§9).       |
| FR-10.6 | P1  | **Line-art mode**: thin dark lines are traced to centrelines and become running or satin outlines, instead of being outlined as thin filled shapes.                 |
| FR-10.7 | P1  | Re-trace from the backdrop with different settings, replacing the previously traced shapes as one undoable step.                                                    |

## 7. Design size (no hoop selection)

LumaStitch has no hoop setting. Users already know the hoops they own and size the design accordingly.

- The canvas is unbounded. The design's size is its bounding box, always visible in the Design size field and as a dimension label.
- Sizes are set on import (FR-1.1a, FR-10.1) and can be changed at any time (FR-1.8). Stitches are regenerated rather than scaled, so density stays constant.
- There is no hoop warning at export. Only PES format limits are checked.
- Machines centre the design in whichever hoop is attached, so the design's position on the canvas doesn't matter.

## 8. Stitch type reference

All lengths are in mm and angles in degrees. On screen, angles are measured counter-clockwise from horizontal, as in Illustrator and Wilcom. The values below are starting defaults; they will be tuned through sew tests, and fabric presets (§8.7) override some of them.

### 8.1 Settings on every element

| Parameter          | Default                      | Notes                                                                                   |
| ------------------ | ---------------------------- | --------------------------------------------------------------------------------------- |
| Thread             | from import or auto-digitize |                                                                                         |
| Tie-in / Tie-off   | auto                         | Auto means on when next to a trim, colour change, stop, or the start/end of the design. |
| Trim after         | auto                         | Auto trims when the connector to the next element is longer than the trim threshold.    |
| Entry / exit point | auto                         | Auto picks the point nearest the previous element's exit and the next element's entry.  |

### 8.2 Tatami fill

| Parameter              | Default          | Range                                        | Notes                                                                                                |
| ---------------------- | ---------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Angle                  | 45°              | 0–180                                        | Row direction. Auto-digitize picks this per shape.                                                   |
| Density (row spacing)  | 0.40             | 0.20–2.0                                     |                                                                                                      |
| Stitch length          | 3.5              | 1.0–7.0                                      | Maximum length within a row.                                                                         |
| Stitch offset          | 0.25             | 0–1                                          | Fraction of the stitch length each row shifts. 0.25 repeats every 4 rows; 0.5 gives a brick pattern. |
| Pull compensation      | 0.20             | 0–1.0                                        | Expands the shape outward.                                                                           |
| Underlay               | tatami           | none / edge run / tatami / edge run + tatami |                                                                                                      |
| Underlay angle         | fill angle + 90° |                                              |                                                                                                      |
| Underlay spacing       | 3.0              | 1.0–6.0                                      |                                                                                                      |
| Underlay stitch length | 3.0              |                                              |                                                                                                      |
| Underlay inset         | 0.5              | 0–2                                          | Keeps underlay from peeking out at the edges.                                                        |
| Travel stitch length   | 2.0              |                                              | For hidden runs between fill sections.                                                               |

Fill rows line up to a global grid, so adjacent shapes with the same angle and density look continuous.

### 8.3 Satin: outline (column) and fill (shape)

| Parameter                      | Default       | Range                                                  | Notes                                                                                                                                                 |
| ------------------------------ | ------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Width (outline only)           | stroke width  | 0.8–12                                                 | Warning above 8 mm (snag risk).                                                                                                                       |
| Density (peak-to-peak spacing) | 0.40          | 0.20–1.5                                               | Measured along the centreline.                                                                                                                        |
| Pull compensation              | 0.20 per side | 0–1.0                                                  |                                                                                                                                                       |
| Underlay                       | auto          | none / centre walk / edge walk / zigzag / combinations | Auto: width under 2 mm uses a centre walk; 2–4 mm uses an edge walk; over 4 mm uses edge walk plus zigzag.                                            |
| Underlay inset                 | 0.4           |                                                        |                                                                                                                                                       |
| Zigzag underlay spacing        | 2.0           |                                                        |                                                                                                                                                       |
| Short stitches on inner curves | on (P1)       |                                                        | Avoids bunching on tight curves.                                                                                                                      |
| Split satin above (P1)         | 7.0           | 5–12                                                   | Adds staggered penetrations to over-wide stitches.                                                                                                    |
| Fill mode (shape only)         | auto-turning  | auto-turning / fixed angle                             | Auto-turning derives two rails from the outline so stitches follow the shape. Shapes with holes or branches fall back to fixed angle, with a warning. |
| Angle (fixed mode)             | 45°           |                                                        |                                                                                                                                                       |

### 8.4 Running and triple run

| Parameter     | Default (running / triple) | Range   | Notes                                                                               |
| ------------- | -------------------------- | ------- | ----------------------------------------------------------------------------------- |
| Stitch length | 2.5 / 3.0                  | 0.5–6.0 | Stitches are spaced evenly between corners. Sharp corners always get a penetration. |
| Bean repeats  | 0 / 1                      | 0–3     | 1 = triple, 2 = quintuple.                                                          |
| Passes        | 1                          | 1–5     | Sews the path there and back multiple times.                                        |

### 8.5 Zigzag

| Parameter              | Default | Range   |
| ---------------------- | ------- | ------- |
| Width                  | 2.0     | 0.5–6.0 |
| Spacing (peak-to-peak) | 1.0     | 0.3–5.0 |

No underlay and no pull compensation.

### 8.6 Contour fill (P1)

| Parameter     | Default       |
| ------------- | ------------- |
| Spacing       | 0.4           |
| Stitch length | 3.0           |
| Order         | inner → outer |

### 8.7 Fabric presets

These are starting values to be tuned through sew tests.

| Preset                                 | Fill density | Satin density | Pull comp | Fill underlay         | Satin underlay          | Notes                            |
| -------------------------------------- | ------------ | ------------- | --------- | --------------------- | ----------------------- | -------------------------------- |
| Woven (cotton, twill, denim) (default) | 0.40         | 0.40          | 0.20      | tatami 3.0            | auto                    | tear-away or cut-away stabiliser |
| Knit (T-shirt, polo)                   | 0.42         | 0.42          | 0.35      | edge run + tatami 2.5 | auto, one level heavier | cut-away stabiliser              |
| Pile (fleece, towel)                   | 0.42         | 0.40          | 0.35      | edge run + tatami 2.0 | auto, one level heavier | water-soluble topping            |
| Lightweight (silk, organza)            | 0.45         | 0.45          | 0.15      | edge run              | centre walk             |                                  |

### 8.8 Design-level settings

| Setting                        | Default    | Notes                                                                                      |
| ------------------------------ | ---------- | ------------------------------------------------------------------------------------------ |
| Trim threshold                 | 3.0        | Same-colour connectors shorter than this are stitched; longer ones are trimmed and jumped. |
| Minimum stitch length          | 0.3        | Shorter stitches are merged (ties are exempt).                                             |
| Maximum stitch length          | 12.0       | Longer stitches are split.                                                                 |
| Tie length                     | 0.8        |                                                                                            |
| Machine speed                  | 600 spm    | For time estimates and 1× simulation.                                                      |
| Trim time / colour-change time | 6 s / 30 s | For time estimates.                                                                        |

## 9. Auto-digitizer rules

The aim is a sensible, sewable first pass that matches what an experienced digitizer would do for simple logos. The output is always ordinary, editable elements. All thresholds are configurable constants.

1. **Normalise.** Repair invalid geometry (self-intersections). Drop invisible shapes: no fill and no stroke, zero area, or fully transparent.
2. **Colours.** Collect the fill and stroke colours. Merge colours closer than ΔE00 5. If there are more colours than the maximum (default: no limit), cluster them in CIELAB down to the maximum. Keep the exact colours (default), or map each to the nearest thread in the chosen chart or in My threads. Gradients use their average colour.
3. **Remove overlaps** (default on). Working from the bottom up, subtract from each fill region every fill region above it in the artwork stacking order. The upper shape is first inset by the **overlap margin** (default 0.4 mm) so the lower fill slightly underlaps it and no gaps open up. Strokes are not subtracted, because outlines are sewn on top and the fill should run under them. Disconnected leftovers become separate shapes, for example "Sky (part 2)". Leftovers smaller than the minimum detail size are dropped and reported. **Split separate parts** (default off) also makes each separate closed part of an untouched fill (each letter of a word set as one path) its own shape with its own outline, so with same-colour outlines each letter is finished before the next; the parts are then classified on their own, so narrow letters may become satin.
4. **Strokes become outline elements**, based on stroke width _w_:
   - _w_ < 0.6: Running
   - 0.6 ≤ _w_ < 1.2: Triple run
   - 1.2 ≤ _w_ ≤ max satin width (7.0): Satin with width _w_
   - _w_ > 7.0: the stroke is converted to a filled shape and handled by step 5
5. **Fills are classified** by local width, using the medial axis and the maximum inscribed circle:
   - Max width < min detail (0.8 mm) and length > 3 mm: Running stitch along the centreline.
   - Max width < min detail and short: dropped and reported.
   - Max width ≤ 7.0 mm, with no holes and no significant branches: **Satin** (auto-turning).
   - Narrow but branched or with holes: **Tatami** in P0. In P1 the shape is split at skeleton junctions into satin columns.
   - Otherwise: **Tatami**. The angle follows the long axis of the shape's minimum-area bounding rectangle, snapped to 15°. If an overlapping or touching fill has an angle within 20°, rotate by 45° so neighbouring areas read as separate.
6. **Settings.** Density, pull compensation and underlay come from the fabric preset. Satin underlay follows the width rule in §8.3. Fills narrower than 3 mm get no underlay.
7. **Sequence.**
   - Constraints: if element A is below B in stacking order and they overlap, A is sewn before B, whatever their roles. A shape's outline comes after its own fill. So a shape is finished, fill and outline, before the shape stacked above it.
   - Objective: fewest colour changes first, then shortest travel and fewest trims. Sewing starts at the top-left of the design, and the next colour is the nearest one whose remaining elements can all be sewn now.
   - Each element's entry and exit points are chosen from its neighbours: it starts at its edge point nearest to where the previous element finished, and it finishes next to the following element when that one uses the same thread.
   - **A fill with several separate parts** (for example a word set as one SVG path) is sewn one part at a time, each part completely (underlay and top layer), in the shortest order. The jump between parts goes edge to edge, so it is as short as possible and isn't sewn over by the part it lands in.
   - Within a part, the order of row sections minimises travel, and travel runs under areas still to be sewn rather than on top of finished rows.
   - **An outline with several separate loops** (a word's letters, a letter's counters) is sewn loop by loop in the order with the shortest jumps, each loop starting where the move in and the move out to the next loop are shortest. Moves between loops are jumps, never stitches across the gap (hops of 1 mm or less excepted).
8. **Connections.** Trims and ties follow the design settings.
9. **Commit** as a single undoable step and show the summary.

### 9.1 Image digitizer rules

The image digitizer turns pixels into the same kind of shapes an SVG import produces. The vector rules above then apply unchanged. All thresholds are configurable constants.

1. **Working resolution.** Resample the image so that 1 px ≈ 0.1 mm at the target size (capped at about 4 megapixels). This means "minimum detail" in mm translates directly to pixels.
2. **Pre-filter.** Composite onto white if transparent (transparency also marks background). Apply an edge-preserving smoothing filter (bilateral or median) to remove JPEG noise and anti-aliasing fringes.
3. **Quantise.** Run k-means in CIELAB on a pixel sample, with k-means++ initialisation, then assign every pixel to its nearest centre. **Auto colour count**: pick the smallest k (2–16) where adding a colour reduces error by less than a threshold. Anti-aliasing blends (pixels between two large clusters, along their boundary) are absorbed into a neighbour instead of becoming a colour of their own.
4. **Background.** The background is the colour that dominates the image border, or transparent pixels. It is marked "don't stitch" by default.
5. **Clean the masks.** For each colour, apply morphological open and close at a radius set by the detail slider. Regions smaller than the minimum detail area (default 1 mm²) are merged into the neighbour they share the longest border with.
6. **Trace.** Run potrace on each colour mask, with corner and curve-optimisation settings driven by the smoothness slider. Results are in mm.
7. **Layering.** Regions are traced as non-overlapping cutouts, so nothing is stitched twice. When the sequence is built, each region is grown by the overlap margin (0.4 mm) wherever it borders a region sewn after it, so the later stitches cover the seam and no fabric shows through.
8. **Line art (P1).** Dark regions that are thin everywhere (max width < 1.5 mm) are skeletonised instead. Their centrelines become outline shapes (running or satin by width, using the stroke rules in step 4 above).
9. **Hand off.** Each traced shape gets its colour as SVG paint would. If "Auto-digitize after import" is on, the vector rules run immediately. Overlap removal is skipped because the regions are already cutouts.

## 10. Non-functional requirements

| Area              | Requirement                                                                                                                                                                                                                                                                                                                                    |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Platform          | Latest desktop Chrome, Edge, Firefox and Safari. Minimum window 1280×800. Mouse and keyboard; touch is not required.                                                                                                                                                                                                                           |
| Hosting           | Static assets on Cloudflare Workers, deployed from the Git repo. No server-side code.                                                                                                                                                                                                                                                          |
| Privacy / offline | Fully client-side. No network calls after load. Offline install as a PWA is P2.                                                                                                                                                                                                                                                                |
| Persistence       | Designs, My threads and preferences are stored in IndexedDB, with persistent storage requested. Project files back them up.                                                                                                                                                                                                                    |
| Responsiveness    | Stitch generation and image tracing never block the UI (they run in Web Workers).                                                                                                                                                                                                                                                              |
| Performance       | Import a 2 MB SVG with 2,000 paths in under 3 s. Trace a 2000×2000 px image with 8 colours in under 5 s, with the dialog preview updating in under 1 s at reduced resolution. Regenerate one typical element in under 100 ms. Generate a full 50k-stitch design in under 2 s. Pan and zoom at 60 fps up to 100k stitches. Simulator at 60 fps. |
| Accuracy          | Exported coordinates use 0.1 mm resolution with no cumulative rounding drift. Curve flattening tolerance is 0.05 mm or better.                                                                                                                                                                                                                 |
| Reliability       | Autosave after every change. Project files are versioned and migrated forward. The stitch generator is deterministic: the same input gives the same stitches.                                                                                                                                                                                  |
| Compatibility     | Exported `.pes` files open without errors in pyembroidery/Ink/Stitch and Brother's PE-Design (or its viewer), and sew correctly on the reference machine, a **Brother SE600** (100×100 mm field, PES via USB).                                                                                                                                 |
| Accessibility     | Every common action has a keyboard shortcut. UI controls use accessible Radix/shadcn primitives.                                                                                                                                                                                                                                               |
| Licensing         | **GPL-3.0-or-later**, open source. Ink/Stitch (GPL-3.0) algorithms, code and thread palettes may be ported, and potrace (GPL-2.0-or-later) may be used, keeping their copyright notices and attribution. pyembroidery (MIT) is the reference for PES.                                                                                          |

## 11. Out of scope for v1

- Photo-realistic image digitizing ("photo stitch"). Photos are posterised into flat colour regions instead.
- Lettering and fonts. SVG text must be converted to outlines first.
- Export formats other than PES (DST for commercial machines, JEF for Janome, EXP for Bernina, VP3 for Husqvarna/Pfaff, and others). The architecture supports adding them, and pyembroidery has writers to port.
- Appliqué wizard, motif and pattern fills, gradient fills, meander, ripple, 3D puff, sequins, cross-stitch.
- Editing individual stitches by hand.
- Hoop selection and hoop-size checks (by design, §7); splitting across multiple hoopings.
- Sending directly to a machine (USB or Wi-Fi), cloud storage, accounts, collaboration.
- Mobile and touch layouts.
- PDF production worksheets (P2).

## 12. v1 acceptance criteria

1. **Import fidelity.** Every SVG in the fixture set imports with all visible shapes at the correct size and position (±0.1 mm). The set covers Illustrator, Inkscape and Figma exports, CSS classes, nested transforms, compound paths and unit variants.
2. **End to end.** Auto-digitize a 3-colour logo and export `.pes`. The file:
   - opens in pyembroidery with the same stitch count, colour count and bounds as the app's stats;
   - opens in PE-Design or a Brother viewer without errors;
   - sews on the Brother SE600 with the right colour sequence, and no format errors.
3. **Images.** Import a flat-colour PNG logo with 4 colours on a white background, set the width to 90 mm, and accept the defaults. The result has 4 thread colours, an unstitched background, no gaps between regions, and sews cleanly on the SE600.
4. **WYSIWYG.** Reading an exported `.pes` back gives exactly the command sequence the simulator plays.
5. **Live editing.** Changing a fill's density updates the preview within 300 ms for a typical element.
6. **Booleans.** All four boolean operations give correct geometry on the fixture pairs, including holes and curves.
7. **Undo.** Undo and redo restore the exact previous document for every command.
8. **Persistence.** Reloading the browser restores the design and the project library. A saved project file reopens identically.
9. **Deployment.** A push to the main branch deploys to Cloudflare Workers, and the deployed app works offline after its first load (no network requests while editing).

## 13. Decisions

| Topic         | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name          | **LumaStitch**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Licence       | GPL-3.0-or-later, open source. Ink/Stitch code and palettes and potrace may be reused.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Hosting       | Static assets on Cloudflare Workers, deployed from the Git repo.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Hoops         | No hoop setting. Users size the design themselves (§7).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Machines      | Any machine that reads `.pes`: Brother and Baby Lock home machines (Baby Lock's are made by Brother). What matters is the file format, not the model. The reference machine for sew tests is a **Brother SE600** (100×100 mm field, reads PES from USB). It doesn't trim jumps automatically (confirmed by a user): every jump leaves a thread that is cut by hand afterwards, and a jump thread that later stitching covers gets locked into the design. So jumps should be few, short, and never sewn over; tiny internal hops (≤ 1 mm) are sewn as a stitch instead. |
| Thread brands | The brand never reaches the machine. A thread is just a colour for the preview and a name/code for the colour sequence. Exact colours are the default. Brand charts are optional, and My threads (P1) covers generic kits.                                                                                                                                                                                                                                                                                                                                              |
| Raster images | In v1 (FR-10).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Scope         | Single user, local only, with persistence in the browser (FR-8.4) and project files.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

## 14. Open questions

1. **Other formats.** Do any intended users have non-Brother machines? Janome (JEF), Bernina (EXP), Husqvarna/Pfaff (VP3) or commercial machines (DST) would each need a writer. These are cheap to port from pyembroidery, so they could move from P2 to P1.
2. **Thread kit.** Does the Amazon kit come with a numbered colour chart? Many "for Brother" kits are numbered to match Brother's colours. If so, it could ship as a ready-made My threads preset.
