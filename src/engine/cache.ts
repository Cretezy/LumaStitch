// SPDX-License-Identifier: GPL-3.0-or-later
/** Small LRU on top of Map insertion order. */
export class LRU<K, V> {
  private map = new Map<K, V>();
  hits = 0;
  misses = 0;
  constructor(private capacity = 2000) {}

  get(key: K): V | undefined {
    const v = this.map.get(key);
    if (v === undefined) {
      this.misses++;
      return undefined;
    }
    this.hits++;
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.capacity) {
      const first = this.map.keys().next().value as K;
      this.map.delete(first);
    }
  }

  get size(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }
}
