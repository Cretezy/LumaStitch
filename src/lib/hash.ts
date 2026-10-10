// SPDX-License-Identifier: GPL-3.0-or-later
/** FNV-1a 32-bit over a stable serialisation. Used for engine cache keys. */

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

export function fnv1a(str: string, seed = FNV_OFFSET): number {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME);
  }
  return h >>> 0;
}

/** Deterministic JSON: object keys sorted, numbers rounded to 1e-6. */
export function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 'null';
    return String(Math.round(value * 1e6) / 1e6);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (ArrayBuffer.isView(value)) return stableStringify(Array.from(value as unknown as ArrayLike<number>));
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  if (typeof value === 'object') {
    const keys = Object.keys(value as object)
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .sort();
    return (
      '{' +
      keys
        .map((k) => JSON.stringify(k) + ':' + stableStringify((value as Record<string, unknown>)[k]))
        .join(',') +
      '}'
    );
  }
  return 'null';
}

/** 64-bit-ish key as two FNV hashes with different seeds, hex encoded. */
export function hashKey(value: unknown): string {
  const s = typeof value === 'string' ? value : stableStringify(value);
  return fnv1a(s).toString(16).padStart(8, '0') + fnv1a(s, 0x9747b28c).toString(16).padStart(8, '0');
}
