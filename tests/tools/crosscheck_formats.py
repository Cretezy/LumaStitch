#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Check DST / JEF / EXP / VP3 files written by LumaStitch with pyembroidery
(MIT, Copyright (c) 2018 Tatarize).

    FORMATS_CROSSCHECK_DIR=/tmp/fmt-xcheck npx vitest run --project unit tests/integration/formats.crosscheck
    python tests/tools/crosscheck_formats.py /tmp/fmt-xcheck

1. Reads every file in summary.json with pyembroidery and compares the stitch count, colour
   changes + stops, colour blocks and the extents of the stitches with what our encoder wrote.
   VP3 stores block start positions relative to a truncated design centre, so its extents
   may be off by one unit (0.1 mm).
2. Writes every pattern in cases.json with pyembroidery (same settings as the golden files)
   and compares the bytes with our `<id>.compat.<ext>` files.

Exits non-zero on any mismatch.
"""

import io
import json
import os
import sys

import pyembroidery
from pyembroidery import COLOR_CHANGE, STITCH, STOP

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from make_goldens import build_pattern  # noqa: E402

READERS = {"dst": pyembroidery.read_dst, "jef": pyembroidery.read_jef, "exp": pyembroidery.read_exp, "vp3": pyembroidery.read_vp3}


def stitch_bounds(p):
    xs = [s[0] for s in p.stitches if s[2] & 0xFF == STITCH]
    ys = [s[1] for s in p.stitches if s[2] & 0xFF == STITCH]
    if not xs:
        return [None] * 4
    return [min(xs), min(ys), max(xs), max(ys)]


def check_reads(d, summary):
    bad = 0
    for e in summary["files"]:
        fmt = e["format"]
        p = READERS[fmt](os.path.join(d, e["file"]))
        stitches = p.count_stitch_commands(STITCH)
        changes = p.count_stitch_commands(COLOR_CHANGE) + p.count_stitch_commands(STOP)
        threads = len([t for t in p.threadlist if t is not None])
        b = stitch_bounds(p)
        tol = 1 if fmt == "vp3" else 0
        problems = []
        if stitches != e["stitches"]:
            problems.append("stitches %d != %d" % (stitches, e["stitches"]))
        if stitches != e["planStitches"]:
            problems.append("stitches %d != plan %d" % (stitches, e["planStitches"]))
        if changes != e["changes"] and fmt != "vp3":
            problems.append("changes %d != %d" % (changes, e["changes"]))
        if fmt == "vp3" and (threads != e["colorBlocks"] or changes != e["colorBlocks"] - 1):
            problems.append("blocks %d/%d != %d" % (threads, changes + 1, e["colorBlocks"]))
        if fmt == "jef" and threads + p.count_stitch_commands(STOP) != e["colorBlocks"]:
            problems.append("jef colours %d + stops != %d" % (threads, e["colorBlocks"]))
        if any(abs(a - b_) > tol for a, b_ in zip(b, e["stitchBounds"])):
            problems.append("bounds %s != %s" % (b, e["stitchBounds"]))
        bad += bool(problems)
        print(
            "%s read %-24s stitches=%5d changes=%3d colours=%3d bounds=%s %s"
            % ("BAD" if problems else "OK ", e["file"], stitches, changes, threads, b, "; ".join(problems))
        )
    return bad


def check_bytes(d, summary):
    bad = 0
    with open(os.path.join(d, "cases.json")) as fp:
        cases = json.load(fp)
    for case in cases:
        if case.get("segmentThreads") is None:
            case.pop("segmentThreads", None)
        for fmt in ("dst", "jef", "exp", "vp3"):
            buf = io.BytesIO()
            pattern = build_pattern(case)
            if fmt == "dst":
                pyembroidery.write_dst(pattern, buf)
            elif fmt == "jef":
                pyembroidery.write_jef(pattern, buf, {"date": summary["jefDate"]})
            elif fmt == "exp":
                pyembroidery.write_exp(pattern, buf)
            else:
                pattern.interpolate_stop_as_duplicate_color()
                pyembroidery.write_vp3(pattern, buf)
            theirs = buf.getvalue()
            name = "%s.compat.%s" % (case["id"], fmt)
            with open(os.path.join(d, name), "rb") as fp:
                ours = fp.read()
            if ours == theirs:
                print("OK  bytes %-24s %6d bytes identical" % (name, len(ours)))
            else:
                bad += 1
                i = next((k for k in range(min(len(ours), len(theirs))) if ours[k] != theirs[k]), min(len(ours), len(theirs)))
                print("BAD bytes %-24s first difference at %d (len %d vs %d)" % (name, i, len(ours), len(theirs)))
    return bad


def main(argv):
    if len(argv) != 2:
        print(__doc__)
        return 2
    d = argv[1]
    with open(os.path.join(d, "summary.json")) as fp:
        summary = json.load(fp)
    bad = check_reads(d, summary) + check_bytes(d, summary)
    print("FAILED: %d" % bad if bad else "all OK")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
