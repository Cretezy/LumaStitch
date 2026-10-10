// SPDX-License-Identifier: GPL-3.0-or-later
/** Auto-digitize dialog (FR-7.1): fabric, colours, max colours, overlaps, min detail, outlines. Remembers values. */
import { useEffect, useMemo, useState } from 'react';
import { Loader2, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { NumberField } from '@/components/inspector/NumberField';
import { FABRIC_IDS, FABRIC_PRESETS } from '@/engine/params/fabric';
import type { FabricId } from '@/model/types';
import { listCharts } from '@/threads/charts';
import {
  autoDigitize,
  loadAutoOptions,
  type AutoDigitizeOptions,
  type AutoDigitizeSummary,
} from '@/store/commands/autoDigitize';
import { useUi } from '@/store/uiStore';
import { useDoc } from '@/store/documentStore';
import type { DialogProps } from '../DialogHost';

export default function AutoDigitizeDialog({ open, onClose }: DialogProps) {
  const [opts, setOpts] = useState<AutoDigitizeOptions | null>(null);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<AutoDigitizeSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selCount = useUi((s) => s.selection.shapeIds.length);
  const shapeCount = useDoc((s) => Object.keys(s.design?.shapes ?? {}).length);
  const charts = useMemo(() => listCharts(), []);
  useEffect(() => {
    void loadAutoOptions().then(setOpts);
  }, []);
  if (!opts) return null;
  const set = (p: Partial<AutoDigitizeOptions>) => setOpts({ ...opts, ...p });
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const s = await autoDigitize(opts);
      setSummary(s);
      if (s && !s.dropped) onClose();
    } catch (err) {
      console.error(err);
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="size-4 text-primary" /> Auto-digitize
          </DialogTitle>
          <DialogDescription>
            Assigns stitch types, settings, threads and sewing order to{' '}
            {selCount
              ? `the ${selCount} selected shape${selCount === 1 ? '' : 's'}`
              : `all ${shapeCount} shapes`}
            . The result is ordinary editable elements, and the whole run undoes as one step.
          </DialogDescription>
        </DialogHeader>
        {summary ? (
          <div className="space-y-3 text-sm">
            <p>Done: {summary.message}.</p>
            {summary.droppedIds.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  useUi.getState().setSelection({ shapeIds: summary.droppedIds, elementIds: [], nodes: [] });
                  onClose();
                }}
              >
                Select the dropped details
              </Button>
            )}
            <DialogFooter>
              <Button onClick={onClose}>Close</Button>
            </DialogFooter>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-[8rem_1fr] items-center gap-x-3 gap-y-3 text-sm">
              <Label>Fabric</Label>
              <Select value={opts.fabric} onValueChange={(v) => set({ fabric: v as FabricId })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FABRIC_IDS.map((f) => (
                    <SelectItem key={f} value={f}>
                      {FABRIC_PRESETS[f].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Label>Colours</Label>
              <Select
                value={
                  opts.colors === 'chart' ? `chart:${opts.chartId ?? 'brother-embroidery'}` : opts.colors
                }
                onValueChange={(v) =>
                  v.startsWith('chart:')
                    ? set({ colors: 'chart', chartId: v.slice(6) })
                    : set({ colors: v as 'exact' | 'myThreads' })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value="exact">Keep exact colours</SelectItem>
                  <SelectItem value="myThreads">Only threads I own (My threads)</SelectItem>
                  {charts.map((c) => (
                    <SelectItem key={c.id} value={`chart:${c.id}`}>
                      Nearest in {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Label htmlFor="ad-max">Maximum colours</Label>
              <div className="flex items-center gap-2">
                <NumberField
                  id="ad-max"
                  value={opts.maxColors}
                  min={0}
                  max={64}
                  step={1}
                  digits={0}
                  onCommit={(v) => set({ maxColors: Math.round(v) })}
                  className="w-20"
                />
                <span className="text-xs text-muted-foreground">{opts.maxColors ? '' : '0 = no limit'}</span>
              </div>
              <Label htmlFor="ad-detail">Minimum detail</Label>
              <div className="flex items-center gap-2">
                <NumberField
                  id="ad-detail"
                  value={opts.minDetail}
                  min={0.2}
                  max={5}
                  step={0.1}
                  digits={1}
                  unit="mm"
                  onCommit={(v) => set({ minDetail: v })}
                  className="w-24"
                />
                <span className="text-xs text-muted-foreground">
                  Thinner parts become runs or are dropped
                </span>
              </div>
              <Label>Outlines</Label>
              <Select
                value={opts.outlines}
                onValueChange={(v) => set({ outlines: v as AutoDigitizeOptions['outlines'] })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">By stroke width (run, triple, satin)</SelectItem>
                  <SelectItem value="running">Always running stitch</SelectItem>
                  <SelectItem value="triple">Always triple run</SelectItem>
                  <SelectItem value="satin">Always satin</SelectItem>
                  <SelectItem value="none">No outlines</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="flex items-start gap-2 text-sm">
                <Checkbox
                  checked={opts.removeOverlaps}
                  onCheckedChange={(c) => set({ removeOverlaps: !!c })}
                  className="mt-0.5"
                />
                <span>
                  Remove overlaps
                  <span className="block text-xs text-muted-foreground">
                    Don’t stitch areas hidden under other fills (they slightly underlap so no gaps open).
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <Checkbox
                  checked={opts.splitParts}
                  onCheckedChange={(c) => set({ splitParts: !!c })}
                  className="mt-0.5"
                />
                <span>
                  Split separate parts
                  <span className="block text-xs text-muted-foreground">
                    Each separate piece, like each letter of a word, becomes its own shape: fewer jumps with
                    same-colour outlines, and narrow pieces may become satin.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <Checkbox
                  checked={opts.keepEdits}
                  onCheckedChange={(c) => set({ keepEdits: !!c })}
                  className="mt-0.5"
                />
                <span>
                  Keep my edits
                  <span className="block text-xs text-muted-foreground">
                    Leave elements whose settings you changed by hand alone.
                  </span>
                </span>
              </label>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button variant="outline" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={() => void run()} disabled={busy}>
                {busy ? <Loader2 className="animate-spin" /> : <Wand2 />} Auto-digitize
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
