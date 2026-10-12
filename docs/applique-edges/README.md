# Selective appliqué covers and open borders

Select an appliqué shape and choose **Object → Appliqué edge coverage**. Click the drawn border or check individual Bézier edges to omit their satin cover. The preview shows retained satin in green and omitted source edges in red. Placement and tack-down remain complete, including the contours around holes. This is useful when a cover edge will be joined or finished separately; omitting satin alone does not create an unsewn opening.

| Complete cover | Selected top cover omitted |
| --- | --- |
| ![Complete cover](before/stitch-out.gif) | ![Selective cover](after/stitch-out.gif) |
| [Project](before/before.lumastitch) · [PES](before/before.pes) · [DST](before/before.dst) | [Project](after/after.lumastitch) · [PES](after/after.pes) · [DST](after/after.dst) |

The same 50 × 40 mm shape with a circular window goes from **1,379 to 1,169 needles**, keeping four trims and two fabric-handling stops. Jump distance changes from 79.28 to 71.27 mm. This is a requested border omission, not an equivalent-coverage routing benchmark. The visible zigzag on the omitted edge is the retained tack-down. The placement connection across the patch will sit under the appliqué fabric, which the thread-only animation does not render.

[Edge editor screenshot](edge-editor.png)

For a border with an actual open side, draw an open path and choose **Outline → Appliqué border**. Placement, tack-down and satin cover follow that path without closing it. Covers are centered on the drawn line; closed appliqué fills continue to inset the cover inside their outline. Running, double-running and zigzag tack-down are supported. Double-running returns along an open path. Pre-cut mode retains the placement stop and skips the trimming stop. Distinct open paths use explicit trim/jump connections in every phase.

![Open border stitch-out](open-border/stitch-out.gif)

[Open-border project](open-border/open-border.lumastitch) · [PES](open-border/open-border.pes) · [DST](open-border/open-border.dst)

The U-shaped border has 718 needles, two trims, two stops and 102.44 mm of jumps. Each example also includes SVG artwork and a PNG. Open borders do not define closed fabric pieces, so they are not treated as cutting outlines or automatic fabric-coverage masks. Draw a separate closed appliqué object when a cutting package is needed.

Selections follow source edge indices through translation, rotation, reflection and cover-width changes. Inset cover samples are assigned to the nearest original Bézier edge. Sampling uses 0.1 mm steps plus projected endpoints/midpoints of selected edges, with transitions refined to 0.005 mm. Add nodes before selection for finer control. Node-count or closed/open topology changes invalidate saved selections with an explicit diagnostic; reopen the dialog to review/reset them. At most 500 source edges and 20 million distance comparisons are allowed. Automatic omission beneath later fabric pieces combines with manual omission on closed fills. Explicit cover gaps remain trim/jumps even below the normal short-hop threshold.

Tests cover placement/tack-down preservation, hole retention, transforms, width changes, stale topology, cached-plan invalidation, all-cover omission, 0.02 mm gaps, three open-border tack-down styles, stops, project persistence and every decoded PES needle. Browser tests use the real preview, type selector, undo and reload. These are software results; physical fabric, cut registration and sewn edge quality remain unverified.

```sh
EXAMPLES_MODULE=/tests/applique-edges/examples.ts node scripts/stitch-examples.mjs . docs/applique-edges
npm run build
node scripts/applique-edges-screenshot.mjs
```
