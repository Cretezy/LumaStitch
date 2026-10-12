# Arbitrary guided fills

Select one closed fill shape and one or more open paths, then choose **Object → Make guided fill**. The guide becomes an editable subpath of the fill shape, shown as a turquoise dashed curve. Move its nodes and Bézier handles with the node tool. The whole operation supports undo; guides and stitch parameters survive project saving.

| Strategy | Behavior | Complete example |
| --- | --- | --- |
| Parallel offset | Constant-distance contours around guides whose endpoint tangents extend beyond the fill | [Project](guided-parallel/guided-parallel.lumastitch) · [PES](guided-parallel/guided-parallel.pes) · [GIF](guided-parallel/stitch-out.gif) |
| Translated copies | Copies shifted at the selected angle; curved rows can overlap or vary in perpendicular spacing | [Project](guided-copy/guided-copy.lumastitch) · [PES](guided-copy/guided-copy.pes) · [GIF](guided-copy/stitch-out.gif) |
| Buffer | Constant-distance contours around finite guides, including round endpoint caps | [Project](guided-buffer/guided-buffer.lumastitch) · [PES](guided-buffer/guided-buffer.pes) · [GIF](guided-buffer/stitch-out.gif) |

![Parallel guide stitch-out](guided-parallel/stitch-out.gif)

Each example is a 60 × 50 mm ellipse with a 14 × 12 mm hole and an S-shaped guide, 0.65 mm row spacing, 3 mm maximum stitches, and edge/tatami underlay. Each folder includes an editable project, SVG artwork with separate guide paths, PES, DST, final PNG and GIF. Open the project to retain guided-fill behavior; SVG export is artwork geometry.

Offset contours resolve self-intersections and merge where guide neighborhoods meet. Both curve segments and the resulting needle chords are clipped against the fill and its holes. Travel uses an inset visibility region and jumps where no reasonable internal route exists. Adjacent curves are sewn together; moves between rows beyond the configurable 4 mm travel limit are trimmed to avoid lines across completed fill. Underlay uses the selected straight-fill angle. Numerical limits reject excessively large offset/copy work instead of silently exporting incomplete fills.

Tests check straight-guide spacing analytically, every sampled sewn segment against the fill/hole boundary, maximum stitch length, deterministic output, and project round trips. Browser coverage exercises the menu workflow, undo and reload. These are software checks; physical sew quality remains unverified.

Reproduce:

```sh
EXAMPLES_MODULE=/tests/guided-fill/examples.ts node scripts/stitch-examples.mjs . docs/guided-fill
```

The comparison feature definitions are documented by [Ink/Stitch guided fill](https://inkstitch.org/docs/stitches/guided-fill/). LumaStitch's implementation uses its own geometry and routing code with Clipper2 offsets.
