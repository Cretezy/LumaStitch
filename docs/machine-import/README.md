# Editable machine-file example

![Imported botanical stitch-out](imported-botanical/stitch-out.gif)

This design is imported from the [complete satin botanical PES](../stitch-examples/after/satin-botanical/satin-botanical.pes). Its original needle positions and machine commands become editable manual nodes. Open the [editable project](imported-botanical/imported-botanical.lumastitch), use the node tool to select a needle, and change its command in the inspector. Moving or scaling changes existing stitches; it does not recalculate density. Undo restores edits.

The folder also contains SVG geometry, re-exported PES/DST, a final PNG and the animated stitch-out. PES re-export preserves every imported needle coordinate at 0.1 mm precision. Machine-format normalization can change jump segmentation, trim interpretation and stop representation; byte identity is not promised.

PES, DST, JEF, EXP and VP3 readers are checked against full independent pyembroidery 1.5.1 command streams for 48 reference files. DST/EXP may lack color data; assign the displayed placeholders. DST/JEF trim-like jump sequences remain explicit jumps rather than guessed trim commands. Import preserves the stitch program without reconstructing the original digitizing objects or text. The separate [stitch recognition workflow](../recognition/README.md) can infer simple satin rails, tatami boundaries and spacing for editing, with manual fallback; it does not recover the original source file.

Reproduce the artifacts with:

```sh
EXAMPLES_MODULE=/tests/machine-import/examples.ts node scripts/stitch-examples.mjs . docs/machine-import
```

The GIF is a rendering of the computed needle program, not a physical sew-out.
