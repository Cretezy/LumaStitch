# SPDX-License-Identifier: GPL-3.0-or-later
"""Independent cutting validation: pip install ezdxf==1.4.4; python tests/tools/check_applique_cuts.py."""
import json
from pathlib import Path
import ezdxf
root = Path(__file__).resolve().parents[2] / 'docs/applique/cutting'
manifest = json.loads((root / 'manifest.json').read_text())
for piece in manifest['pieces']:
    doc = ezdxf.readfile(root / piece['dxf'])
    audit = doc.audit()
    assert not audit.errors and not audit.fixes
    assert doc.units == 4
    rings = list(doc.modelspace().query('LWPOLYLINE'))
    assert len(rings) == piece['holes'] + 1
    assert all(r.closed for r in rings)
    points = [(p[0], p[1]) for r in rings for p in r.get_points()]
    width = max(p[0] for p in points) - min(p[0] for p in points)
    height = max(p[1] for p in points) - min(p[1] for p in points)
    assert abs(width - piece['widthMm']) < .002
    assert abs(height - piece['heightMm']) < .002
    print(piece['dxf'], len(rings), 'closed contours;', width, 'x', height, 'mm; clean audit')
