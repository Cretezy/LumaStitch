# Connected satin branches

Open [the before project](before/before.lumastitch), select the fern, and enable **Advanced → Connect satin branches**. All eleven centerlines belong to one compound path. Separate objects can first be combined with **Path → Combine**. Width, spacing, compensation and underlay remain editable.

| Metric | Separate columns | Connected branches |
| --- | ---: | ---: |
| Trims | 9 | 0 |
| Jump distance | 54.17 mm | 0 mm |
| Needle penetrations | 1,593 | 1,677 |
| Underpath/travel distance | 0.87 mm | 204.99 mm |
| Thread length | 3,316 mm | 3,529 mm |

The connected route trades extra covered running stitches for fewer jumps/trims. Curves stay continuous between junctions; repeated branch visits get running underpaths before their final satin pass. Underlay direction is accounted for, including combinations that return to their starting end. Junction overlap can raise density; use the density map and a physical sample to evaluate it.

| Before | After |
| --- | --- |
| ![Separate satin columns](before/stitch-out.gif) | ![Connected satin branches](after/stitch-out.gif) |

Each folder contains an editable project, SVG, PES, DST, preview PNG and GIF. These GIFs render actual stitch plans, not physical sew-outs. There is no trim at a connected junction; disconnected components still require jumps/trims. The initial positioning command remains but has zero travel in this example.

This option handles constant-width centerline satin outlines. It does not auto-route groups of variable-width explicit rail columns. [Ink/Stitch's satin tools](https://inkstitch.org/docs/satin-tools/) offer that broader workflow; this example is a LumaStitch option-off/option-on comparison, not a full-software benchmark. Routing is bounded to 1,000 flattened source segments, 1,000 graph vertices and 3,000 graph edges; oversized geometry falls back with a diagnostic.

Reproduce:

```sh
EXAMPLES_MODULE=/tests/satin-branches/examples.ts node scripts/stitch-examples.mjs . docs/satin-branches
```
