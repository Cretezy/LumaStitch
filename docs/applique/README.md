# Partial appliqué and fabric cutting

[Before project](before/before.lumastitch) · [Pre-cut / partial-cover project](after/after.lumastitch) · [Cutting ZIP](cutting.zip) · [Numbered layout](cutting/layout.svg) · [Cutting dialog](dialog.png)

Two overlapping patches demonstrate a lower fabric window, separate thread colors, placement, tack-down and cover stitching. **Pre-cut fabric** keeps the placement stop but skips the trimming stop. **Omit covered satin** removes cover segments fully hidden by later appliqué fabric; placement and tack-down stay complete. The omission accounts for cover width and preserves visible edges inside later holes. Reordering patches or changing later geometry/width regenerates it.

| Metric | Trim in place, full cover | Pre-cut, partial cover |
| --- | ---: | ---: |
| Needle penetrations | 1,660 | 1,528 |
| Stage stops | 4 | 2 |
| Trims | 7 | 6 |
| Jump distance | 70.92 mm | 56.04 mm |
| Thread length | 4,674 mm | 4,252 mm |

| Before | After |
| --- | --- |
| ![Full covers](before/stitch-out.gif) | ![Partial covers](after/stitch-out.gif) |

Each example includes a project, SVG artwork, PES, DST, PNG and GIF. These previews render thread only: they do not display the appliqué fabric that covers placement travel and the hidden lower tack-down. They are software previews, not physical sew-outs. The example changes both stage policy and partial coverage; it is not a same-parameters optimizer benchmark.

## Cutting workflow

1. Open the after project and choose **File → Appliqué cutting export**.
2. Use zero allowance and 120 mm sheet width to reproduce the included package. Positive allowance enlarges fabric and shrinks holes; negative allowance does the reverse. It must stay below half each cover width. Mirroring flips patches for backing-side cutting without changing the sewing design.
3. Import individual `piece-001.svg` / `.dxf` files or the unlabeled `sheet.svg` / `.dxf` into cutter software. `layout.svg` includes numbers for reference and should not be sent as cut geometry. Verify dimensions and disable automatic scaling.
4. Place each cut patch during its placement stop. Pre-cut mode omits the trimming stop after tack-down. Use a sample to establish cut allowance and registration for the actual materials.

Cut outlines lie on the placement line, half the satin width inside artwork, independently of pull compensation. The package retains the source design and records numbering, source bounds, dimensions, holes and sheet positions in [manifest.json](cutting/manifest.json). Numbering follows sewing order. Pieces use row packing with 10 mm gaps; an oversized piece expands sheet width. This is SVG/DXF geometry interchange, not proprietary cutter instructions or physical registration validation.

Tests cover unchanged placement/tack-down phases, stage stops and PES decoding, later-hole visibility, fully hidden covers, cache invalidation, cut offsets, units, holes, mirroring and browser undo/persistence. Independent **ezdxf 1.4.4** reads both example DXFs with zero audit errors/fixes and confirms closed contours and dimensions: 36.996 × 36.996 mm with one hole; 30.997 × 36.994 mm without holes. [Reproduce the independent check](../../tests/tools/check_applique_cuts.py).

[Hatch's appliqué documentation](https://hatch.embroideryhelp.net/v4/en/OnlineHelp/Advanced/applique/Appliqu%C3%A9_styles.htm) describes comparable pre-cut stages, and [its partial-appliqué overview](https://hatchembroidery.com/resources/blog/introducing-the-applique-tool-in-hatch-embroidery-digitizer) describes retaining placement/tack-down while removing overlapping cover stitches. These references guide feature scope; no direct Hatch output comparison is claimed.

```sh
EXAMPLES_MODULE=/tests/applique/examples.ts node scripts/stitch-examples.mjs . docs/applique
node scripts/applique-package.mjs
node scripts/applique-screenshot.mjs
```
