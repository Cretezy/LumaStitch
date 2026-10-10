// SPDX-License-Identifier: GPL-3.0-or-later
import { useEffect, useState } from 'react';
import { CheckCircle2, Info, XCircle } from 'lucide-react';
import { useUi } from '@/store/uiStore';
import { cn } from '@/lib/utils';

export function Toaster() {
  const toast = useUi((s) => s.toast);
  const [visible, setVisible] = useState<typeof toast>(null);
  useEffect(() => {
    setVisible(toast);
    if (!toast) return;
    const t = setTimeout(
      () => setVisible((v) => (v?.id === toast.id ? null : v)),
      toast.kind === 'error' ? 7000 : 4000,
    );
    return () => clearTimeout(t);
  }, [toast]);
  if (!visible) return null;
  const Icon = visible.kind === 'error' ? XCircle : visible.kind === 'success' ? CheckCircle2 : Info;
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed bottom-14 left-1/2 z-[60] -translate-x-1/2"
    >
      <div
        className={cn(
          'pointer-events-auto flex max-w-xl items-center gap-2 rounded-lg border bg-popover px-3 py-2 text-sm shadow-lg animate-in fade-in-0 slide-in-from-bottom-2',
          visible.kind === 'error' && 'border-destructive/40',
        )}
        onClick={() => setVisible(null)}
      >
        <Icon
          className={cn(
            'size-4 shrink-0',
            visible.kind === 'error'
              ? 'text-destructive'
              : visible.kind === 'success'
                ? 'text-emerald-600'
                : 'text-primary',
          )}
        />
        <span>{visible.message}</span>
      </div>
    </div>
  );
}
