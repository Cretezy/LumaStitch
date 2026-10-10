// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Stitch-out playback. A requestAnimationFrame loop runs outside React; listeners get the playhead
 * every frame and a throttled (~10 Hz) snapshot goes to uiStore for counters and panel highlighting.
 */
import { F, NO_ELEMENT, type StitchPlan } from '@/engine/types';
import type { DesignSettings } from '@/model/types';
import { usePlan } from '@/store/planStore';
import { useDoc } from '@/store/documentStore';
import { useUi } from '@/store/uiStore';

export const SPEEDS = [1, 2, 5, 10, 25, 100, Infinity];

type Listener = (index: number) => void;

class SimController {
  index = 0;
  private playing = false;
  private raf = 0;
  private last = 0;
  private lastPush = 0;
  private listeners = new Set<Listener>();
  private timeCache = new WeakMap<StitchPlan, Float64Array>();

  get plan(): StitchPlan | null {
    return usePlan.getState().plan;
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private emit(force = false) {
    const i = Math.floor(this.index);
    for (const l of this.listeners) l(i);
    const now = performance.now();
    if (force || now - this.lastPush > 100) {
      this.lastPush = now;
      useUi.getState().setSim({ index: i, playing: this.playing });
    }
  }

  get length(): number {
    return this.plan?.flags.length ?? 0;
  }

  private lastPlan: StitchPlan | null = null;

  start(): void {
    const ui = useUi.getState();
    // A different design (or a regenerated plan) starts from the beginning.
    if (this.plan !== this.lastPlan) this.index = 0;
    this.lastPlan = this.plan;
    if (!ui.sim.active) ui.setSim({ active: true, index: 0, playing: false });
    this.index = Math.min(this.index, Math.max(0, this.length - 1));
    if (this.index >= this.length - 1) this.index = 0;
    this.emit(true);
  }

  stop(): void {
    this.pause();
    useUi.getState().setSim({ active: false, playing: false });
  }

  play(): void {
    if (!this.plan) return;
    if (this.index >= this.length - 1) this.index = 0;
    this.playing = true;
    this.last = performance.now();
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.tick);
    this.emit(true);
  }

  pause(): void {
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.emit(true);
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  isPlaying(): boolean {
    return this.playing;
  }

  private settings(): DesignSettings | null {
    return useDoc.getState().design?.settings ?? null;
  }

  /** Commands per second at the current speed. */
  private rate(): number {
    const spm = this.settings()?.machineSpm ?? 600;
    const speed = useUi.getState().sim.speed;
    return speed === Infinity ? Infinity : (spm / 60) * speed;
  }

  private tick = (t: number) => {
    if (!this.playing) return;
    const plan = this.plan;
    if (!plan) return;
    const dt = Math.min(0.1, (t - this.last) / 1000);
    this.last = t;
    const r = this.rate();
    const prev = Math.floor(this.index);
    let next = r === Infinity ? this.index + Math.max(200, plan.flags.length / 240) : this.index + r * dt;
    // Pause at colour changes / stops when requested.
    if (useUi.getState().sim.stopAtColorChange) {
      for (let i = prev + 1; i <= Math.min(Math.floor(next), plan.flags.length - 1); i++) {
        if (plan.flags[i] & (F.COLOR_CHANGE | F.STOP)) {
          next = i;
          this.index = next;
          this.pause();
          return;
        }
      }
    }
    if (next >= plan.flags.length - 1) {
      this.index = plan.flags.length - 1;
      this.playing = false;
      this.emit(true);
      return;
    }
    this.index = next;
    this.emit();
    this.raf = requestAnimationFrame(this.tick);
  };

  seek(i: number): void {
    const n = this.length;
    this.index = Math.max(0, Math.min(n - 1, Math.round(i)));
    this.emit(true);
  }

  step(n: number): void {
    // Steps over penetrations, skipping pure bookkeeping commands.
    const plan = this.plan;
    if (!plan) return;
    let i = Math.floor(this.index);
    const dir = Math.sign(n);
    for (let k = 0; k < Math.abs(n); k++) {
      i += dir;
      while (i > 0 && i < plan.flags.length - 1 && plan.flags[i] & (F.TRIM | F.COLOR_CHANGE | F.STOP))
        i += dir;
    }
    this.seek(i);
  }

  /** Jump to the start of the next/previous element. */
  element(dir: 1 | -1): void {
    const plan = this.plan;
    if (!plan) return;
    const i = Math.floor(this.index);
    const starts = plan.elementRanges.map((r) => r.start);
    if (dir > 0) {
      const s = starts.find((s) => s > i);
      this.seek(s ?? plan.flags.length - 1);
    } else {
      const cur = plan.elementRanges.findIndex((r) => i >= r.start && i < r.end);
      const prevStarts = starts.filter((s) => s < i);
      let target = prevStarts.length ? prevStarts[prevStarts.length - 1] : 0;
      if (cur >= 0 && plan.elementRanges[cur].start < i && i - plan.elementRanges[cur].start > 2)
        target = plan.elementRanges[cur].start;
      this.seek(target);
    }
  }

  /** Jump to the next/previous colour change. */
  color(dir: 1 | -1): void {
    const plan = this.plan;
    if (!plan) return;
    const i = Math.floor(this.index);
    const starts = plan.colorBlocks.map((b) => b.start);
    if (dir > 0) this.seek(starts.find((s) => s > i) ?? plan.flags.length - 1);
    else {
      const prev = starts.filter((s) => s < i);
      this.seek(prev.length ? prev[prev.length - 1] : 0);
    }
  }

  /** Cumulative machine time (s) at each command. */
  times(plan: StitchPlan): Float64Array {
    let t = this.timeCache.get(plan);
    if (t) return t;
    const s = this.settings();
    const spm = s?.machineSpm ?? 600,
      trim = s?.trimSeconds ?? 6,
      cc = s?.colorChangeSeconds ?? 30;
    t = new Float64Array(plan.flags.length);
    let acc = 0;
    for (let i = 0; i < plan.flags.length; i++) {
      const f = plan.flags[i];
      if (f & F.TRIM) acc += trim;
      else if (f & (F.COLOR_CHANGE | F.STOP)) acc += cc;
      else if (!(f & (F.JUMP | F.END))) acc += 60 / spm;
      t[i] = acc;
    }
    this.timeCache.set(plan, t);
    return t;
  }

  /** Penetrations up to index i (inclusive). */
  stitchCountAt(plan: StitchPlan, i: number): number {
    let n = 0;
    for (let k = 0; k <= Math.min(i, plan.flags.length - 1); k++)
      if (!(plan.flags[k] & (F.JUMP | F.TRIM | F.COLOR_CHANGE | F.STOP | F.END))) n++;
    return n;
  }

  currentElementId(plan: StitchPlan, i: number): string | null {
    const e = plan.element[Math.min(i, plan.element.length - 1)];
    return e === NO_ELEMENT || e === undefined ? null : plan.elementIds[e];
  }
}

export const sim = new SimController();
