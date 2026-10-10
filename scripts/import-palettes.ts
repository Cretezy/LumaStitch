// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Convert Ink/Stitch GIMP palette files (`palettes/*.gpl`, GPL-3.0) into the
 * JSON thread charts used by `src/threads/charts.ts`.
 *
 * Usage:
 *   node scripts/import-palettes.ts <dir-with-gpl-files> [--out src/threads/charts] [--commit <sha>]
 *
 * Node ≥ 23.6 strips TypeScript types natively (older: add --experimental-strip-types).
 * If `--commit` is omitted, the commit is read with `git rev-parse HEAD` in the
 * palette directory (works when it is inside an Ink/Stitch clone).
 *
 * Output:
 *   <out>/<id>.json   { id, name, brand, threads: [{ code, name, color: '#rrggbb' }] }
 *   <out>/manifest.ts generated chart index (id, name, brand, count) + source commit
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

interface ChartThread {
  code: string;
  name: string;
  color: string;
}
interface ThreadChart {
  id: string;
  name: string;
  brand: string;
  threads: ChartThread[];
}

/** Palettes that are not embroidery threads (paint standards). */
const EXCLUDE = new Set(['ral']);

/** Brands whose name is not simply the first word of the palette name. */
const BRAND_OVERRIDES: [prefix: string, brand: string][] = [
  ['King Star', 'King Star'],
  ['Poly X40', 'Poly X40'],
  ['Viking', 'Husqvarna Viking'],
  ['Gutermann', 'Gütermann'],
];

const LAB_FIELD = /^-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?$/;

export function slugify(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function brandOf(name: string): string {
  for (const [prefix, brand] of BRAND_OVERRIDES) if (name.startsWith(prefix)) return brand;
  return name.split(/[\s/]+/)[0];
}

function hex2(n: number): string {
  return Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
}

/**
 * Split the text after the RGB triple into name and code. The code is the last
 * whitespace-separated token (codes never contain spaces; names may), as in
 * Ink/Stitch's own palette reader. A trailing "L,a,b" measurement column, used
 * by a few palettes, is dropped.
 */
function splitNameCode(rest: string): { name: string; code: string } | null {
  const tokens = rest.trim().split(/\s+/).filter(Boolean);
  if (tokens.length > 1 && LAB_FIELD.test(tokens[tokens.length - 1])) tokens.pop();
  if (tokens.length === 0) return null;
  // A lone token is treated as the name.
  let code = tokens.length > 1 ? tokens.pop()! : '';
  if (/^n\/?a$/i.test(code)) code = '';
  return { name: tokens.join(' '), code };
}

export function parseGpl(
  text: string,
  fallbackName: string,
): { name: string; threads: ChartThread[]; warnings: string[] } {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  let name = fallbackName;
  const threads: ChartThread[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  for (const [i, raw] of lines.entries()) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) continue;
    if (i === 0 && line.startsWith('GIMP Palette')) continue;
    const nm = /^Name:\s*(.*)$/.exec(line);
    if (nm) {
      name = nm[1].replace(/^Ink\/Stitch:\s*/, '').trim();
      continue;
    }
    if (/^Columns:/.test(line) || line.trimStart().startsWith('#')) continue;
    const m = /^\s*(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})(?:\s+(.*))?$/.exec(line);
    if (!m) {
      warnings.push(`line ${i + 1}: unparsed: ${JSON.stringify(line)}`);
      continue;
    }
    const color = `#${hex2(+m[1])}${hex2(+m[2])}${hex2(+m[3])}`;
    const nc = splitNameCode(m[4] ?? '') ?? { name: '', code: '' };
    const key = `${nc.code}\u0000${nc.name}\u0000${color}`;
    if (seen.has(key)) {
      warnings.push(`line ${i + 1}: duplicate entry ${nc.code} ${nc.name}`);
      continue;
    }
    seen.add(key);
    threads.push({ code: nc.code, name: nc.name || nc.code || color, color });
  }
  name = name
    .replace(/\s*\/\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return { name, threads, warnings };
}

