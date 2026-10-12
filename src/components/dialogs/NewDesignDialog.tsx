// SPDX-License-Identifier: GPL-3.0-or-later
/** New design: name + fabric preset (SPEC §4 step 1). Optional sewing-field checks are configured in Design settings (SPEC §7). */
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Feather, Grid3x3, Info, LoaderCircle, Shirt, WavesHorizontal, type LucideIcon } from 'lucide-react';
import type { DialogProps } from '@/components/DialogHost';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FABRIC_IDS, FABRIC_PRESETS } from '@/engine/params/fabric';
import { getPref } from '@/library/library';
import type { FabricId } from '@/model/types';
import { newDesign } from '@/store/actions';
import { useUi } from '@/store/uiStore';
import { cn } from '@/lib/utils';

const FABRIC_ICONS: Record<FabricId, LucideIcon> = {
  woven: Grid3x3,
  knit: Shirt,
  pile: WavesHorizontal,
  lightweight: Feather,
};

export default function NewDesignDialog({ open, onClose, data }: DialogProps) {
  const [name, setName] = useState<string>(typeof data?.name === 'string' ? data.name : 'Untitled');
  const [fabric, setFabric] = useState<FabricId>('woven');
  const [busy, setBusy] = useState(false);
  const touched = useRef(false);
  const nameId = useId();
  const groupName = useId();

  // Default to the last fabric used (initially woven), unless the user has already picked one.
  useEffect(() => {
    let alive = true;
    void getPref<FabricId>('lastFabric').then((f) => {
      if (alive && !touched.current && f && FABRIC_IDS.includes(f)) setFabric(f);
    });
    return () => {
      alive = false;
    };
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await newDesign({ name: name.trim() || 'Untitled', fabric });
      onClose();
    } catch (err) {
      useUi
        .getState()
        .showToast(
          `Could not create the design: ${err instanceof Error ? err.message : String(err)}`,
          'error',
        );
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>New design</DialogTitle>
            <DialogDescription>
              Name your design and choose the fabric you will stitch on. You can change both later.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-1.5">
            <Label htmlFor={nameId}>Name</Label>
            <Input
              id={nameId}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              autoFocus
              maxLength={120}
            />
          </div>

          <fieldset className="grid gap-1.5">
            <legend className="mb-1.5 text-xs font-medium">Fabric</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {FABRIC_IDS.map((id) => {
                const p = FABRIC_PRESETS[id];
                const Icon = FABRIC_ICONS[id] ?? Grid3x3;
                const checked = fabric === id;
                return (
                  <label
                    key={id}
                    className={cn(
                      'flex cursor-pointer gap-2.5 rounded-md border p-2.5 transition-colors hover:bg-accent/60',
                      'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50',
                      checked && 'border-primary bg-accent',
                    )}
                  >
                    <input
                      type="radio"
                      name={groupName}
                      value={id}
                      checked={checked}
                      onChange={() => {
                        touched.current = true;
                        setFabric(id);
                      }}
                      className="sr-only"
                    />
                    <Icon
                      className={cn(
                        'mt-0.5 size-4 shrink-0',
                        checked ? 'text-primary' : 'text-muted-foreground',
                      )}
                      aria-hidden
                    />
                    <span className="grid gap-0.5">
                      <span className="text-sm leading-tight font-medium">{p.label}</span>
                      <span className="text-xs text-muted-foreground">{p.description}</span>
                      <span className="text-[11px] text-muted-foreground/80">{p.stabilizer}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <p className="flex gap-2 rounded-md bg-muted px-2.5 py-2 text-xs text-muted-foreground">
            <Info className="mt-px size-3.5 shrink-0" aria-hidden />
            <span>
              You can enable a sewing-field overlay and fit warnings in Design settings. Enter the usable
              embroidery area of the hoop you will use.
            </span>
          </p>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy && <LoaderCircle className="animate-spin" aria-hidden />}
              Create design
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
