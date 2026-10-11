# Capability parity

This is the acceptance ledger for the expanded LumaStitch scope. A feature is complete only with an accessible editing workflow, saved projects, undo, machine-file verification, and an example. Algorithm benchmarks establish the measured cases only; they do not establish universal superiority or physical sew quality.

| Capability | Current evidence | Remaining acceptance work |
| --- | --- | --- |
| Running, satin, tatami routing | [Measured before/after cases](routing/README.md), [complete examples and GIFs](stitch-examples/README.md) | [Connected centerline satin branches](satin-branches/README.md) and [editable column splitting](satin-split/README.md) delivered; variable-width rail branching and broader real-design corpus remain |
| Lettering | [118-glyph digitized font, kerning, editable text, multiline/circular layout, monograms, batch names, project round-trip and GIF examples](lettering/README.md) | [Editable open-path baselines](lettering-path/README.md) delivered; [portable TTF/OTF import, three additional licensed fonts, variable axes and HarfBuzz shaping](opentype/README.md) delivered; full mixed-direction paragraph layout and a broader digitized-font catalog remain |
| Density inspection | Exact worker-computed circular penetration map, fixed quantitative legend, four radii; [UI screenshots and calibration fixture](inspection/README.md) | Fabric-specific thresholds backed by physical samples |
| Fabric calibration | Four starter presets, [calibration sampler](inspection/README.md), [portable custom profiles and example GIF](fabric/README.md) with inherited defaults and recorded setup notes | Recorded physical sew-out results |
| Machine-file editing | [PES/DST/JEF/EXP/VP3 editable import](machine-import/README.md), command editing, 48 independent decoder references, project/PES needle round trips | Original-object recognition; format-specific machine sew-outs |
| Guided fills | [Editable arbitrary Bézier guides with copy/parallel/buffer modes](guided-fill/README.md), clipped holes and needle chords, inside travel, underlay, three complete GIF examples | Broader pathological-guide corpus and physical sew-outs |
| Hooping | Optional rectangle/ellipse checks; [registered multi-hooping packages](hooping/README.md), seam splitting, shared crosses, placement SVG, manifest and five-format decoded fit checks | Physical registration tests; arbitrary/rotated hoop placement, object-preserving optimization, machine-specific multi-position hoops |
| Appliqué | Placement/tackdown/cover passes; pre-cut stage policy; conservative hidden-cover removal; [numbered SVG/DXF cutting packages and full GIF examples](applique/README.md) | Manual edge selection, open appliqué objects, cutter-specific commands and physical cut/registration tests |
| Specialty stitches | Motif, pattern, cross stitch, blanket, meander | Machine-specific sequins, beads and cording with validated command formats |
| Production | PES/DST/JEF/EXP/VP3 exports, simulation, worksheets | Format-specific round-trip coverage and reference-machine sew-outs |

References: [Ink/Stitch lettering](https://inkstitch.org/docs/lettering/), [satin tools](https://inkstitch.org/docs/satin-tools/), [guided fill](https://inkstitch.org/docs/stitches/guided-fill/), [density visualization](https://inkstitch.org/docs/visualize/#density-map), [Hatch stitch recognition](https://hatch.embroideryhelp.net/v4/en/OnlineHelp/Setup/assets/Machine_file_recognition.htm), [Hatch registration](https://hatch.embroideryhelp.net/v4/en/OnlineHelp/Hints/hints_hoops/Registration_marks.htm), [Wilcom product comparison](https://docs.wilcom.com/embroiderystudio/28/en/OnlineHelp/Release/product_comparison/product_comparison-1.htm).

Commercial products differ by edition and optional modules. Machine-specific accessories require suitable hardware and real sew-outs. Record physical evidence in [sew-tests.md](sew-tests.md); untested combinations remain unverified.
