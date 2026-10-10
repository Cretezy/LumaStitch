// SPDX-License-Identifier: GPL-3.0-or-later
/** Small formatting helpers for the home screen. */

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

/** "just now", "5 minutes ago", "yesterday", "3 weeks ago"… */
export function relativeTime(ts: number, now: number = Date.now()): string {
  const sec = (ts - now) / 1000;
  if (Math.abs(sec) < 45) return 'just now';
  for (const [unit, size] of UNITS) {
    if (Math.abs(sec) >= size || unit === 'minute') return rtf.format(Math.round(sec / size), unit);
  }
  return 'just now';
}

export function absoluteTime(ts: number): string {
  return new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

const int = new Intl.NumberFormat();
const mm = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

export function formatSize(w?: number, h?: number): string | null {
  if (!(typeof w === 'number' && typeof h === 'number' && w > 0 && h > 0)) return null;
  return `${mm.format(w)} × ${mm.format(h)} mm`;
}

export function formatStitches(n?: number): string | null {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  return `${int.format(n)} st`;
}

export function backupFileDate(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
