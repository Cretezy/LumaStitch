#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Independent decoded command fixtures: pyembroidery 1.5.1, no inferred trims/clipping."""
import json
from pathlib import Path
import pyembroidery as pe

root = Path(__file__).resolve().parents[2]
out = {}
for folder in ['formats', 'pes']:
    for path in sorted((root / 'tests/fixtures' / folder).iterdir()):
        ext = path.suffix[1:]
        if ext not in ['pes', 'dst', 'jef', 'exp', 'vp3']:
            continue
        p = getattr(pe, 'read_' + ext)(str(path), settings={'trim_at': None, 'trim_distance': None, 'clipping': False})
        out[str(path.relative_to(root))] = [[x, y, cmd & 255] for x, y, cmd in p.stitches]
(root / 'tests/fixtures/machine-readers.json').write_text(json.dumps({'source': 'pyembroidery 1.5.1; trim_at=None, trim_distance=None, clipping=False', 'files': out}, separators=(',', ':')) + '\n')
