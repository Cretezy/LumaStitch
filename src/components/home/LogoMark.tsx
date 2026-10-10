// SPDX-License-Identifier: GPL-3.0-or-later
/** The LumaStitch logo mark (same artwork as public/favicon.svg), tinted with the theme's primary colour. */
import { cn } from '@/lib/utils';

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn('size-8 shrink-0 text-primary', className)}
      aria-hidden
      focusable="false"
    >
      <rect width="32" height="32" rx="7" fill="currentColor" />
      <path
        d="M7 22 L13 10 L19 22 L25 10"
        fill="none"
        stroke="white"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray="3 2"
      />
    </svg>
  );
}
