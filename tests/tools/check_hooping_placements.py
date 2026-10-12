#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Independent PES decoder check for the committed rotated-field package (pyembroidery 1.5.1)."""
import io, json, math, zipfile
from collections import defaultdict
from pathlib import Path
import pyembroidery as pe
root = Path(__file__).resolve().parents[2] / 'docs/hooping-placements'
# Raw engine needles are quantized to the input grid before the per-field rotation.
original = json.loads((root / 'source-needles.json').read_text())
for name in ['before', 'after']:
    points = defaultdict(list)
    with zipfile.ZipFile(root / f'{name}.zip') as archive:
        manifest = json.loads(archive.read('manifest.json'))
        for part in manifest['hoopings']:
            pattern = pe.EmbPattern()
            pe.PesReader.read(io.BytesIO(archive.read(part['file'])), pattern)
            a = math.radians(part['clockwiseDegrees'])
            c, s = math.cos(a), math.sin(a)
            for x, y, command in pattern.stitches:
                command &= pe.COMMAND_MASK
                if command in (pe.STITCH, pe.JUMP):
                    assert abs(x) <= 470 and abs(y) <= 470, (name, part['number'], x, y)
                if command != pe.STITCH:
                    continue
                wx = part['centerMm'][0] + (c*x-s*y)/10
                wy = part['centerMm'][1] + (s*x+c*y)/10
                points[math.floor(wx*10), math.floor(wy*10)].append((wx, wy))
    far = 0
    for x,y in original:
        candidates = [p for dx in [-1,0,1] for dy in [-1,0,1]
                      for p in points[math.floor(x*10)+dx, math.floor(y*10)+dy]]
        nearest = min((math.hypot(px-x,py-y) for px,py in candidates), default=math.inf)
        assert nearest <= math.sqrt(2)*0.05 + 1e-7, (name,x,y,nearest)
        far = max(far, nearest)
    assert len(original) == manifest['sourceStitches']
    print(f'{name}: {len(manifest["hoopings"])} fields, all {len(original)} source needles retained; max reconstruction error {far:.5f} mm')
