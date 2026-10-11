// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * buildPlan(design) → StitchPlan. The single source of stitches for preview, simulator, stats
 * and export. Pure and deterministic; runs in the engine worker and in Node tests.
 */
import { flattenGeom, flattenToPaths } from '@/geom/flatten';
import { closestBoundaryPoints } from '@/geom/closest';
import { makeValid, unionAll } from '@/geom/clipper';
import { bboxIntersects, createPointTester, emptyBBox, extendBBox } from '@/geom/polygon';
import type { BBox, PolyShape } from '@/geom/types';
import { hashKey, stableStringify } from '@/lib/hash';
import { buildElementIndex, getElement } from '@/model/factories';
import type { Design, Id, PathGeom, Shape, StitchElement, TieMode, Vec2 } from '@/model/types';
import { LRU } from './cache';
import type { EngineCtx, Hints } from './def';
import { num } from './params/types';
import { resolveParams } from './params/resolve';
import { postprocessRun } from './postprocess';
import { getStitchType } from './registry';
import {
  F,
  NO_ELEMENT,
  type ColorBlock,
  type Diagnostic,
  type ElementRange,
  type StitchPlan,
  type StitchRun,
} from './types';

export interface PlanCache {
  prepared: LRU<string, { prep: unknown; diags: Diagnostic[] }>;
  runs: LRU<string, StitchRun>;
  geomHash: WeakMap<PathGeom, string>;
  polys: LRU<string, { poly: PolyShape; bbox: BBox }>;
  /** Exit targets between pairs of shapes (see exitToward). */
  exits: LRU<string, Vec2>;
}

export function createPlanCache(): PlanCache {
  return {
    prepared: new LRU(2000),
    runs: new LRU(2000),
    geomHash: new WeakMap(),
    polys: new LRU(2000),
    exits: new LRU(2000),
  };
}

export interface BuildOptions {
  revision?: number;
  cache?: PlanCache;
}

const TOL = 0.05;
/** Internal jumps up to this length (mm) are sewn as one stitch instead of being trimmed. */
const SHORT_HOP = 1.0;

function geomKey(cache: PlanCache, g: PathGeom): string {
  let h = cache.geomHash.get(g);
  if (!h) {
    h = hashKey(stableStringify(g));
    cache.geomHash.set(g, h);
  }
  return h;
}

function shapePoly(cache: PlanCache, shape: Shape): { poly: PolyShape; bbox: BBox } {
  const key = geomKey(cache, shape.geom);
  let v = cache.polys.get(key);
  if (!v) {
    const poly = makeValid(flattenGeom(shape.geom, TOL).rings, shape.geom.fillRule);
    const bbox = emptyBBox();
    for (const p of poly) extendBBox(bbox, p.outer);
    v = { poly, bbox };
    cache.polys.set(key, v);
  }
  return v;
}

function geomCenter(cache: PlanCache, shape: Shape): Vec2 {
  const key = 'c' + geomKey(cache, shape.geom);
  let v = cache.polys.get(key);
  if (!v) {
    const b = emptyBBox();
    for (const sp of shape.geom.subpaths) for (const n of sp.nodes) extendBBox(b, n.p);
    v = { poly: [], bbox: b };
    cache.polys.set(key, v);
  }
  return [(v.bbox.minX + v.bbox.maxX) / 2, (v.bbox.minY + v.bbox.maxY) / 2];
}

/** Closest join between the flattened outlines, including segment interiors. */
function exitToward(cache: PlanCache, cur: Shape, next: Shape): Vec2 {
  const key = geomKey(cache, cur.geom) + '>' + geomKey(cache, next.geom);
  let v = cache.exits.get(key);
  if (!v) {
    v =
      closestBoundaryPoints(flattenToPaths(cur.geom, TOL), flattenToPaths(next.geom, TOL))?.b ??
      geomCenter(cache, next);
    cache.exits.set(key, v);
  }
  return v;
}

const q = (v: number) => Math.round(v * 2) / 2;

