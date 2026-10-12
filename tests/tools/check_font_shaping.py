# SPDX-License-Identifier: GPL-3.0-or-later
"""Independent reference: pip install uharfbuzz==0.56.3; run from repository root."""
import base64
import json
import unicodedata
from pathlib import Path
import uharfbuzz as hb

for path in sorted(Path('docs/opentype').glob('*/*.lumastitch')):
    design = json.loads(path.read_text())['design']
    options = design['lettering']['text']['options']
    settings = options['openType']
    face = hb.Face(base64.b64decode(settings['data']))
    font = hb.Font(face)
    font.set_variations(settings['variations'])
    expected = settings['prepared']
    assert face.upem == expected['upem']
    for line, reference in zip(unicodedata.normalize('NFC', options['text']).split('\n'), expected['lines'], strict=True):
        buf = hb.Buffer()
        # Scalar cluster indices equal UTF-16 indices in these BMP-only fixtures.
        assert all(ord(c) <= 0xffff for c in line)
        buf.add_str(line)
        buf.guess_segment_properties()
        if settings['direction'] != 'auto':
            buf.direction = settings['direction']
        if settings['language']:
            buf.language = settings['language']
        hb.shape(font, buf)
        x = 0
        actual = []
        for i, (info, pos) in enumerate(zip(buf.glyph_infos, buf.glyph_positions, strict=True)):
            actual.append((info.codepoint, info.cluster, x + pos.x_offset, pos.y_offset))
            x += pos.x_advance
            if i + 1 < len(buf.glyph_infos) and buf.glyph_infos[i + 1].cluster != info.cluster:
                x += options['letterSpacing'] * face.upem / options['height']
            if line[info.cluster] == ' ':
                x += options['wordSpacing'] * face.upem / options['height']
        assert actual == [(g['id'], g['cluster'], g['x'], g['y']) for g in reference['glyphs']], path
        assert x == reference['advance'], path
    print(f'{path.parent.name}: glyph IDs, clusters, advances and mark offsets match uharfbuzz {hb.__version__} (HarfBuzz {hb.version_string()})')
