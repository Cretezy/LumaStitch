// SPDX-License-Identifier: GPL-3.0-or-later
/** Partition a digitized program at hoop-cell boundaries, adding seam locks and registration. */
import { buildPlan } from '@/engine/plan';
import { F, COMMAND_MASK } from '@/engine/types';
import { MC, type MachineCmd, type MachineCommand } from '@/io/pes/machineCommands';
import { machineDesign } from '@/io/machine/import';
import type { Design, MultiHoopOptions, Vec2 } from '@/model/types';
import { multiHoopSchema } from '@/model/schema';
import { hoopFit } from '@/engine/hoop';
import { assignWholeObjects, type WholeObject } from './objects';
import { placedLayout, toLocal, toWorld, type Placement } from './placement';

export interface Hooping {
  number: number;
  row: number;
  column: number;
  center: Vec2;
  marks: Vec2[];
  angle: number;
  placement: number;
  registrationParent: number | null;
  design: Design;
  wholeObjects: Omit<WholeObject, 'field'>[];
  originalNeedles: number;
}
interface Tile extends Placement {
  index: number;
  row: number;
  column: number;
  center: Vec2;
  marks: Vec2[];
  commands: MachineCommand[];
  colors: { color: string; name?: string; code?: string }[];
  active: boolean;
  last: Vec2 | null;
  prior: Vec2 | null;
  color: number;
  sinceStop: boolean;
  originalNeedles: number;
}
const REG = { color: '#c23b45', name: 'Temporary basting / registration', code: 'REG' };
const r = (n: number) => Math.round(n * 10) / 10;
const same = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-7;