/** Builder for the command arrays. */
class Emitter {
  x: number[] = [];
  y: number[] = [];
  flags: number[] = [];
  owner: number[] = [];
  pos: Vec2 | null = null;
  push(x: number, y: number, f: number, owner: number) {
    this.x.push(x);
    this.y.push(y);
    this.flags.push(f);
    this.owner.push(owner);
    if (!(f & (F.TRIM | F.COLOR_CHANGE | F.STOP | F.END))) this.pos = [x, y];
  }
  get length() {
    return this.flags.length;
  }
}

/** Point at distance `d` along the run from index `from`, walking in direction `dir` (+1/−1), stopping at jumps. */
function alongRun(run: StitchRun, from: number, dir: 1 | -1, d: number): Vec2 | null {
  const n = run.flags.length;
  let acc = 0;
  let i = from;
  while (true) {
    const j = i + dir;
    if (j < 0 || j >= n) break;
    if (run.flags[dir > 0 ? j : i] & F.JUMP) break;
    const ax = run.xy[i * 2],
      ay = run.xy[i * 2 + 1],
      bx = run.xy[j * 2],
      by = run.xy[j * 2 + 1];
    const l = Math.hypot(bx - ax, by - ay);
    if (acc + l >= d && l > 0) {
      const t = (d - acc) / l;
      return [ax + (bx - ax) * t, ay + (by - ay) * t];
    }
    acc += l;
    i = j;
  }
  if (i === from || acc < 0.2) return null;
  return [run.xy[i * 2], run.xy[i * 2 + 1]];
}

export interface PlanStepResult {
  done: boolean;
}

/**
 * Generator form so the worker can yield between elements for cancellation.
 * Returns the finished plan as the generator's return value.
 */
