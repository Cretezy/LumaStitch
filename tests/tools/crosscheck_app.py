"""Checks app-generated PES files with pyembroidery: stitch count, colour count and bounds.

Usage: python tests/tools/crosscheck_app.py <dir written by tests/integration/pyembroidery.crosscheck.test.ts>
"""
import json
import os
import sys

import pyembroidery

d = sys.argv[1]
exp = json.load(open(os.path.join(d, "expected.json")))
ok = True
for v in (1, 6):
    p = pyembroidery.read(os.path.join(d, f"app.v{v}.pes"))
    stitches = p.count_stitch_commands(pyembroidery.STITCH)
    colors = len(p.threadlist)
    minx, miny, maxx, maxy = p.bounds()
    w, h = (maxx - minx) / 10, (maxy - miny) / 10
    good = stitches == exp["stitches"] and colors == exp["colorBlocks"] and abs(w - exp["widthMm"]) < 0.15 and abs(h - exp["heightMm"]) < 0.15
    ok &= good
    print(f"v{v}: stitches {stitches} (app {exp['stitches']}), colours {colors} (app {exp['colorBlocks']}), "
          f"size {w:.1f}x{h:.1f} (app {exp['widthMm']:.1f}x{exp['heightMm']:.1f}) -> {'OK' if good else 'MISMATCH'}")
sys.exit(0 if ok else 1)
