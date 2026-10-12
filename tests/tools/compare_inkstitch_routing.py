# SPDX-License-Identifier: GPL-3.0-or-later
"""Compare graph traversal only, not the full Ink/Stitch extension or stitch generator.

Requires networkx==3.5 and an unmodified source file from Ink/Stitch commit
 d59c9ab1e390285a6c67822436ffd9ba9843d8b4, lib/stitches/utils/autoroute.py.
The two upstream functions are executed unchanged; UI imports are unnecessary.
Usage: python compare_inkstitch_routing.py autoroute.py cases.json output.json
"""
import ast
import hashlib
import json
import sys
import networkx as nx

source, cases_path, output = sys.argv[1:]
source_bytes = open(source, 'rb').read()
assert hashlib.sha256(source_bytes).hexdigest() == '98b0cb6cdbc1c2134790a6cf4089999b8e40d6e55db64284590fd061148ab90e', 'Source differs from the pinned Ink/Stitch commit'
tree = ast.parse(source_bytes.decode('utf-8'))
functions = [node for node in tree.body if isinstance(node, ast.FunctionDef)
             and node.name in ('find_path', '_get_shortest_path')]
assert len(functions) == 2, 'Expected the pinned Ink/Stitch routing functions'
namespace = {'nx': nx, 'check_stop_flag': lambda: None}
exec(compile(ast.Module(body=functions, type_ignores=[]), source, 'exec'), namespace)
results = []
for case in json.load(open(cases_path, encoding='utf-8')):
    graph = nx.Graph()
    for edge in case['edges']:
        graph.add_edge(edge['a'], edge['b'], length=edge['length'])
    path = namespace['find_path'](graph, case['start'], case['end'])
    assert path[0][0] == case['start'] and path[-1][1] == case['end']
    assert all(path[i][1] == path[i + 1][0] for i in range(len(path) - 1))
    assert {frozenset(edge) for edge in path} == {frozenset(edge) for edge in graph.edges}
    total = sum(graph[a][b]['length'] for a, b in path)
    results.append({key: case[key] for key in ('name', 'requiredMm', 'lumaTravelMm', 'lumaJumps')} |
                   {'inkstitchTravelMm': total - case['requiredMm'], 'inkstitchJumps': 0})
with open(output, 'w', encoding='utf-8') as stream:
    json.dump({'inkstitchCommit': 'd59c9ab1e390285a6c67822436ffd9ba9843d8b4',
               'networkx': nx.__version__, 'cases': results}, stream, indent=2)
    stream.write('\n')
print(json.dumps(results, indent=2))
