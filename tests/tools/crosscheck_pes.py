#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Read PES files written by LumaStitch with pyembroidery (MIT, Copyright (c) 2018 Tatarize)
and compare against what our own reader saw.

    PES_CROSSCHECK_DIR=/tmp/pes-xcheck npx vitest run --project unit src/io/pes/pes.crosscheck
    python tests/tools/crosscheck_pes.py /tmp/pes-xcheck

Compares, per file: stitch count, colour (thread) count, colour changes, stops,
bounds, and the full command list. Exits non-zero on any mismatch.
"""

import json
import os
import sys

import pyembroidery
from pyembroidery import COLOR_CHANGE, END, JUMP, STITCH, STOP, TRIM

# Our MC numbering equals pyembroidery's EmbConstant values.
assert (STITCH, JUMP, TRIM, STOP, END, COLOR_CHANGE) == (0, 1, 2, 3, 4, 5)


def main(argv):
    if len(argv) != 2:
        print(__doc__)
        return 2
    d = argv[1]
    with open(os.path.join(d, "summary.json")) as fp:
        summary = json.load(fp)
    failures = 0
    for entry in summary:
        p = pyembroidery.read_pes(os.path.join(d, entry["file"]))
        b = p.bounds()
        got = {
            "stitchCount": p.count_stitch_commands(STITCH),
            "commandCount": len(p.stitches),
            "colorCount": len(p.threadlist),
            "colorChangeCount": p.count_stitch_commands(COLOR_CHANGE),
            "stopCount": p.count_stitch_commands(STOP),
            "bounds": [b[0], b[1], b[2], b[3]],
            "commands": [[s[2] & 0xFF, s[0], s[1]] for s in p.stitches],
            "colors": ["#%06x" % (t.color & 0xFFFFFF) for t in p.threadlist],
            "label": p.get_metadata("Name"),
        }
        bad = [k for k in got if got[k] != entry[k]]
        status = "OK " if not bad else "BAD"
        print(
            "%s %-26s stitches=%5d colours=%2d cc=%2d stops=%2d bounds=%s"
            % (status, entry["file"], got["stitchCount"], got["colorCount"], got["colorChangeCount"], got["stopCount"], got["bounds"])
        )
        for k in bad:
            failures += 1
            a, e = got[k], entry[k]
            if isinstance(a, list) and isinstance(e, list) and len(a) > 8:
                i = next((i for i, (x, y) in enumerate(zip(a, e)) if x != y), min(len(a), len(e)))
                print("    %s differs at %d: pyembroidery %r vs ours %r" % (k, i, a[i : i + 3], e[i : i + 3]))
            else:
                print("    %s: pyembroidery %r vs ours %r" % (k, a, e))
    # Byte-for-byte: our writer in pyembroidery-compatible mode (hoop 1, red-mean colours)
    # vs pyembroidery's writer on the same input.
    cases_path = os.path.join(d, "cases.json")
    if os.path.exists(cases_path):
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        import io

        from make_goldens import build_pattern

        with open(cases_path) as fp:
            cases = json.load(fp)
        for case in cases:
            for version in (1, 6):
                buf = io.BytesIO()
                pyembroidery.write_pes(build_pattern(case), buf, {"version": version})
                theirs = buf.getvalue()
                with open(os.path.join(d, "%s.compat.v%d.pes" % (case["id"], version)), "rb") as fp:
                    ours = fp.read()
                same = ours == theirs
                if not same:
                    failures += 1
                    i = next((i for i, (x, y) in enumerate(zip(ours, theirs)) if x != y), min(len(ours), len(theirs)))
                    print("BAD bytes %s v%d: first difference at %d (len %d vs %d)" % (case["id"], version, i, len(ours), len(theirs)))
                else:
                    print("OK  bytes %s v%d (%d bytes identical)" % (case["id"], version, len(ours)))
    print("%d files, %d mismatches" % (len(summary), failures))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
