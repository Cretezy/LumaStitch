#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Independent synthetic needle patterns, serialized by pyembroidery 1.5.1 (MIT).

No LumaStitch generator is used. Each file contains a 0.4 mm variable-width satin
and a 0.5 mm tatami rectangle, at six angles, in five machine formats.
"""
import math
from pathlib import Path
import pyembroidery as pe

out = Path(__file__).resolve().parents[1] / 'fixtures' / 'recognition'
out.mkdir(exist_ok=True)
for degrees in [0, 17, 45, 90, 133, 178]:
    angle = math.radians(degrees)
    def point(x, y):
        return [round(10 * (x * math.cos(angle) - y * math.sin(angle))),
                round(10 * (x * math.sin(angle) + y * math.cos(angle)))]
    for ext in ['pes', 'dst', 'jef', 'exp', 'vp3']:
        p = pe.EmbPattern()
        p.add_thread({'color': '#296450', 'name': 'Recognition reference'})
        p.add_stitch_absolute(pe.JUMP, *point(0, -3))
        for i in range(151):
            p.add_stitch_absolute(pe.STITCH, *point(i * 0.2, (-1 if i % 2 == 0 else 1) * (3 + math.sin(i / 150 * math.pi))))
        p.add_stitch_absolute(pe.TRIM, *point(30, -3))
        p.add_stitch_absolute(pe.JUMP, *point(0, 12))
        for row in range(25):
            for col in range(13):
                p.add_stitch_absolute(pe.STITCH, *point((12-col if row % 2 else col) * 2, 12 + row * 0.5))
        p.add_stitch_absolute(pe.END, *point(24, 24))
        pe.write(p, str(out / f'angle-{degrees}.{ext}'), {'version': 6, 'date': '20261012000000'})
print('Wrote 30 machine files with independently constructed satin and tatami patterns.')
