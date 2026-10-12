# Keep overlapping layers together across hoopings

**File → Multi-hooping export → Keep whole objects when they fit** now preserves groups of touching source shapes, including their fill and outline. All shapes in a connected group must fit one common field. If they do, the group moves together and keeps its source sewing order. If they do not, every member retains its ordinary seam ownership. Oversized backgrounds therefore continue to protect their overlapping foreground layers from being sewn in the wrong order.

This extends the [isolated-object policy](../hooping-objects/README.md). The group test uses quantized source penetrations, incoming sewn connectors and conservative sewn-chord bounds with a 0.5 mm contact band. Contacts are transitive: when A touches B and B touches C, all three must share a field, even if A does not directly touch C. Rotated fields use the same local-frame fit test. Long diagonal chord bounds can join shapes conservatively and prevent some otherwise safe moves.

The feature assigns groups to the existing calculated or manually placed fields. It does not optimize field placement by unrestricted packing, split an oversized group into reconstructed vector objects, or certify physical registration.

## Before and after

The source contains a long running border and two badges, each built from a gold tatami background and a separate cream satin star. The backgrounds sew before the stars. Ordinary grid seams cut both badges; the new policy keeps both layers of each badge together in one field. The long border still splits.

| Package metric | Ordinary seams | Whole layer groups |
| --- | ---: | ---: |
| Hoopings | 3 | 3 |
| Source needles retained | 897 | 897 |
| Total needles including registration and seam locks | 1,472 | 1,368 |
| Trims | 47 | 37 |
| Jump distance | 917.46 mm | 755.01 mm |
| Machine color changes | 9 | 7 |
| Source objects kept whole | 0 | 4 (two touching pairs) |

The third hoop still completes the long border; field count is not reduced. Software renders and command checks do not establish physical seam quality.

| First field before | First field after |
| --- | --- |
| ![Badge cut at the field seam](before-hoop-1/stitch-out.gif) | ![Both badge layers kept whole](after-hoop-1/stitch-out.gif) |

[Complete before package](before.zip), [complete after package](after.zip). ZIPs include numbered PES files, editable stitch projects, source project, placement template, manifest and registration instructions. The manifest's `wholeObjects[].layerGroup` is the first source shape ID in a touching group. Entries sharing that identifier moved together; membership does not duplicate a potentially large shape list on every object.

| Field | Editable project | Artwork | Machine outputs | Preview / animation |
| --- | --- | --- | --- | --- |
| Source | [Project](source-panel/source-panel.lumastitch) | [SVG](source-panel/source-panel.svg) | [PES](source-panel/source-panel.pes), [DST](source-panel/source-panel.dst) | [PNG](source-panel/preview.png), [GIF](source-panel/stitch-out.gif) |
| Before 1 | [Project](before-hoop-1/before-hoop-1.lumastitch) | [SVG](before-hoop-1/before-hoop-1.svg) | [PES](before-hoop-1/before-hoop-1.pes), [DST](before-hoop-1/before-hoop-1.dst) | [PNG](before-hoop-1/preview.png), [GIF](before-hoop-1/stitch-out.gif) |
| Before 2 | [Project](before-hoop-2/before-hoop-2.lumastitch) | [SVG](before-hoop-2/before-hoop-2.svg) | [PES](before-hoop-2/before-hoop-2.pes), [DST](before-hoop-2/before-hoop-2.dst) | [PNG](before-hoop-2/preview.png), [GIF](before-hoop-2/stitch-out.gif) |
| Before 3 | [Project](before-hoop-3/before-hoop-3.lumastitch) | [SVG](before-hoop-3/before-hoop-3.svg) | [PES](before-hoop-3/before-hoop-3.pes), [DST](before-hoop-3/before-hoop-3.dst) | [PNG](before-hoop-3/preview.png), [GIF](before-hoop-3/stitch-out.gif) |
| After 1 | [Project](after-hoop-1/after-hoop-1.lumastitch) | [SVG](after-hoop-1/after-hoop-1.svg) | [PES](after-hoop-1/after-hoop-1.pes), [DST](after-hoop-1/after-hoop-1.dst) | [PNG](after-hoop-1/preview.png), [GIF](after-hoop-1/stitch-out.gif) |
| After 2 | [Project](after-hoop-2/after-hoop-2.lumastitch) | [SVG](after-hoop-2/after-hoop-2.svg) | [PES](after-hoop-2/after-hoop-2.pes), [DST](after-hoop-2/after-hoop-2.dst) | [PNG](after-hoop-2/preview.png), [GIF](after-hoop-2/stitch-out.gif) |
| After 3 | [Project](after-hoop-3/after-hoop-3.lumastitch) | [SVG](after-hoop-3/after-hoop-3.svg) | [PES](after-hoop-3/after-hoop-3.pes), [DST](after-hoop-3/after-hoop-3.dst) | [PNG](after-hoop-3/preview.png), [GIF](after-hoop-3/stitch-out.gif) |

[Before placement](before-layout.svg), [after placement](after-layout.svg), [before manifest](before-manifest.json), [after manifest](after-manifest.json), [metrics](metrics.json).

![Whole layer group option in the hooping dialog](dialog.png)

## Verification

Tests cover shared-field assignment, transitive contacts with no common field, unchanged oversized-background fallback, source color-layer order, every source needle after rotation, decoded field fit in all five formats, exact reproduction of all six illustrated PES files, compact group metadata, the dense-cell work limit even after groups merge, undo and project persistence. The earlier six isolated-object PES fixtures remain unchanged.

```sh
EXAMPLES_MODULE=/tests/hooping-layers/examples.ts node scripts/stitch-examples.mjs . docs/hooping-layers
node scripts/hooping-layers-package.mjs
npm run build
node scripts/hooping-layers-screenshot.mjs
```