/** Single-quoted TS string literal. */
function q(s: string): string {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function titleFromFile(file: string): string {
  return basename(file, '.gpl').replace(/^InkStitch\s+/, '');
}

function detectCommit(dir: string): string {
  try {
    return execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function main(argv: string[]): void {
  const args = [...argv];
  let out = 'src/threads/charts';
  let commit: string | undefined;
  const positional: string[] = [];
  while (args.length) {
    const a = args.shift()!;
    if (a === '--out') out = args.shift()!;
    else if (a === '--commit') commit = args.shift()!;
    else positional.push(a);
  }
  if (positional.length !== 1) {
    console.error('usage: node scripts/import-palettes.ts <dir-with-gpl-files> [--out dir] [--commit sha]');
    process.exit(2);
  }
  const dir = resolve(positional[0]);
  commit ??= detectCommit(dir);
  const outDir = resolve(out);
  mkdirSync(outDir, { recursive: true });
  // Clear previously generated charts so removed palettes don't linger.
  for (const f of readdirSync(outDir)) if (f.endsWith('.json')) rmSync(join(outDir, f));

  const files = readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.gpl'))
    .sort((a, b) => a.localeCompare(b, 'en'));
  const charts: (ThreadChart & { file: string })[] = [];
  const ids = new Set<string>();
  let bytes = 0;
  for (const file of files) {
    const parsed = parseGpl(readFileSync(join(dir, file), 'utf8'), titleFromFile(file));
    const title = titleFromFile(file);
    const id = slugify(title);
    if (EXCLUDE.has(id)) {
      console.log(`skip  ${file} (excluded)`);
      continue;
    }
    if (ids.has(id)) throw new Error(`duplicate chart id ${id} (${file})`);
    if (parsed.threads.length === 0) {
      console.warn(`skip  ${file} (no colours)`);
      continue;
    }
    ids.add(id);
    for (const w of parsed.warnings) console.warn(`warn  ${file}: ${w}`);
    const chart: ThreadChart = {
      id,
      name: parsed.name || title,
      brand: brandOf(title),
      threads: parsed.threads,
    };
    const json =
      `{"id":${JSON.stringify(chart.id)},"name":${JSON.stringify(chart.name)},"brand":${JSON.stringify(chart.brand)},"threads":[\n` +
      chart.threads.map((t) => JSON.stringify(t)).join(',\n') +
      '\n]}\n';
    writeFileSync(join(outDir, `${id}.json`), json);
    bytes += Buffer.byteLength(json);
    charts.push({ ...chart, file });
    console.log(`wrote ${id}.json  ${chart.threads.length} threads  (${chart.brand} — ${chart.name})`);
  }
  charts.sort((a, b) => a.brand.localeCompare(b.brand, 'en') || a.name.localeCompare(b.name, 'en'));

  const manifest = `// SPDX-License-Identifier: GPL-3.0-or-later
// GENERATED by scripts/import-palettes.ts — do not edit by hand.
//
// Thread charts converted from the Ink/Stitch GIMP palettes (palettes/*.gpl),
// https://github.com/inkstitch/inkstitch/tree/${commit}/palettes
// Ink/Stitch commit: ${commit}
// Copyright (C) the Ink/Stitch authors. Licensed under GPL-3.0-or-later.

export const INKSTITCH_COMMIT = ${q(commit)};

export interface ChartManifestEntry {
  id: string;
  name: string;
  brand: string;
  count: number;
  /** Source palette file in Ink/Stitch. */
  source: string;
}

export const CHART_MANIFEST: readonly ChartManifestEntry[] = [
${charts
  .map(
    (c) =>
      `  { id: ${q(c.id)}, name: ${q(c.name)}, brand: ${q(c.brand)}, count: ${c.threads.length}, source: ${q(c.file)} },`,
  )
  .join('\n')}
];
`;
  const manifestPath = join(outDir, 'manifest.ts');
  writeFileSync(manifestPath, manifest);
  try {
    execFileSync('npx', ['--no-install', 'prettier', '--write', manifestPath], { stdio: 'ignore' });
  } catch {
    console.warn('prettier not available; manifest.ts left unformatted');
  }
  const total = charts.reduce((s, c) => s + c.threads.length, 0);
  console.log(
    `\n${charts.length} charts, ${total} threads, ${(bytes / 1024).toFixed(0)} KiB JSON, commit ${commit}`,
  );
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('import-palettes.ts')) {
  main(process.argv.slice(2));
}
