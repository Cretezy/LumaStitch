#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Generate DST / JEF / EXP / VP3 golden files with pyembroidery (MIT, Copyright (c) 2018 Tatarize).

Run manually with a Python that has pyembroidery installed:

    python tests/tools/make_goldens_formats.py

Writes tests/fixtures/formats/<id>.{dst,jef,exp,vp3} (plus a few variants) and goldens.json
with the input patterns. The patterns are the PES golden patterns from make_goldens.py plus
some format-specific ones. src/io/formats/formats.golden.test.ts rebuilds each pattern as a
StitchPlan, writes it with our writers and compares bytes.

Settings that differ from a plain `pyembroidery.write_*` call:
- JEF: the header timestamp is fixed with the `date` setting (JEF_DATE).
- VP3: LumaStitch writes stops as colour changes to the same thread by default, so the main
  .vp3 golden is written after `pattern.interpolate_stop_as_duplicate_color()`. The
  `<id>.ignore-stops.vp3` variant is pyembroidery's default behaviour (stops dropped).
"""

import json
import os
import re
import sys

import pyembroidery

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from make_goldens import build_pattern, cases as pes_cases, pyembroidery_version, run, segment_threads, square, zigzag  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, "..", "fixtures", "formats"))
JEF_DATE = "20261010123456"


def extra_cases():
    out = []

    # 120 × 150 mm: JEF 140 × 200 hoop; DST splits of a 25.3 mm jump and a 30 mm stitch.
    c = []
    c += square(0.0, 0.0, 120.0, 4.0)
    c.append(["TRIM"])
    c.append(["JUMP", -30.0, 50.0])
    c += zigzag(-30.0, 50.0, 6.0, 5.0, 0.5)
    c.append(["JUMP", -10.0, 45.3])  # untrimmed jump, 25 mm diagonal-ish
    c += run([(-10.0, 45.3), (20.0, 45.3), (20.1, 40.0)])  # 30 mm stitch → needle jumps
    c.append(["TRIM"])
    c.append(["COLOR_CHANGE"])
    c.append(["JUMP", 10.0, -70.0])
    c += run([(10.0, -70.0), (12.5, -72.0), (15.0, -74.9), (5.0, -74.9)])
    c.append(["END"])
    out.append(
        {
            "id": "medium",
            "name": "Medium Design",
            "threads": [
                {"color": "#1a842d", "name": "Bright Green", "code": "206", "chart": "janome"},
                {"color": "#ffcb00", "name": "Sunflower", "code": "239"},
            ],
            "commands": c,
        }
    )

    # Two different threads that land on the same JEF colour, repeated stops (JEF toggle),
    # a colour change straight after a trimmed jump, trims shorter than a DST jump.
    c = []
    c += run([(0.0, 0.0), (3.0, 0.0), (6.0, 0.0), (9.0, 1.0)])
    c.append(["TRIM"])
    c.append(["COLOR_CHANGE"])
    c += run([(9.0, 5.0), (6.0, 5.0), (3.0, 5.0)])  # first stitch after a change, 4 mm away: no jump in DST
    c.append(["TRIM"])
    c.append(["STOP"])
    c += run([(3.0, 8.0), (6.0, 8.0)])
    c.append(["STOP"])
    c += run([(6.0, 11.0), (9.0, 11.0)])
    c.append(["STOP"])
    c += run([(9.0, 14.0), (12.0, 14.0)])
    c.append(["TRIM"])
    c.append(["COLOR_CHANGE"])
    c.append(["JUMP", -20.0, -20.0])
    c += run([(-20.0, -20.0), (-18.0, -20.0), (-18.0, -18.0)])
    c.append(["END"])
    out.append(
        {
            "id": "pigeonhole",
            "name": "Pigeon",
            "threads": [
                {"color": "#fe0000", "name": "Red", "code": "1902"},
                {"color": "#ff0101", "name": "Scarlet", "code": "1903"},
                {"color": "#0b2f84", "name": "Blue", "code": "207"},
            ],
            "segmentThreads": [0, 1, 1, 1, 1, 2],
            "commands": c,
        }
    )
    return out


def write_all(case):
    files = {}

    def path(name):
        return os.path.join(OUT, name)

    files["dst"] = case["id"] + ".dst"
    pyembroidery.write_dst(build_pattern(case), path(files["dst"]))

    files["jef"] = case["id"] + ".jef"
    pyembroidery.write_jef(build_pattern(case), path(files["jef"]), {"date": JEF_DATE})

    files["exp"] = case["id"] + ".exp"
    pyembroidery.write_exp(build_pattern(case), path(files["exp"]))

    files["vp3"] = case["id"] + ".vp3"
    p = build_pattern(case)
    p.interpolate_stop_as_duplicate_color()
    pyembroidery.write_vp3(p, path(files["vp3"]))

    has_stops = any(cmd[0] == "STOP" for cmd in case["commands"])
    if has_stops:
        files["vp3IgnoreStops"] = case["id"] + ".ignore-stops.vp3"
        pyembroidery.write_vp3(build_pattern(case), path(files["vp3IgnoreStops"]))
    if case["id"] in ("three_colors", "pigeonhole"):
        files["jefTrims"] = case["id"] + ".trims.jef"
        pyembroidery.write_jef(build_pattern(case), path(files["jefTrims"]), {"date": JEF_DATE, "trims": True})
    return files


def main():
    os.makedirs(OUT, exist_ok=True)
    manifest = []
    for case in pes_cases() + extra_cases():
        entry = dict(case)
        entry["segmentThreads"] = segment_threads(case)
        entry["files"] = write_all(case)
        manifest.append(entry)
        print("wrote", ", ".join(entry["files"].values()))
    text = json.dumps(
        {
            "generator": "tests/tools/make_goldens_formats.py",
            "pyembroidery": pyembroidery_version(),
            "jefDate": JEF_DATE,
            "cases": manifest,
        },
        indent=1,
    )
    # Keep innermost scalar lists (commands) on one line.
    text = re.sub(r"\[\s*([^\[\]{}]*?)\s*\]", lambda m: "[" + re.sub(r"\s*\n\s*", " ", m.group(1)) + "]", text)
    with open(os.path.join(OUT, "goldens.json"), "w") as fp:
        fp.write(text + "\n")


if __name__ == "__main__":
    sys.exit(main())
