// SPDX-License-Identifier: GPL-3.0-or-later
/** Unicode scalar itemization; HarfBuzz receives original logical text and UTF-16 offsets. */
import data from './unicode17.json';
import { getEmbeddingLevels, getReorderedIndices } from './vendor/bidi/index.js';
type Range<T> = [number, number, T];
const scripts = data.scripts as Range<string>[],
  extensions = data.extensions as Range<string[]>[];
function lookup<T>(ranges: Range<T>[], cp: number): T | undefined {
  let lo = 0,
    hi = ranges.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (ranges[mid][1] < cp) lo = mid + 1;
    else hi = mid;
  }
  return lo < ranges.length && ranges[lo][0] <= cp ? ranges[lo][2] : undefined;
}
export interface TextRun {
  start: number;
  end: number;
  script: string;
  direction: 'ltr' | 'rtl';
  level: number;
}
export function textRuns(text: string, direction: 'auto' | 'ltr' | 'rtl'): TextRun[] {
  let offset = 0;
  const chars = Array.from(text, (ch) => {
    const start = offset;
    offset += ch.length;
    const cp = ch.codePointAt(0)!,
      script = lookup(scripts, cp) ?? 'Zzzz';
    return {
      start,
      end: offset,
      script,
      candidates: lookup(extensions, cp) ?? (['Zyyy', 'Zinh'].includes(script) ? [] : [script]),
    };
  });
  if (!chars.length) return [];
  // Common/inherited characters stay with surrounding script runs. Script_Extensions
  // supplies the compatible set for shared marks and digits, preserving joining clusters.
  let first = 0,
    allowed: string[] = [];
  const finish = (end: number) => {
    const script = allowed[0] ?? 'Zyyy';
    for (let i = first; i < end; i++) chars[i].script = script;
    first = end;
  };
  for (let i = 0; i < chars.length; i++) {
    const candidates = chars[i].candidates;
    if (!candidates.length) continue;
    if (!allowed.length) {
      allowed = candidates;
      continue;
    }
    const common = allowed.filter((s) => candidates.includes(s));
    if (common.length) allowed = common;
    else {
      finish(i);
      allowed = candidates;
    }
  }
  finish(chars.length);
  const embedding = getEmbeddingLevels(text, direction),
    order = getReorderedIndices(text, embedding),
    rank = new Uint32Array(chars.length);
  order.forEach((logical, visual) => {
    rank[logical] = visual;
  });
  const runs: (TextRun & { visual: number })[] = [];
  for (let i = 0; i < chars.length; i++) {
    const char = chars[i],
      level = embedding.levels[i],
      last = runs.at(-1);
    if (last && last.script === char.script && last.level === level) {
      last.end = char.end;
      last.visual = Math.min(last.visual, rank[i]);
    } else
      runs.push({
        start: char.start,
        end: char.end,
        script: char.script,
        level,
        direction: level % 2 ? 'rtl' : 'ltr',
        visual: rank[i],
      });
  }
  return runs
    .sort((a, b) => a.visual - b.visual)
    .map(({ start, end, script, direction, level }) => ({ start, end, script, direction, level }));
}
