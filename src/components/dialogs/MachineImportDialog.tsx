// SPDX-License-Identifier: GPL-3.0-or-later
import { useEffect, useState } from 'react';
import type { DialogProps } from '../DialogHost';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import * as Comlink from 'comlink';
import type { prepareMachineImport } from '@/io/machine/import';
import { addShapes } from '@/store/commands';
import { openDesignObject } from '@/store/actions';
import { useDoc } from '@/store/documentStore';
import { useUi } from '@/store/uiStore';
import { fitDesign } from '@/canvas/CanvasView';

export default function MachineImportDialog({ open, onClose, data }: DialogProps) {
  const file = data.file as File;
  const extension = file.name.split('.').at(-1)!.toLowerCase();
  const [result, setResult] = useState<ReturnType<typeof prepareMachineImport> | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    const worker = new Worker(new URL('../../worker/machineImport.worker.ts', import.meta.url), {
      type: 'module',
    });
    const api = Comlink.wrap<{ prepareMachineImport: typeof prepareMachineImport }>(worker);
    void file
      .arrayBuffer()
      .then((bytes) => api.prepareMachineImport(new Uint8Array(bytes), file.name))
      .then((parsed) => {
        if (alive) setResult(parsed);
      })
      .catch((e) => {
        if (alive) setError(String(e));
      });
    return () => {
      alive = false;
      worker.terminate();
    };
  }, [file, extension]);
  async function accept() {
    if (!result) return;
    setBusy(true);
    try {
      const d = result.design;
      if (data.intoCurrent && useDoc.getState().design)
        addShapes('Import machine stitches', {
          shapes: d.zOrder.map((id) => d.shapes[id]),
          threads: Object.values(d.threads),
        });
      else await openDesignObject(d);
      useUi
        .getState()
        .set({ importNotes: result.notes.map((message) => ({ code: 'machine-import', message })) });
      onClose();
      requestAnimationFrame(fitDesign);
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Import machine stitches</DialogTitle>
          <DialogDescription>{file.name}</DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : result ? (
          <div className="grid gap-3 text-sm">
            <p>
              {result.stitches.toLocaleString()} needle penetrations · {result.colors} thread blocks
            </p>
            <p>
              Each needle position becomes an editable node. Jumps, trims and stops remain explicit commands.
              Moving or scaling imported stitches moves the existing needles; density is not regenerated.
            </p>
            <p className="text-muted-foreground">
              Machine files do not contain the original vector objects, satin rails, density settings or
              editable text. This import preserves stitches; it does not reconstruct those source objects.
            </p>
            {result.notes.map((note) => (
              <p key={note} className="rounded border p-2 text-xs">
                {note}
              </p>
            ))}
          </div>
        ) : (
          <p>Reading stitches…</p>
        )}
        <DialogFooter>
          {extension === 'pes' && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => useUi.getState().openDialog('export', { viewPes: true, file })}
            >
              View PES only
            </Button>
          )}
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!result || !!error || busy} onClick={() => void accept()}>
            {busy ? 'Importing…' : 'Import stitches'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