export function* planGenerator(design: Design, opts: BuildOptions = {}): Generator<void, StitchPlan, void> {
  const cache = opts.cache ?? createPlanCache();
  const settings = design.settings;
  const index = buildElementIndex(design);
  const diagnostics: Diagnostic[] = [];
  const em = new Emitter();
  const elementIds: Id[] = [];
  const elementRanges: ElementRange[] = [];
  const blocks: ColorBlock[] = [];

  // Resolve the ordered list of sewable entries first (for next-element hints and cutout growth).
  type Item = { kind: 'el'; el: StitchElement; shape: Shape } | { kind: 'stop'; id: Id };
  const items: Item[] = [];
  for (const entry of design.sequence) {
    if (entry.kind === 'stop') {
      items.push({ kind: 'stop', id: entry.id });
      continue;
    }
    const ref = index.get(entry.elementId);
    const el = getElement(design, ref);
    if (!el || !ref) continue;
    const shape = design.shapes[ref.shapeId];
    if (!shape || shape.hidden) continue;
    if (!design.threads[el.threadId]) continue;
    items.push({ kind: 'el', el, shape });
  }

  const tieOn = (mode: TieMode, event: boolean) => {
    if (mode === 'on') return true;
    if (mode === 'off') return false;
    if (settings.defaultTie === 'always') return true;
    if (settings.defaultTie === 'never') return false;
    return event;
  };

  let thread: Id | null = null;
  let prevEl: StitchElement | null = null;
  let prevRun: StitchRun | null = null;
  let prevOwner = NO_ELEMENT;
  let pendingStop = false;
  let blockStart = 0;

  const closeBlock = (endExclusive: number) => {
    if (thread !== null) {
      const t = design.threads[thread];
      blocks.push({ threadId: thread, color: t?.color ?? '#000000', start: blockStart, end: endExclusive });
    }
    blockStart = endExclusive;
  };

  const emitTieOff = (run: StitchRun, owner: number) => {
    const n = run.flags.length;
    const e = em.pos;
    if (!e || n < 2) return;
    const b = alongRun(run, n - 1, -1, settings.tieLength);
    if (!b) return;
    em.push(b[0], b[1], F.TIE, owner);
    em.push(e[0], e[1], F.TIE, owner);
    em.push(b[0], b[1], F.TIE, owner);
  };
  const emitTieIn = (run: StitchRun, from: number, owner: number) => {
    const s = em.pos;
    if (!s) return;
    const a = alongRun(run, from, 1, settings.tieLength);
    if (!a) return;
    em.push(a[0], a[1], F.TIE, owner);
    em.push(s[0], s[1], F.TIE, owner);
    em.push(a[0], a[1], F.TIE, owner);
  };

  for (let ii = 0; ii < items.length; ii++) {
    const item = items[ii];
    if (item.kind === 'stop') {
      if (em.pos && prevEl && items.slice(ii + 1).some((it) => it.kind === 'el')) pendingStop = true;
      continue;
    }
    const { el, shape } = item;
    if (el.type === 'manual' && el.params.preserveCommands === true) {
      // Machine files are already digitized. Preserve their command stream, including duplicate
      // penetrations and short jumps; regeneration heuristics would silently alter the design.
      const owner = elementIds.length;
      elementIds.push(el.id);
      const start = em.length;
      if (em.pos && (pendingStop || (thread !== null && thread !== el.threadId))) {
        em.push(...em.pos, thread !== el.threadId ? F.COLOR_CHANGE : F.STOP, NO_ELEMENT);
        closeBlock(em.length);
      } else if (em.pos && prevEl?.params.preserveCommands !== true) {
        em.push(...em.pos, F.TRIM, NO_ELEMENT);
        const first = shape.geom.subpaths[0]?.nodes[0]?.p;
        if (first) em.push(...first, F.JUMP, owner);
      }
      thread = el.threadId;
      pendingStop = false;
      const xy: number[] = [],
        flags: number[] = [];
      for (const sp of shape.geom.subpaths)
        for (const node of sp.nodes) {
          const flag =
            node.command === 'jump'
              ? F.JUMP
              : node.command === 'trim'
                ? F.TRIM
                : node.command === 'stop'
                  ? F.STOP
                  : F.STITCH;
          em.push(...node.p, flag, owner);
          xy.push(...node.p);
          flags.push(flag);
          if (flag === F.STOP) closeBlock(em.length);
        }
      elementRanges.push({ elementId: el.id, start, end: em.length });
      prevEl = el;
      prevRun = { xy: Float64Array.from(xy), flags: Uint8Array.from(flags) };
      prevOwner = owner;
      yield;
      continue;
    }
    const def = getStitchType(el.type);
    const params = resolveParams(el, design.fabric, design.fabricProfile);
    const elDiags: Diagnostic[] = [];

    // Cutout growth clip: union of fills sewn later whose bboxes touch this one.
    let growClip: PolyShape | undefined;
    let growKey = '';
    if (el.role === 'fill' && num(params, 'cutoutGrowth', 0) > 0) {
      const mine = shapePoly(cache, shape);
      const later: PolyShape[] = [];
      const keys: string[] = [];
      for (let jj = ii + 1; jj < items.length; jj++) {
        const it = items[jj];
        if (it.kind !== 'el' || it.el.role !== 'fill' || it.shape.id === shape.id) continue;
        const other = shapePoly(cache, it.shape);
        if (!bboxIntersects(mine.bbox, other.bbox, num(params, 'cutoutGrowth', 0) + 0.01)) continue;
        later.push(other.poly);
        keys.push(geomKey(cache, it.shape.geom));
      }
      if (later.length) {
        growClip = unionAll(later);
        growKey = keys.sort().join(',');
      }
    }

    const ctx: EngineCtx = {
      settings,
      tolerance: TOL,
      art: shape.art,
      growClip,
      diag: (code, message, at, severity = 'warning') =>
        elDiags.push({ severity, code, message, elementId: el.id, at }),
    };
    const prepKey = hashKey(
      stableStringify({
        t: el.type,
        g: geomKey(cache, shape.geom),
        p: params,
        gu: el.guides ?? null,
        rs: el.railSplit ?? null,
        gc: growKey,
        sw: def.id === 'satin' ? (shape.art.strokeWidth ?? null) : null,
        ms: settings.minStitchLength,
      }),
    );
    let prepared = cache.prepared.get(prepKey);
    if (!prepared) {
      let prep: unknown;
      try {
        prep = def.prepare(shape.geom, params, el, ctx);
      } catch (err) {
        elDiags.push({
          severity: 'error',
          code: 'generator-failed',
          message: `Could not generate stitches: ${String(err)}`,
          elementId: el.id,
        });
        prep = null;
      }
      prepared = { prep, diags: elDiags.slice() };
      cache.prepared.set(prepKey, prepared);
    }
    for (const d of prepared.diags) diagnostics.push({ ...d, elementId: el.id });
    if (prepared.prep === null) continue;

    // Hints. Finish next to the following element when it continues in the same thread without a
    // stop; after a stop or colour change the thread is cut anyway, so the exit doesn't matter.
    const nextItem = items[ii + 1];
    const nextShape = nextItem?.kind === 'el' && nextItem.el.threadId === el.threadId ? nextItem.shape : null;
    const hints: Hints = {
      entry: el.entry ?? em.pos ?? undefined,
      exit: el.exit ?? (nextShape ? exitToward(cache, shape, nextShape) : undefined),
      userEntry: !!el.entry,
      userExit: !!el.exit,
    };
    // Auto hints are quantised to 0.5 mm so neighbours moving slightly reuse the cached run;
    // user-placed points are exact. Run post-processing depends on the stitch-length limits.
    const hk = (p: Vec2 | undefined, exact: boolean) =>
      !p ? '-' : exact ? `${p[0]},${p[1]}` : `${q(p[0])},${q(p[1])}`;
    const runKey = `${prepKey}|${hk(hints.entry, !!hints.userEntry)}|${hk(hints.exit, !!hints.userExit)}|${hints.userEntry ? 'E' : ''}${hints.userExit ? 'X' : ''}|${settings.minStitchLength}|${settings.maxStitchLength}`;
    let run = cache.runs.get(runKey);
    if (!run) {
      const qHints: Hints = {
        ...hints,
        entry: hints.entry ? [q(hints.entry[0]), q(hints.entry[1])] : undefined,
        exit: hints.exit && !hints.userExit ? [q(hints.exit[0]), q(hints.exit[1])] : hints.exit,
      };
      if (hints.userEntry) qHints.entry = hints.entry;
      try {
        run = postprocessRun(def.route(prepared.prep, qHints, ctx), settings);
      } catch (err) {
        diagnostics.push({
          severity: 'error',
          code: 'generator-failed',
          message: `Could not route stitches: ${String(err)}`,
          elementId: el.id,
        });
        run = { xy: new Float64Array(0), flags: new Uint8Array(0) };
      }
      cache.runs.set(runKey, run);
    }
    if (run.flags.length === 0) {
      diagnostics.push({
        severity: 'info',
        code: 'empty-element',
        message: 'Element produced no stitches.',
        elementId: el.id,
      });
      yield;
      continue;
    }

    const owner = elementIds.length;
    elementIds.push(el.id);
    const rangeStart = em.length;
    const S: Vec2 = [run.xy[0], run.xy[1]];
    const threadChange = thread !== null && thread !== el.threadId;
    const first = em.pos === null;
    let startsAfterCut = first;

    if (first) {
      thread = el.threadId;
    } else if (pendingStop) {
      if (prevEl && prevRun && tieOn(prevEl.tieOut, true)) emitTieOff(prevRun, prevOwner);
      // PES carries the trim on the following jump, so a reader sees STOP then TRIM.
      // A stop followed by a thread change is simply a colour change (the machine stops anyway).
      em.push(em.pos![0], em.pos![1], threadChange ? F.COLOR_CHANGE : F.STOP, NO_ELEMENT);
      closeBlock(em.length);
      em.push(em.pos![0], em.pos![1], F.TRIM, NO_ELEMENT);
      thread = el.threadId;
      startsAfterCut = true;
    } else if (threadChange) {
      if (prevEl && prevRun && tieOn(prevEl.tieOut, true)) emitTieOff(prevRun, prevOwner);
      em.push(em.pos![0], em.pos![1], F.COLOR_CHANGE, NO_ELEMENT);
      closeBlock(em.length);
      em.push(em.pos![0], em.pos![1], F.TRIM, NO_ELEMENT);
      thread = el.threadId;
      startsAfterCut = true;
    } else {
      const E = em.pos!;
      const d = Math.hypot(S[0] - E[0], S[1] - E[1]);
      const mode = prevEl?.trimAfter ?? 'auto';
      if (mode === 'never' || (mode === 'auto' && d <= settings.trimThreshold)) {
        if (mode === 'never' && d > 10)
          diagnostics.push({
            severity: 'warning',
            code: 'long-connector',
            message: `Stitched connector of ${d.toFixed(1)} mm (trim set to never).`,
            elementId: prevEl?.id,
            at: E,
          });
        if (
          prevEl &&
          prevRun &&
          (prevEl.tieOut === 'on' || (prevEl.tieOut === 'auto' && settings.defaultTie === 'always'))
        )
          emitTieOff(prevRun, prevOwner);
        const m = Math.max(1, Math.ceil(d / settings.maxStitchLength));
        for (let j = 1; j < m; j++)
          em.push(E[0] + ((S[0] - E[0]) * j) / m, E[1] + ((S[1] - E[1]) * j) / m, F.TRAVEL, owner);
      } else {
        if (prevEl && prevRun && tieOn(prevEl.tieOut, true)) emitTieOff(prevRun, prevOwner);
        em.push(em.pos![0], em.pos![1], F.TRIM, prevOwner);
        startsAfterCut = true;
      }
    }
    pendingStop = false;

    // Start of element.
    // Machine-command bits on a run's first point are meaningless here (the connector above decides).
    const f0 = run.flags[0] & ~(F.JUMP | F.TRIM | F.STOP);
    if (startsAfterCut) {
      em.push(S[0], S[1], F.JUMP, owner);
      em.push(S[0], S[1], f0, owner);
      if (tieOn(el.tieIn, true)) emitTieIn(run, 0, owner);
    } else {
      em.push(S[0], S[1], f0, owner);
      if (el.tieIn === 'on' || settings.defaultTie === 'always') emitTieIn(run, 0, owner);
    }
    // Body.
    for (let i = 1; i < run.flags.length; i++) {
      const x = run.xy[i * 2],
        y = run.xy[i * 2 + 1],
        f = run.flags[i];
      if ((f & (F.JUMP | F.STOP)) === (F.JUMP | F.STOP)) {
        // Machine stop requested inside the element (e.g. appliqué): handled exactly like a stop
        // entry in the sequence — tie-off, STOP (closes the colour block; same thread), TRIM,
        // JUMP to the point and tie-in.
        const part: StitchRun = { xy: run.xy.subarray(0, i * 2), flags: run.flags.subarray(0, i) };
        if (tieOn(el.tieOut, true)) emitTieOff(part, owner);
        em.push(em.pos![0], em.pos![1], F.STOP, owner);
        closeBlock(em.length);
        em.push(em.pos![0], em.pos![1], F.TRIM, owner);
        em.push(x, y, F.JUMP, owner);
        em.push(x, y, f & ~(F.JUMP | F.TRIM | F.STOP), owner);
        if (tieOn(el.tieIn, true)) emitTieIn(run, i, owner);
        continue;
      }
      if (f & F.JUMP) {
        const E = em.pos!;
        const d = Math.hypot(x - E[0], y - E[1]);
        // Generators mark jumps that have no inside path with TRIM: those are cut, unless the hop is
        // so short that one small stitch beats a tie-off, trim and tie-in (and, on machines
        // without a trimmer, a thread to cut by hand).
        const trim =
          // Guided rows are clipped at holes and disconnected boundaries. A short gap still
          // represents unstitched space, so its explicit no-inside-path jump must remain a jump.
          (el.type === 'guidedFill' && (f & F.TRIM) !== 0) ||
          ((f & F.TRIM) !== 0 && d > SHORT_HOP) ||
          (el.trimAfter !== 'never' && (el.trimAfter === 'always' || d > settings.trimThreshold));
        if (trim) {
          // Tie off along the part just sewn.
          const part: StitchRun = { xy: run.xy.subarray(0, i * 2), flags: run.flags.subarray(0, i) };
          if (tieOn(el.tieOut, true)) emitTieOff(part, owner);
          em.push(em.pos![0], em.pos![1], F.TRIM, owner);
          em.push(x, y, F.JUMP, owner);
          em.push(x, y, f & ~(F.JUMP | F.TRIM), owner);
          if (tieOn(el.tieIn, true)) emitTieIn(run, i, owner);
        } else {
          const m = Math.max(1, Math.ceil(d / settings.maxStitchLength));
          for (let j = 1; j < m; j++)
            em.push(E[0] + ((x - E[0]) * j) / m, E[1] + ((y - E[1]) * j) / m, F.TRAVEL, owner);
          em.push(x, y, (f & ~(F.JUMP | F.TRIM)) | F.TRAVEL, owner);
        }
        continue;
      }
      em.push(x, y, f, owner);
    }
    let rs = rangeStart;
    while (rs < em.length && em.owner[rs] !== owner) rs++;
    elementRanges.push({ elementId: el.id, start: rs, end: em.length });
    prevEl = el;
    prevRun = run;
    prevOwner = owner;
    yield;
  }

  // End of design.
  if (em.pos) {
    if (prevEl && prevRun && tieOn(prevEl.tieOut, true)) emitTieOff(prevRun, prevOwner);
    // No final TRIM: PES can only carry a trim on a following jump, so it would not survive export.
    em.push(em.pos[0], em.pos[1], F.END, NO_ELEMENT);
  }
  closeBlock(em.length);

  // Extend element ranges to cover trailing tie-offs/trims assigned to them.
  for (let r = 0; r < elementRanges.length; r++) {
    const range = elementRanges[r];
    let e = range.end;
    while (e < em.length && em.owner[e] === r) e++;
    range.end = e;
  }

  // Stats and bounds.
  const n = em.length;
  const x = Float32Array.from(em.x);
  const y = Float32Array.from(em.y);
  const flags = Uint8Array.from(em.flags);
  const element = Uint32Array.from(em.owner.map((o) => (o === NO_ELEMENT ? NO_ELEMENT : o)));
  let stitches = 0,
    jumps = 0,
    trims = 0,
    colorChanges = 0,
    stops = 0,
    threadLen = 0;
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  let px = NaN,
    py = NaN;
  let longStitches = 0;
  for (let i = 0; i < n; i++) {
    const f = flags[i];
    if (f & F.JUMP) jumps++;
    else if (f & F.TRIM) trims++;
    else if (f & F.COLOR_CHANGE) colorChanges++;
    else if (f & F.STOP) stops++;
    else if (f & F.END) {
      /* end */
    } else {
      stitches++;
      if (!Number.isNaN(px)) {
        const l = Math.hypot(x[i] - px, y[i] - py);
        threadLen += l;
        if (l > 12.05) longStitches++;
      }
      if (x[i] < bounds.minX) bounds.minX = x[i];
      if (y[i] < bounds.minY) bounds.minY = y[i];
      if (x[i] > bounds.maxX) bounds.maxX = x[i];
      if (y[i] > bounds.maxY) bounds.maxY = y[i];
    }
    if (!(f & (F.TRIM | F.COLOR_CHANGE | F.STOP | F.END))) {
      px = x[i];
      py = y[i];
    }
  }
  if (stitches === 0) {
    bounds.minX = bounds.minY = bounds.maxX = bounds.maxY = 0;
    if (items.length)
      diagnostics.push({ severity: 'error', code: 'no-stitches', message: 'The design has no stitches.' });
  }
  // Heavy stacking: more than 3 fill layers sewn over the same spot.
  {
    const fills = items
      .filter((it): it is Extract<Item, { kind: 'el' }> => it.kind === 'el' && it.el.role === 'fill')
      .slice(0, 400);
    if (fills.length > 3) {
      const cell = 1;
      const counts = new Map<number, { n: number; top: Id }>();
      for (const it of fills) {
        const { poly, bbox } = shapePoly(cache, it.shape);
        if (!poly.length || !(bbox.maxX > bbox.minX)) continue;
        const inside = createPointTester(poly);
        const cx0 = Math.floor(bbox.minX / cell),
          cx1 = Math.floor(bbox.maxX / cell),
          cy0 = Math.floor(bbox.minY / cell),
          cy1 = Math.floor(bbox.maxY / cell);
        if ((cx1 - cx0 + 1) * (cy1 - cy0 + 1) > 250000) continue;
        for (let cx = cx0; cx <= cx1; cx++)
          for (let cy = cy0; cy <= cy1; cy++) {
            if (!inside((cx + 0.5) * cell, (cy + 0.5) * cell)) continue;
            const k = cx * 100003 + cy;
            const c = counts.get(k);
            if (c) {
              c.n++;
              c.top = it.el.id;
            } else counts.set(k, { n: 1, top: it.el.id });
          }
      }
      let worst: { k: number; n: number; top: Id } | null = null;
      for (const [k, c] of counts)
        if (c.n > 3 && (!worst || c.n > worst.n)) worst = { k, n: c.n, top: c.top };
      if (worst) {
        const cx = Math.round(worst.k / 100003);
        const cy = worst.k - cx * 100003;
        diagnostics.push({
          severity: 'warning',
          code: 'heavy-stacking',
          message: `${worst.n} fill layers are stacked in one place; the fabric may pucker. Consider removing overlaps.`,
          elementId: worst.top,
          at: [(cx + 0.5) * cell, (cy + 0.5) * cell],
        });
      }
    }
  }
  if (trims > 200)
    diagnostics.push({
      severity: 'warning',
      code: 'many-trims',
      message: `${trims} trims — consider reordering or merging objects.`,
    });
  if (longStitches)
    diagnostics.push({
      severity: 'warning',
      code: 'long-stitches',
      message: `${longStitches} stitches longer than 12 mm.`,
    });
  const estSeconds =
    (stitches * 60) / Math.max(1, settings.machineSpm) +
    trims * settings.trimSeconds +
    (colorChanges + stops) * settings.colorChangeSeconds;

  return {
    revision: opts.revision ?? 0,
    x,
    y,
    flags,
    element,
    elementIds,
    elementRanges,
    colorBlocks: blocks.filter((b) => b.end > b.start),
    bounds,
    stats: { stitches, jumps, trims, colorChanges, stops, threadLengthMm: threadLen, estSeconds },
    diagnostics,
  };
}

/** Synchronous build (tests, thumbnails). */
export function buildPlan(design: Design, opts: BuildOptions = {}): StitchPlan {
  const gen = planGenerator(design, opts);
  while (true) {
    const r = gen.next();
    if (r.done) return r.value;
  }
}

/**
 * Asynchronous build that yields to the event loop about every 10 ms and aborts (returns null)
 * as soon as `isStale()` reports a newer revision.
 */
export async function buildPlanAsync(
  design: Design,
  opts: BuildOptions & { isStale: () => boolean },
): Promise<StitchPlan | null> {
  const gen = planGenerator(design, opts);
  let t0 = Date.now();
  while (true) {
    const r = gen.next();
    if (r.done) return r.value;
    if (Date.now() - t0 > 10) {
      await new Promise((res) => setTimeout(res, 0));
      if (opts.isStale()) return null;
      t0 = Date.now();
    }
  }
}

/** Transferable buffers of a plan (for postMessage). */
export function planTransferables(plan: StitchPlan): ArrayBuffer[] {
  return [plan.x.buffer, plan.y.buffer, plan.flags.buffer, plan.element.buffer] as ArrayBuffer[];
}
