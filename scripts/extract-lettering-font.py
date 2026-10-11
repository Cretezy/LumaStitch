#!/usr/bin/env python3
"""Extract pinned Geneva Simple SVG paths without changing the licensed font geometry."""
import json
import pathlib
import xml.etree.ElementTree as ET

root = pathlib.Path(__file__).resolve().parents[1] / 'src/lettering/fonts/geneva-simple'
svg = ET.parse(root / 'source.svg').getroot()
inkscape = '{http://www.inkscape.org/namespaces/inkscape}'
inkstitch = '{http://inkstitch.org/namespace}'
glyphs = {}

def paths(node, transforms):
    transforms = transforms + ([node.get('transform')] if node.get('transform') else [])
    if node.tag.endswith('}path') and node.get('d'):
        satin = node.get(inkstitch + 'satin_column', '').lower() == 'true'
        yield {
            'd': node.get('d'), 'transforms': transforms, 'satin': satin,
            'underlay': ('centerZigzag' if node.get(inkstitch + 'center_walk_underlay') == 'True'
                         else 'zigzag') if satin else 'none',
            'pull': float(node.get(inkstitch + 'pull_compensation_mm', '0.2')),
        }
    for child in node:
        yield from paths(child, transforms)

for layer in svg:
    label = layer.get(inkscape + 'label', '')
    if label.startswith('GlyphLayer-'):
        glyphs[label.removeprefix('GlyphLayer-')] = list(paths(layer, []))

(root / 'glyphs.json').write_text(json.dumps(glyphs, ensure_ascii=False, separators=(',', ':')) + '\n')
print(f'Extracted {len(glyphs)} glyphs')
