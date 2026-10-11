# Satin and tatami examples

These original designs include the complete stitch-out, underlay, thread sequence and machine exports. Open the **project** in LumaStitch to retain all stitch settings; SVG contains artwork only. Both fit within a 100 × 100 mm hoop. The GIFs use the application's realistic stitch renderer on the actual generated plan: eight seconds of stitching followed by a two-second hold. Playback is accelerated; jumps and trims happen instantly. These are software previews, not photographs of physical sew tests.

## Satin botanical

Curved open columns form the stems and leaves, eight separate columns form the petals, and fixed-angle satin fills the centre. Column widths are 3, 5 and 6 mm, with 0.4 mm density, 0.2 mm pull compensation per side and edge-walk plus zigzag underlay. The centre uses edge underlay and splits stitches over 7 mm. Finished bounds: approximately **47.4 × 68 mm**, four thread colours.

| Before (`054c9470`) | After |
| --- | --- |
| ![Satin baseline animated stitch-out](before/satin-botanical/stitch-out.gif) | ![Satin improved animated stitch-out](after/satin-botanical/stitch-out.gif) |
| 1,798 stitches · 13 trims · 116.32 mm jumps | **1,759 stitches · 6 trims · 79.58 mm jumps** |

The new router evaluates the actual endpoints of both column directions, including underlay. This avoids treating a four-pass column as though it ended at its far end. Jump distance falls **31.6%**, and trims fall **53.8%**, without adding extra routing underpaths. The same stitch density, underlay and geometry are used on both revisions.

Download: [editable project](after/satin-botanical/satin-botanical.lumastitch) · [SVG artwork](after/satin-botanical/satin-botanical.svg) · [PES v6](after/satin-botanical/satin-botanical.pes) · [DST](after/satin-botanical/satin-botanical.dst) · [PNG preview](after/satin-botanical/preview.png) · [GIF](after/satin-botanical/stitch-out.gif). [Baseline files](before/satin-botanical/).

## Tatami compass

The outer ring and hub have open holes; the cardinal points, shadows and diagonal markers exercise disconnected regions. Fill angles are 0°, 30°, 45° and 90°, with 0.4 mm row spacing, 3.5 mm stitches, a four-row penetration stagger and 0.2 mm pull compensation. Underlay is perpendicular tatami, with an extra edge run on the rings. Finished bounds: approximately **78.4 × 78.4 mm**, three thread colours.

| Before (`054c9470`) | After |
| --- | --- |
| ![Tatami baseline animated stitch-out](before/tatami-compass/stitch-out.gif) | ![Tatami improved animated stitch-out](after/tatami-compass/stitch-out.gif) |
| 304.20 mm jumps · 227.72 mm travel · 13 trims | **288.44 mm jumps · 215.84 mm travel · 13 trims** |

The router prices actual fill exits and refines small designs by swapping adjacent colour blocks and same-colour neighbours, checking overlap precedence and scoring complete stitch plans. Jump and internal travel distances each fall about **5.2%** here. It retains two colour changes and 13 trims. This extra search increases generation time; see the [timing table](../routing/table.md).

Download: [editable project](after/tatami-compass/tatami-compass.lumastitch) · [SVG artwork](after/tatami-compass/tatami-compass.svg) · [PES v6](after/tatami-compass/tatami-compass.pes) · [DST](after/tatami-compass/tatami-compass.dst) · [PNG preview](after/tatami-compass/preview.png) · [GIF](after/tatami-compass/stitch-out.gif). [Baseline files](before/tatami-compass/).

DST stores movements and colour-change commands rather than a full thread palette; use the project or PES v6 for the intended colours. The PES regression tests decode the exported files and compare every needle penetration against the illustrated plans at machine resolution (0.1 mm).

## Reproduce

Install the locked dependencies, Playwright Chromium and FFmpeg, then run:

```bash
npm ci
npx playwright install chromium
node scripts/stitch-examples.mjs . docs/stitch-examples/after
jj workspace add /tmp/lumastitch-routing-before -r 054c9470
ln -s "$PWD/node_modules" /tmp/lumastitch-routing-before/node_modules
cp -r tests/routing /tmp/lumastitch-routing-before/tests/routing
node scripts/stitch-examples.mjs /tmp/lumastitch-routing-before docs/stitch-examples/before
```

Forget the temporary Jujutsu workspace afterwards. Geometry and parameters come from [stitch-examples.ts](../../tests/routing/stitch-examples.ts). Raw complete-plan metrics: [before](before/metrics.json), [after](after/metrics.json). Jump distance excludes initial positioning, for which no preceding needle position exists.

The separate [Ink/Stitch comparison](../routing/README.md#inkstitch-reference) exercises its running graph router. These satin and tatami examples compare LumaStitch revisions; they do not claim end-to-end parity with Ink/Stitch's satin or fill engines.