export function splitHoopings(design: Design, input: MultiHoopOptions): Hooping[] {
  const options = multiHoopSchema.parse(input);
  const plan = buildPlan(design);
  if (plan.diagnostics.some((d) => d.severity === 'error'))
    throw new Error('Resolve stitch-generation errors before splitting hoopings.');
  if (!plan.stats.stitches) throw new Error('The design has no stitches.');
  if (plan.flags.length > 500000) throw new Error('Multi-hooping is limited to 500,000 source commands.');
  const w = Math.floor((options.width - 2 * options.margin) * 5) / 5,
    h = Math.floor((options.height - 2 * options.margin) * 5) / 5;
  const sx = r(w - options.overlap),
    sy = r(h - options.overlap);
  const bounds = plan.bounds;
  const cols = Math.max(1, Math.ceil((bounds.maxX - bounds.minX + 6 - w) / sx) + 1);
  const rows = Math.max(1, Math.ceil((bounds.maxY - bounds.minY + 6 - h) / sy) + 1);
  if (!options.placements && rows * cols > 64)
    throw new Error(
      `This layout needs ${rows * cols} hoopings; the limit is 64. Increase the sewing field or split the design first.`,
    );
  // Center the complete grid on the design, sharing spare room between its outer edges.
  const ox = r((bounds.minX + bounds.maxX - (cols - 1) * sx) / 2),
    oy = r((bounds.minY + bounds.maxY - (rows - 1) * sy) / 2);
  const custom = options.placements ? placedLayout(options.placements, w, h) : null;
  const tiles: Tile[] = [];
  if (options.placements) {
    for (const [index, p] of options.placements.entries())
      tiles.push({
        ...p,
        index,
        row: 0,
        column: index,
        marks: custom!.marks[index],
        commands: [],
        colors: [REG],
        active: false,
        last: null,
        prior: null,
        color: -1,
        sinceStop: false,
        originalNeedles: 0,
      });
  } else
    for (let row = 0; row < rows; row++)
      for (let column = 0; column < cols; column++)
        tiles.push({
          index: tiles.length,
          angle: 0,
          row,
          column,
          center: [r(ox + column * sx), r(oy + row * sy)],
          marks: [],
          commands: [],
          colors: [REG],
          active: false,
          last: null,
          prior: null,
          color: -1,
          sinceStop: false,
          originalNeedles: 0,
        });
  const whole = options.keepObjects ? assignWholeObjects(design, plan, tiles, w, h) : null;
  const at = (row: number, col: number) => tiles[row * cols + col];
  // Shared pairs in overlap bands: two noncoincident points establish translation and rotation.
  if (!custom)
    for (const t of tiles) {
      if (t.column + 1 < cols) {
        const other = at(t.row, t.column + 1);
        const x = r((t.center[0] + other.center[0]) / 2);
        for (const y of [r(t.center[1] - h / 4), r(t.center[1] + h / 4)]) {
          t.marks.push([x, y]);
          other.marks.push([x, y]);
        }
      }
      if (t.row + 1 < rows) {
        const other = at(t.row + 1, t.column);
        const y = r((t.center[1] + other.center[1]) / 2);
        for (const x of [r(t.center[0] - w / 4), r(t.center[0] + w / 4)]) {
          t.marks.push([x, y]);
          other.marks.push([x, y]);
        }
      }
    }
  const emit = (t: Tile, cmd: MachineCmd, p: Vec2) => {
    const local = toLocal(p, t);
    t.commands.push({ cmd, x: Math.round(local[0] * 10), y: Math.round(local[1] * 10) });
  };
  const line = (t: Tile, a: Vec2, b: Vec2, step = 3) => {
    emit(t, MC.JUMP, a);
    emit(t, MC.STITCH, a);
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let i = 1; i <= n; i++)
      emit(t, MC.STITCH, [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]);
    emit(t, MC.TRIM, b);
  };
  for (const t of tiles) {
    // Symmetric basting frame fixes the exported file's centering across all formats.
    const corners = (
      [
        [-w / 2 + 0.5, -h / 2 + 0.5],
        [w / 2 - 0.5, -h / 2 + 0.5],
        [w / 2 - 0.5, h / 2 - 0.5],
        [-w / 2 + 0.5, h / 2 - 0.5],
      ] as Vec2[]
    ).map((p) => toWorld(p, t));
    for (let i = 0; i < 4; i++) line(t, corners[i], corners[(i + 1) % 4]);
    for (const [a, b] of t.marks) {
      line(t, [a - 1, b], [a + 1, b], 1);
      line(t, [a, b - 1], [a, b + 1], 1);
    }
    const last = t.commands.at(-1)!;
    t.commands.push({ ...last, cmd: MC.STOP });
  }
  const close = (t: Tile) => {
    if (!t.active || !t.last) return;
    if (t.prior && !same(t.prior, t.last)) {
      const a = t.last,
        b = t.prior,
        k = Math.min(0.6 / Math.hypot(b[0] - a[0], b[1] - a[1]), 0.5);
      const q: Vec2 = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
      emit(t, MC.STITCH, q);
      emit(t, MC.STITCH, a);
    }
    emit(t, MC.TRIM, t.last);
    t.active = false;
  };
  const closeAll = () => tiles.forEach(close);
  const locate = (p: Vec2) =>
    custom
      ? tiles[custom.locate(p)]
      : at(
          Math.max(0, Math.min(rows - 1, Math.floor((p[1] - oy) / sy + 0.5))),
          Math.max(0, Math.min(cols - 1, Math.floor((p[0] - ox) / sx + 0.5))),
        );
  let color = 0,
    block = 0,
    previous: Vec2 | null = null;
  const begin = (t: Tile, a: Vec2, b: Vec2) => {
    if (t.active && t.last && same(t.last, a)) return;
    // Keep each tile's last section pending until its next visit. Neighboring fill rows can
    // join along the same ownership seam instead of adding a trim at every row crossing.
    if (
      options.joinSeams !== false &&
      t.active &&
      t.last &&
      t.color === color &&
      Math.hypot(a[0] - t.last[0], a[1] - t.last[1]) <= 1
    ) {
      const boundaries: [0 | 1, number][] = [];
      if (t.column) boundaries.push([0, t.center[0] - sx / 2]);
      if (t.column + 1 < cols) boundaries.push([0, t.center[0] + sx / 2]);
      if (t.row) boundaries.push([1, t.center[1] - sy / 2]);
      if (t.row + 1 < rows) boundaries.push([1, t.center[1] + sy / 2]);
      if (
        custom
          ? custom.canJoin(t.index, a, t.last)
          : boundaries.some(([axis, v]) => Math.abs(a[axis] - v) < 1e-6 && Math.abs(t.last![axis] - v) < 1e-6)
      ) {
        emit(t, MC.STITCH, a);
        t.prior = t.last;
        t.last = a;
        return;
      }
    }
    close(t);
    if (t.color !== color) {
      const source = plan.colorBlocks[block];
      const thread = design.threads[source?.threadId];
      t.colors.push({
        color: thread?.color ?? source?.color ?? '#000000',
        name: thread?.name,
        code: thread?.code,
      });
      const last = t.commands.at(-1)!;
      t.commands.push({ ...last, cmd: MC.COLOR_CHANGE });
      t.color = color;
    }
    emit(t, MC.JUMP, a);
    emit(t, MC.STITCH, a);
    if (!same(a, b)) {
      const k = Math.min(0.6 / Math.hypot(b[0] - a[0], b[1] - a[1]), 0.5);
      const q: Vec2 = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
      emit(t, MC.STITCH, q);
      emit(t, MC.STITCH, a);
    }
    t.active = true;
    t.last = a;
    t.prior = null;
    t.sinceStop = true;
  };
  for (let i = 0; i < plan.flags.length; i++) {
    const flag = plan.flags[i];
    while (block + 1 < plan.colorBlocks.length && i >= plan.colorBlocks[block].end) block++;
    const p: Vec2 = [r(plan.x[i]), r(plan.y[i])];
    const forced = whole?.owners[plan.element[i]] ?? -1;
    if (flag & COMMAND_MASK) {
      closeAll();
      previous = null;
      if (flag & F.COLOR_CHANGE) color++;
      if (flag & F.STOP)
        for (const t of tiles)
          if (t.sinceStop && t.last) {
            emit(t, MC.STOP, t.last);
            t.sinceStop = false;
          }
      continue;
    }
    if (!previous || same(previous, p)) {
      const t = forced >= 0 ? tiles[forced] : locate(p);
      begin(t, p, p);
      emit(t, MC.STITCH, p);
      t.originalNeedles++;
      t.last = p;
      previous = p;
      continue;
    }
    const a: Vec2 = previous,
      cuts = [0, 1];
    const addCuts = (start: number, end: number, origin: number, step: number, count: number) => {
      if (Math.abs(end - start) < 1e-9) return;
      for (let k = 0; k < count - 1; k++) {
        const u = (origin + (k + 0.5) * step - start) / (end - start);
        if (u > 1e-8 && u < 1 - 1e-8) cuts.push(u);
      }
    };
    // Whole-object assignment has already checked both endpoints of every sewn chord.
    if (forced < 0) {
      if (custom) cuts.push(...custom.cuts(a, p));
      else {
        addCuts(a[0], p[0], ox, sx, cols);
        addCuts(a[1], p[1], oy, sy, rows);
      }
    }
    const sorted = [...new Set(cuts)].sort((x, y) => x - y);
    const point = (u: number): Vec2 => [a[0] + (p[0] - a[0]) * u, a[1] + (p[1] - a[1]) * u];
    for (let j = 1; j < sorted.length; j++) {
      const owner = forced >= 0 ? tiles[forced] : locate(point((sorted[j - 1] + sorted[j]) / 2));
      const first = j;
      while (custom && j + 1 < sorted.length && locate(point((sorted[j] + sorted[j + 1]) / 2)) === owner) j++;
      const start = point(sorted[first - 1]),
        end = point(sorted[j]),
        t = owner;
      begin(t, start, end);
      emit(t, MC.STITCH, end);
      t.prior = start;
      t.last = end;
      if (j === sorted.length - 1) t.originalNeedles++;
    }
    previous = p;
  }
  closeAll();
  // Serpentine hooping order keeps successive placements adjacent; source order is retained
  // independently inside every hoop, including stops for multi-stage appliqué.
  const ordered = custom
    ? custom.order.map((i) => tiles[i])
    : tiles.slice().sort((a, b) => a.row - b.row || (a.row % 2 ? b.column - a.column : a.column - b.column));
  return ordered.map((t, i) => {
    const last = t.commands.at(-1)!;
    t.commands.push({ ...last, cmd: MC.END });
    const d = machineDesign(
      { commands: t.commands, colors: t.colors, name: '', notes: [] },
      `${design.name} — hoop ${i + 1}`,
    );
    d.hoop = { width: options.width, height: options.height, margin: options.margin, shape: 'rectangle' };
    d.fabric = design.fabric;
    d.fabricProfile = design.fabricProfile;
    d.settings = { ...design.settings };
    d.fabricColor = design.fabricColor;
    const output = buildPlan(d);
    if (hoopFit(output, d.hoop).outside)
      throw new Error(
        `Hooping ${i + 1} exceeds the sewing field after quantization. Increase the margin or reduce overlap.`,
      );
    return {
      number: i + 1,
      row: t.row,
      column: t.column,
      center: t.center,
      marks: t.marks,
      angle: t.angle,
      placement: t.index + 1,
      registrationParent:
        custom?.parents[t.index] != null ? custom.order.indexOf(custom.parents[t.index]!) + 1 : null,
      design: d,
      wholeObjects: (whole?.objects ?? [])
        .filter((o) => o.field === t.index)
        .map(({ field: _field, ...object }) => object),
      originalNeedles: t.originalNeedles,
    };
  });
}
