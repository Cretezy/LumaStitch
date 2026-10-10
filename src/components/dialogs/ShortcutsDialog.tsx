// SPDX-License-Identifier: GPL-3.0-or-later
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { SHORTCUTS, type Shortcut } from '@/lib/keymap';
import type { DialogProps } from '../DialogHost';

export default function ShortcutsDialog({ open, onClose }: DialogProps) {
  const groups = SHORTCUTS.reduce<Record<string, Shortcut[]>>((acc, s) => {
    (acc[s.group] ??= []).push(s);
    return acc;
  }, {});
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        <div className="columns-2 gap-8 text-sm">
          {Object.entries(groups).map(([g, items]) => (
            <section key={g} className="mb-4 break-inside-avoid">
              <h3 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                {g}
              </h3>
              <dl>
                {items.map((s) => (
                  <div key={s.label} className="flex items-center justify-between gap-4 py-0.5">
                    <dt>{s.label}</dt>
                    <dd>
                      <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px] whitespace-nowrap">
                        {s.keys}
                      </kbd>
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
