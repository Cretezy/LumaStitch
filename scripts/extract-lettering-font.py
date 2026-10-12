#!/usr/bin/env python3
"""Extract pinned digitized SVG paths without changing the licensed font geometry."""
import argparse
import json
import pathlib
import xml.etree.ElementTree as ET

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('font', nargs='?', default='geneva-simple', choices=['geneva-simple', 'geneva-rounded', 'chopin'])
parser.add_argument('--check', action='store_true', help='Compare extracted paths without writing files')
args = parser.parse_args()
root = pathlib.Path(__file__).resolve().parents[1] / 'src/lettering/fonts' / args.font
# Keep the original Geneva Simple import rules for existing saved-output compatibility.
legacy = args.font == 'geneva-simple'
svg = ET.parse(root / 'source.svg').getroot()
inkscape = '{http://www.inkscape.org/namespaces/inkscape}'
inkstitch = '{http://inkstitch.org/namespace}'
glyphs = {}

def paths(node, transforms, inherited_style=None):
    style = dict(inherited_style or {})
    style.update(item.split(':', 1) for item in node.get('style', '').split(';') if ':' in item)
    transforms = transforms + ([node.get('transform')] if node.get('transform') else [])
    if node.tag.endswith('}path') and node.get('d'):
        satin = node.get(inkstitch + 'satin_column', '').lower() == 'true' and (legacy or style.get('stroke-dasharray', 'none') == 'none')
        yield {
            'd': node.get('d'), 'transforms': transforms, 'satin': satin,
            'underlay': ('centerZigzag' if node.get(inkstitch + 'center_walk_underlay') == 'True'
                         else 'zigzag') if satin else 'none',
            'pull': float(node.get(inkstitch + 'pull_compensation_mm', '0.2')),
            **({'stitchLength': float(node.get(inkstitch + 'running_stitch_length_mm'))} if not legacy and node.get(inkstitch + 'running_stitch_length_mm') else {}),
        }
    for child in node:
        yield from paths(child, transforms, style)

for layer in svg:
    label = layer.get(inkscape + 'label', '')
    if label.startswith('GlyphLayer-'):
        glyphs[label.removeprefix('GlyphLayer-')] = list(paths(layer, []))

if args.check:
    if glyphs != json.loads((root / 'glyphs.json').read_text()):
        raise SystemExit(f'{args.font}: extracted path data differs')
    print(f'{args.font}: {len(glyphs)} glyphs reproduce exactly')
else:
    (root / 'glyphs.json').write_text(json.dumps(glyphs, ensure_ascii=False, separators=(',', ':')) + '\n')
    print(f'Extracted {len(glyphs)} glyphs')
