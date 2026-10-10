// SPDX-License-Identifier: GPL-3.0-or-later
/** My threads (FR-5.2b): the spools the user owns, shared by all designs. */
import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Swatch, ThreadPicker } from '@/components/threads/ThreadPicker';
import {
  fromDesignColors,
  loadMyThreads,
  mergeMyThreads,
  removeMyThreads,
  saveMyThreads,
  type MyThreads,
} from '@/library/myThreads';
import { newId } from '@/lib/ids';
import { useDoc } from '@/store/documentStore';
import { useUi } from '@/store/uiStore';
import type { DialogProps } from '../DialogHost';

export default function MyThreadsDialog({ open, onClose }: DialogProps) {
  const [mine, setMine] = useState<MyThreads | null>(null);
  const design = useDoc((s) => s.design);
  useEffect(() => {
    void loadMyThreads().then(setMine);
  }, []);
  const update = (m: MyThreads) => {
    setMine(m);
    void saveMyThreads(m);
  };
  if (!mine) return null;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>My threads</DialogTitle>
          <DialogDescription>
            The spools you actually own, shared by all designs. Auto-digitize and “Map all colours” can limit
            colours to these, so every colour is one you have on hand.
          </DialogDescription>
        </DialogHeader>
        <div className="grid max-h-80 grid-cols-2 gap-1 overflow-y-auto rounded-md border p-1">
          {mine.threads.map((t) => (
            <div
              key={t.id}
              className="group flex items-center gap-2 rounded px-2 py-1 text-xs hover:bg-accent"
            >
              <Swatch color={t.color} className="size-5" />
              <span className="min-w-0 flex-1 truncate">
                {t.code ? <span className="text-muted-foreground">{t.code} </span> : null}
                {t.name}
              </span>
              <button
                type="button"
                className="opacity-0 group-hover:opacity-100"
                onClick={() => update(removeMyThreads(mine, [t.id]))}
                aria-label={`Remove ${t.name}`}
              >
                <Trash2 className="size-3.5 text-muted-foreground" />
              </button>
            </div>
          ))}
          {!mine.threads.length && (
            <p className="col-span-2 p-6 text-center text-xs text-muted-foreground">No spools yet.</p>
          )}
        </div>
        <DialogFooter className="sm:justify-between">
          <div className="flex gap-2">
            <ThreadPicker
              value={null}
              trigger={
                <Button variant="outline" size="sm">
                  <Plus /> Add thread
                </Button>
              }
              onPick={(c) => {
                if (!c.thread) return;
                const t = c.thread;
                update(
                  mergeMyThreads(mine, [
                    {
                      id: t.chart && t.code ? `${t.chart}:${t.code}:${t.color.slice(1)}` : newId('my'),
                      name: t.name,
                      color: t.color.toLowerCase(),
                      code: t.code,
                      chart: t.chart,
                    },
                  ]),
                );
              }}
            />
            <Button
              variant="outline"
              size="sm"
              disabled={!design}
              onClick={() => {
                const added = fromDesignColors(Object.values(design!.threads));
                update(mergeMyThreads(mine, added));
                useUi
                  .getState()
                  .showToast(
                    `Added ${added.length} colour${added.length === 1 ? '' : 's'} from this design.`,
                  );
              }}
            >
              Add this design’s colours
            </Button>
          </div>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
