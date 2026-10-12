# Routing variable-width satin rails

Select 2–50 **Satin rails** objects and choose **Object → Group satin rails for routing**. The group keeps the original rails and direction guides, builds a connected centerline graph, and uses covered center walks to reach branches. Each source interval receives its final satin pass once. Previously sewn center walks can also supply center underlay, avoiding redundant passes. The widths are defined by the actual rails, not replaced with a constant-width outline.

| Separate columns | Grouped rail network |
| --- | --- |
| ![Separate satin rails](before/stitch-out.gif) | ![Grouped satin rails](after/stitch-out.gif) |
| [Project](before/before.lumastitch) · [PES](before/before.pes) · [DST](before/before.dst) | [Project](after/after.lumastitch) · [PES](after/after.pes) · [DST](after/after.dst) |

The seven-column vine contains a tapered stem, six curved leaves with changing widths, explicit direction guides, center-and-edge underlay and 0.15 mm pull compensation. Each folder also includes SVG artwork and a static PNG. The animated output uses the real stitch renderer and exported needle plan. [Editable rail/guide screenshot](rail-editor.png).

| Measurement | Separate | Grouped |
| --- | ---: | ---: |
| Needles | 1,349 | 1,378 |
| Trims | 3 | 0 |
| Jump distance | 35.67 mm | 0 mm |
| Travel flagged in the plan | 0 mm | 204.42 mm |
| Thread length | 4,255.61 mm | 4,323.20 mm |
| Estimated sewing time | 152.9 s | 137.8 s |

The estimate uses 600 stitches/minute and six seconds per trim; it is not a measured machine run. Some center underlay becomes a flagged travel underpath when reused, so the travel row is not the net added thread. The group adds 29 needles and 67.59 mm of total thread in exchange for removing three trims. Junction stacking can change because the branch order changes. These measured results do not establish superiority on every design or physical sew quality.

Columns must share a thread, effective stitch parameters and tie/trim settings, and occupy a contiguous sewing-sequence interval without intervening stops. Grouping snapshots those settings. Width differences remain in the rails. Position-specific entry/exit hints are cleared; new hints can be placed on the group. Rail and rung nodes remain editable, and whole-object transforms preserve the grouped definition. **Object → Ungroup satin rails** restores separate columns with their current geometry/settings. Ungroup before splitting one column. All operations support undo and saved projects. Grouping lettering members detaches their text definition, like other geometry-combining commands.

Graph preparation simplifies only centerline routing geometry at 0.01 mm and snaps neighboring endpoint junctions by at most 0.05 mm. Original rail samples remain unchanged. Arclength maps preserve source identity through crossings and coincident columns. Degree-two segments are joined before generating satin, so ordinary curve samples do not become separate capped columns. The graph retains the existing 1,000-segment/vertex and 3,000-edge bounds; larger groups receive a diagnostic and sew separate columns in saved order. Each column permits up to 2,000 embedded direction guides. Inserting/deleting complete subpaths can invalidate group counts and requires undo or ungrouping; ordinary rail-node edits remain supported.

Tests verify variable widths with every underlay combination, final coverage of every source interval, center-underlay reuse, coincident sources, disconnected trims, cached rail/guide edits, incompatible-setting and interleaved-stop rejection, ungrouping, project persistence, and every decoded needle in both PES files. Browser tests exercise grouping, undo/redo, saved reload and ungrouping.

```sh
EXAMPLES_MODULE=/tests/satin-rails/examples.ts node scripts/stitch-examples.mjs . docs/satin-rails
npm run build
node scripts/satin-rails-screenshot.mjs
```
