#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Generate PES golden files with pyembroidery (MIT, Copyright (c) 2018 Tatarize).

Run manually with a Python that has pyembroidery installed:

    python tests/tools/make_goldens.py

Writes tests/fixtures/pes/<id>.v1.pes, <id>.v6.pes and goldens.json (the input
patterns: mm coordinates, command names, threads, label). The TypeScript golden test
(src/io/pes/pes.golden.test.ts) rebuilds each pattern as a StitchPlan, writes it with
our writer and compares bytes.

Coordinates are given in mm with one decimal and converted to 0.1 mm units with
round-half-up, matching `Math.round(mm * 10)` in the app (pyembroidery's own `round()`
is half-to-even, so we hand it integers).
"""

import json
import math
import os
import re
import sys

import pyembroidery
from pyembroidery import COLOR_CHANGE, END, JUMP, STITCH, STOP, TRIM, EmbPattern, EmbThread

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, "..", "fixtures", "pes"))

CMD = {
    "STITCH": STITCH,
    "JUMP": JUMP,
    "TRIM": TRIM,
    "COLOR_CHANGE": COLOR_CHANGE,
    "STOP": STOP,
    "END": END,
}


def units(mm):
    return int(math.floor(mm * 10 + 0.5))


def run(points, step=None):
    return [["STITCH", round(x, 1), round(y, 1)] for x, y in points]


def square(cx, cy, side, step):
    """Closed square running stitch, `step` mm apart, starting at the top-left corner."""
    h = side / 2.0
    corners = [(cx - h, cy - h), (cx + h, cy - h), (cx + h, cy + h), (cx - h, cy + h), (cx - h, cy - h)]
    pts = [corners[0]]
    for (x0, y0), (x1, y1) in zip(corners, corners[1:]):
        n = int(round(max(abs(x1 - x0), abs(y1 - y0)) / step))
        for i in range(1, n + 1):
            pts.append((x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n))
    return run(pts)


def zigzag(x0, y0, width, height, spacing):
    pts = []
    y = y0
    left = True
    while y <= y0 + height + 1e-9:
        pts.append((x0 if left else x0 + width, y))
        left = not left
        y += spacing
    return run(pts)


def cases():
    out = []

    out.append(
        {
            "id": "square_run",
            "name": "Square",
            "threads": [{"color": "#e3242b", "name": "Red", "code": "1902", "chart": "isacord-polyester"}],
            "commands": square(0.0, 0.0, 20.0, 2.0) + [["END"]],
        }
    )

    c = []
    c.append(["JUMP", -30.0, -20.0])
    c += zigzag(-30.0, -20.0, 8.0, 12.0, 0.6)  # 8 mm satin-like stitches (long form)
    c.append(["TRIM"])
    c.append(["JUMP", -10.0, -20.0])
    c += run([(-10.0, -20.0), (-8.0, -19.0), (-6.0, -18.0), (-4.0, -17.0)])
    c.append(["JUMP", 0.0, -10.0])  # untrimmed jump within the colour
    c += run([(1.5, -8.5), (3.0, -7.0), (4.5, -5.5)])  # first stitch moves on both axes: (0,0) quirk
    c.append(["TRIM"])
    c.append(["COLOR_CHANGE"])
    c.append(["JUMP", 10.0, 0.0])
    c += square(15.0, 5.0, 10.0, 2.5)
    c.append(["TRIM"])
    c.append(["JUMP", 25.0, 15.0])
    c.append(["COLOR_CHANGE"])  # colour change while jumping: (0,0) stitch quirk
    c += run([(25.0, 15.0), (27.0, 15.0), (29.0, 16.0), (31.0, 18.0), (33.0, 21.0)])
    c.append(["TRIM"])
    c.append(["END"])
    out.append(
        {
            "id": "three_colors",
            "name": "Tricolor",
            "threads": [
                {"color": "#0a55a3", "name": "Blue", "code": "3810", "chart": "isacord-polyester"},
                {"color": "#ffd911", "name": "Harvest Gold", "code": "0600", "chart": "isacord-polyester"},
                {"color": "#2f7e20", "name": "Moss Green", "code": "5833", "chart": "isacord-polyester"},
            ],
            "commands": c,
        }
    )

    c = []
    c += square(-5.0, 0.0, 8.0, 2.0)
    c.append(["TRIM"])
    c.append(["STOP"])
    c.append(["JUMP", 5.0, 0.0])
    c += square(5.0, 0.0, 6.0, 2.0)
    c.append(["TRIM"])
    c.append(["COLOR_CHANGE"])
    c += run([(0.0, 8.0), (2.0, 8.0), (4.0, 8.0)])
    c.append(["STOP"])
    c += run([(4.0, 10.0), (2.0, 10.0), (0.0, 10.0)])
    c.append(["END"])
    out.append(
        {
            "id": "stops",
            "name": "Stops",
            "threads": [
                {"color": "#000000", "name": "Black", "code": "0020", "chart": "isacord-polyester"},
                {"color": "#f0f0f0", "name": "White", "code": "0015", "chart": "isacord-polyester"},
            ],
            # thread index per colour segment (segments split at COLOR_CHANGE and STOP)
            "segmentThreads": [0, 0, 1, 1],
            "commands": c,
        }
    )

    c = []
    c += run([(-150.0, -10.0), (-148.0, -10.0), (-146.0, -9.0)])
    c.append(["TRIM"])
    c.append(["JUMP", 150.1, -9.0])  # 296.1 mm jump → split into 2 jumps (fractional .5 units)
    c += run([(150.1, -9.0), (150.1, 4.0), (137.0, 4.0)])  # 13 mm stitches (long form, > 12.7 mm)
    c.append(["JUMP", 80.0, 30.0])  # untrimmed 60+ mm jump
    c += run([(78.0, 31.0), (76.0, 33.0)])
    c += run([(-160.0, 33.0)])  # 236 mm stitch → needle-jump split
    c += run([(-161.0, 34.0)])
    c.append(["END"])
    out.append(
        {
            "id": "long_jump",
            "name": "LongJumpDesign",
            "threads": [{"color": "#ed171f", "name": "Red", "code": "5", "chart": "brother-embroidery"}],
            "commands": c,
        }
    )

    c = []
    c += square(-40.0, -30.0, 12.0, 3.0)
    c.append(["TRIM"])
    c.append(["COLOR_CHANGE"])
    c.append(["JUMP", -55.0, -45.0])
    c += zigzag(-55.0, -45.0, 5.0, 6.0, 0.8)
    c.append(["END"])
    out.append(
        {
            "id": "negative",
            "name": "Neg",
            "threads": [
                {"color": "#913697", "name": "Magenta"},
                {"color": "#fe9e32", "name": "Tangerine", "code": "52"},
            ],
            "commands": c,
        }
    )

    c = run([(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0), (0.0, 0.0), (0.5, 0.5)]) + [["END"]]
    out.append(
        {
            "id": "tiny",
            "name": "T",
            "threads": [{"color": "#25a4bb", "name": "Sky"}],
            "commands": c,
        }
    )
    return out


def segment_threads(case):
    """Thread index per colour segment (split at COLOR_CHANGE and STOP)."""
    if "segmentThreads" in case:
        return case["segmentThreads"]
    seg = [0]
    for cmd in case["commands"]:
        if cmd[0] == "COLOR_CHANGE":
            seg.append(seg[-1] + 1)
        elif cmd[0] == "STOP":
            seg.append(seg[-1])
    return seg


def build_pattern(case):
    pattern = EmbPattern()
    pattern.metadata("name", case["name"])
    segs = segment_threads(case)
    # pyembroidery threadlist: one per COLOR_CHANGE segment (STOP duplicates are added by the writer).
    thread_ids = [segs[0]]
    seg = 0
    for cmd in case["commands"]:
        if cmd[0] in ("COLOR_CHANGE", "STOP"):
            seg += 1
            if cmd[0] == "COLOR_CHANGE":
                thread_ids.append(segs[seg])
            else:
                assert segs[seg] == segs[seg - 1], "STOP must keep the thread"
    for ti in thread_ids:
        t = case["threads"][ti]
        th = EmbThread()
        th.set(t["color"])
        th.description = t.get("name")
        th.catalog_number = t.get("code")
        th.brand = t.get("chart")
        th.chart = t.get("chart")
        pattern.add_thread(th)

    px, py = 0, 0
    for cmd in case["commands"]:
        name = cmd[0]
        if name in ("STITCH", "JUMP"):
            px, py = units(cmd[1]), units(cmd[2])
        pattern.add_stitch_absolute(CMD[name], px, py)
    return pattern


def main():
    os.makedirs(OUT, exist_ok=True)
    manifest = []
    for case in cases():
        files = {}
        for version in (1, 6):
            fname = "%s.v%d.pes" % (case["id"], version)
            pattern = build_pattern(case)
            pyembroidery.write_pes(pattern, os.path.join(OUT, fname), {"version": version})
            files["v%d" % version] = fname
        entry = dict(case)
        entry["segmentThreads"] = segment_threads(case)
        entry["files"] = files
        # What pyembroidery reads back, for the reader tests.
        read = pyembroidery.read_pes(os.path.join(OUT, files["v1"]))
        entry["pyembroideryRead"] = summarize(read)
        manifest.append(entry)
        print("wrote", files["v1"], files["v6"])
    text = json.dumps(
        {
            "generator": "tests/tools/make_goldens.py",
            "pyembroidery": pyembroidery_version(),
            "cases": manifest,
        },
        indent=1,
    )
    # Keep innermost scalar lists (commands, bounds) on one line.
    text = re.sub(r"\[\s*([^\[\]{}]*?)\s*\]", lambda m: "[" + re.sub(r"\s*\n\s*", " ", m.group(1)) + "]", text)
    with open(os.path.join(OUT, "goldens.json"), "w") as fp:
        fp.write(text + "\n")


NAMES = {STITCH: "STITCH", JUMP: "JUMP", TRIM: "TRIM", COLOR_CHANGE: "COLOR_CHANGE", STOP: "STOP", END: "END"}


def summarize(pattern):
    b = pattern.bounds()
    return {
        "commands": [[NAMES.get(s[2] & 0xFF, str(s[2])), int(s[0]), int(s[1])] for s in pattern.stitches],
        "threads": ["#%06x" % (t.color & 0xFFFFFF) for t in pattern.threadlist],
        "bounds": [b[0], b[1], b[2], b[3]],
        "label": pattern.get_metadata("Name"),
    }


def pyembroidery_version():
    try:
        from importlib.metadata import version

        return version("pyembroidery")
    except Exception:  # pragma: no cover
        return None


if __name__ == "__main__":
    sys.exit(main())
