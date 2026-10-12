# Unicode bidirectional implementation

Source: `bidi-js` npm **1.1.0**, https://github.com/lojjic/bidi-js, Copyright 2021 Jason Johnston, MIT (full text: LICENSE.txt).

LumaStitch changes:

- Public text algorithms convert input to Unicode scalars with `Array.from`; returned indices count scalars, not UTF-16 code units. Single-character property lookups already accept full scalars.
- Reordering trailing whitespace indexes the local line slice relative to `lineStart`.
- Generated property tables use Unicode **17.0.0**, including reserved RTL ranges and canonical bracket equivalents. See UNICODE-LICENSE.txt and `scripts/generate-lettering-unicode.py`.
- `index.d.ts` describes the subset of the API used by LumaStitch.

`node tests/tools/check_bidi.mjs /path/to/ucd` runs the complete official BidiCharacterTest.txt and BidiTest.txt. Unicode 17 validation covers 91,707 character cases and 770,241 class/direction cases. The app itemizes and shapes each newline-delimited paragraph separately; mirroring is performed by HarfBuzz when shaping RTL runs.

Upstream formatting is retained so functional patches remain easy to audit.
