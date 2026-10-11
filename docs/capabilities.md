# Capability parity

This is the acceptance ledger for the expanded LumaStitch scope. A feature is complete only with an accessible editing workflow, saved projects, undo, machine-file verification, and an example. Algorithm benchmarks establish the measured cases only; they do not establish universal superiority or physical sew quality.

| Capability | Current evidence | Remaining acceptance work |
| --- | --- | --- |
| Running, satin, tatami routing | [Measured before/after cases](routing/README.md), [complete examples and GIFs](stitch-examples/README.md) | Broader real-design corpus; satin splitting and branch underpaths |
| Lettering | [118-glyph digitized font, kerning, editable text, multiline/circular layout, monograms, batch names, project round-trip and GIF examples](lettering/README.md) | Arbitrary-path baselines, additional licensed fonts, font import, script shaping |
| Density inspection | Exact worker-computed circular penetration map, fixed quantitative legend, four radii; [UI screenshots and calibration fixture](inspection/README.md) | Fabric-specific thresholds backed by physical samples |
| Fabric calibration | Four starter presets and [reproducible calibration project, machine files and GIF](inspection/README.md) | Recorded physical results, custom reusable profiles |
| Machine-file editing | [PES/DST/JEF/EXP/VP3 editable import](machine-import/README.md), command editing, 48 independent decoder references, project/PES needle round trips | Original-object recognition; format-specific machine sew-outs |
| Guided fills | Wave, ripple, contour and gradient fills | Arbitrary guide geometry, consistent spacing, holes and travel validation |
| Hooping | Optional rectangle/ellipse sewing fields, margin, canvas boundary and warnings for all five export formats | Multiple hoopings, registration and export manifest |
| Appliqué | Placement/tackdown/cover passes and stops | Partial edge coverage, cut-file workflow, production examples |
| Specialty stitches | Motif, pattern, cross stitch, blanket, meander | Machine-specific sequins, beads and cording with validated command formats |
| Production | PES/DST/JEF/EXP/VP3 exports, simulation, worksheets | Format-specific round-trip coverage and reference-machine sew-outs |

References: [Ink/Stitch lettering](https://inkstitch.org/docs/lettering/), [satin tools](https://inkstitch.org/docs/satin-tools/), [guided fill](https://inkstitch.org/docs/stitches/guided-fill/), [density visualization](https://inkstitch.org/docs/visualize/#density-map), [Hatch stitch recognition](https://hatch.embroideryhelp.net/v4/en/OnlineHelp/Setup/assets/Machine_file_recognition.htm), [Hatch registration](https://hatch.embroideryhelp.net/v4/en/OnlineHelp/Hints/hints_hoops/Registration_marks.htm), [Wilcom product comparison](https://docs.wilcom.com/embroiderystudio/28/en/OnlineHelp/Release/product_comparison/product_comparison-1.htm).

Commercial products differ by edition and optional modules. Machine-specific accessories require suitable hardware and real sew-outs. Record physical evidence in [sew-tests.md](sew-tests.md); untested combinations remain unverified.
