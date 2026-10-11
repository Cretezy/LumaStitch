# Multi-hooping example

Open [the source project](source-banner/source-banner.lumastitch), then **File → Multi-hooping export**. Calculate with a 100 × 100 mm field, 3 mm margin and 12 mm overlap. The 200 mm botanical border becomes three numbered hoopings.

[Download the complete PES package](multi-hooping.zip) · [Placement template](layout.svg) · [Manifest](manifest.json) · [Export dialog](dialog.png)

| Complete source | Hoop 1 | Hoop 2 | Hoop 3 |
| --- | --- | --- | --- |
| ![Source](source-banner/stitch-out.gif) | ![Hoop 1](hoop-01/stitch-out.gif) | ![Hoop 2](hoop-02/stitch-out.gif) | ![Hoop 3](hoop-03/stitch-out.gif) |

Each folder contains an editable project, SVG, PES, DST, PNG and GIF. Numbered projects contain editable machine stitches; the original vector design stays in `source.lumastitch` inside the ZIP. Changing density requires generating a new package from the source.

The layout is a centered rectangular grid with overlapping fields, sewn in serpentine order. Stitch segments are partitioned at the middle of overlaps. Every original needle penetration is retained; seam penetrations, short locks, trims, basting and registration stitches are added. The **Join nearby seam endpoints** option connects successive visits up to 1 mm apart along the same seam; disable it to trim every separate visit. Source jumps, trims, color changes and stops still terminate sections. Appliqué stage stops are retained in every hoop touched by that phase.

Every numbered file starts with a temporary symmetric basting frame and shared cross pairs, then stops before the design colors. Align the common pair with the neighboring hooping to establish position and rotation. The frame establishes consistent file centering and sits 0.5 mm inside the selected margin to accommodate format-specific trim jumps. Keep the frame in the program and disable machine auto-resizing. Remove temporary basting/registration thread after assembling the design. Empty fields can remain as registration-only steps.

The manifest gives each field's original-document center in mm (+x right, +y down), shared registration coordinates, file names and stitch statistics. Machine files use coordinates local to that center. Print the SVG template at 100% and verify its scale. This is ordinary rehooping, not a machine-specific multi-position hoop format. Arbitrarily placed/rotated hoops and object-preserving layout optimization remain separate work.

Tests verify source-needle coverage, two-dimensional order, shared registration pairs, seam-join savings, stage stops and decoded PES/DST/JEF/EXP/VP3 field fit. Export repeats the decoded field-fit check for the selected format. Bounds and segment checks do not establish physical registration accuracy; no machine sew-out is claimed.

Reproduce:

```sh
EXAMPLES_MODULE=/tests/hooping/examples.ts node scripts/stitch-examples.mjs . docs/hooping
node scripts/hooping-package.mjs
```
