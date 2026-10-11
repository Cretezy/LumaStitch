// SPDX-License-Identifier: GPL-3.0-or-later
import { useState } from 'react';
import * as Comlink from 'comlink';
import type { DialogProps } from '../DialogHost';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FONT_CATALOG } from '@/lettering/fontCatalog';
import { withFontWorker } from '@/lettering/client';
import { DEFAULT_LETTERING, validateLettering } from '@/lettering/layout';
import type { LetteringOptions } from '@/model/types';
import { useDoc } from '@/store/documentStore';
import { setLettering } from '@/store/commands/lettering';
import { downloadBlob } from '@/io/project/files';
import { fitSelection } from '@/canvas/CanvasView';

export default function LetteringDialog({ open, onClose, data }: DialogProps) {
  const groupId = data?.groupId as string | undefined;
  const baselineSourceId = data?.baselineShapeId as string | undefined;
  const sourceBaseline = useDoc.getState().design?.shapes[baselineSourceId ?? ''];
  const group = useDoc.getState().design?.lettering?.[groupId ?? ''];
  const [options, setOptions] = useState<LetteringOptions>(
    group?.options ??
      (sourceBaseline
        ? { ...DEFAULT_LETTERING, baseline: structuredClone(sourceBaseline.geom) }
        : DEFAULT_LETTERING),
  );
  const first = useDoc.getState().design?.shapes[group?.shapeIds[0] ?? ''];
  const threadId = (first?.fill ?? first?.outline)?.threadId;
  const [color, setColor] = useState(
    threadId ? (useDoc.getState().design?.threads[threadId]?.color ?? '#234a73') : '#234a73',
  );
  const [batch, setBatch] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const patch = (p: Partial<LetteringOptions>) => setOptions((o) => ({ ...o, ...p }));
  async function loadFont(bytes: Uint8Array, name: string, license?: string) {
    setBusy(true);
    setError('');
    try {
      const font = await withFontWorker((api) => api.inspectFont(bytes, name));
      patch({
        font: 'opentype',
        height: Math.max(20, options.height),
        monogram: false,
        letterSpacing: 0,
        openType: {
          ...font,
          name: license ? name : font.name,
          ...(license ? { license } : {}),
          direction: 'auto',
          language: '',
          variations: {},
          stitch: 'tatami',
        },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function chooseFont(value: string) {
    if (value === 'geneva-simple') {
      patch({
        font: 'geneva-simple',
        height: Math.max(10, Math.min(20, options.height)),
        openType: undefined,
      });
      return;
    }
    const font = FONT_CATALOG.find((f) => f.name === value);
    if (!font) return;
    setBusy(true);
    try {
      const response = await fetch(font.url);
      if (!response.ok) throw new Error('Unable to load the bundled font.');
      await loadFont(new Uint8Array(await response.arrayBuffer()), font.name, font.license);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function apply() {
    setBusy(true);
    setError('');
    try {
      validateLettering(options);
      const prepared =
        options.font === 'opentype' ? await withFontWorker((api) => api.prepareOpenType(options)) : options;
      setLettering(prepared, color, groupId, baselineSourceId);
      onClose();
      requestAnimationFrame(fitSelection);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function exportBatch() {
    setBusy(true);
    setError('');
    const worker = new Worker(new URL('../../worker/lettering.worker.ts', import.meta.url), {
      type: 'module',
    });
    try {
      const api = Comlink.wrap<{ letteringArchive: typeof import('@/lettering/archive').letteringArchive }>(
        worker,
      );
      const bytes = await api.letteringArchive(
        batch
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean),
        options,
        color,
      );
      downloadBlob(new Blob([new Uint8Array(bytes)], { type: 'application/zip' }), 'lettering-batch.zip');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      worker.terminate();
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{group ? 'Edit lettering' : 'Add lettering'}</DialogTitle>
          <DialogDescription>
            Choose digitized satin or shape a TTF/OTF font into editable fill outlines. Fonts stay in this
            browser and are embedded in saved projects.
          </DialogDescription>
        </DialogHeader>
        <fieldset disabled={busy} className="grid gap-3">
          <Label htmlFor="lettering-font">Font</Label>
          <select
            id="lettering-font"
            disabled={busy}
            className="rounded-md border bg-background p-2 text-sm"
            value={options.font === 'geneva-simple' ? 'geneva-simple' : (options.openType?.name ?? '')}
            onChange={(e) => void chooseFont(e.target.value)}
          >
            <option value="geneva-simple">Geneva Simple Sans — digitized satin</option>
            {FONT_CATALOG.map((f) => (
              <option key={f.name} value={f.name}>
                {f.name} — outline fill
              </option>
            ))}
            {options.openType && !FONT_CATALOG.some((f) => f.name === options.openType!.name) && (
              <option value={options.openType.name}>{options.openType.name} — imported</option>
            )}
          </select>
          <Label htmlFor="lettering-font-import">Import TTF/OTF (up to 10 MB)</Label>
          <Input
            id="lettering-font-import"
            type="file"
            accept=".ttf,.otf"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) {
                if (file.size > 10_000_000) setError('Fonts must be at most 10 MB.');
                else void file.arrayBuffer().then((b) => loadFont(new Uint8Array(b), file.name));
              }
            }}
          />
          {options.font === 'opentype' && options.openType && (
            <fieldset className="grid grid-cols-2 gap-2 rounded border p-3">
              <legend className="px-1 text-sm">OpenType shaping and fill</legend>
              <Label htmlFor="font-direction">Direction</Label>
              <select
                id="font-direction"
                value={options.openType.direction}
                onChange={(e) =>
                  patch({
                    openType: { ...options.openType!, direction: e.target.value as 'auto' | 'ltr' | 'rtl' },
                  })
                }
              >
                <option value="auto">Automatic</option>
                <option value="ltr">Left to right</option>
                <option value="rtl">Right to left</option>
              </select>
              <Label htmlFor="font-language">Language tag (optional)</Label>
              <Input
                id="font-language"
                maxLength={50}
                placeholder="en, ar, tr…"
                value={options.openType.language}
                onChange={(e) => patch({ openType: { ...options.openType!, language: e.target.value } })}
              />
              <Label htmlFor="font-stitch">Stitch type</Label>
              <select
                id="font-stitch"
                value={options.openType.stitch}
                onChange={(e) =>
                  patch({
                    openType: { ...options.openType!, stitch: e.target.value as 'tatami' | 'satinFill' },
                  })
                }
              >
                <option value="tatami">Tatami fill</option>
                <option value="satinFill">Automatic satin fill</option>
              </select>
              {options.openType.axes?.map((axis) => (
                <div key={axis.tag} className="col-span-2 grid grid-cols-2 gap-2">
                  <Label htmlFor={`font-axis-${axis.tag}`}>
                    {axis.tag === 'wght' ? 'Weight' : axis.tag === 'wdth' ? 'Width' : axis.tag}
                  </Label>
                  <Input
                    id={`font-axis-${axis.tag}`}
                    type="number"
                    min={axis.min}
                    max={axis.max}
                    value={options.openType!.variations[axis.tag] ?? axis.default}
                    onChange={(e) =>
                      patch({
                        openType: {
                          ...options.openType!,
                          variations: { ...options.openType!.variations, [axis.tag]: e.target.valueAsNumber },
                        },
                      })
                    }
                  />
                </div>
              ))}
              <p className="col-span-2 text-xs text-muted-foreground">
                Kerning, ligatures and script joins use the font's shaping rules. Use separate blocks for
                right-to-left text and Latin text/numbers. Outline fonts need suitable size, weight and stitch
                settings; they are not pre-digitized embroidery fonts.
              </p>
            </fieldset>
          )}
          <Label htmlFor="lettering-text">Text</Label>
          <textarea
            id="lettering-text"
            className="min-h-20 rounded-md border bg-background p-2 text-sm"
            value={options.text}
            maxLength={1000}
            onChange={(e) => patch({ text: e.target.value })}
          />
          <div className="grid grid-cols-2 gap-3">
            {(
              [
                [
                  'height',
                  options.font === 'opentype' ? 'Font size (mm per em)' : 'Capital height (mm)',
                  options.font === 'opentype' ? 5 : 10,
                  options.font === 'opentype' ? 100 : 20,
                  0.5,
                ],
                ['letterSpacing', 'Extra letter spacing (mm)', -5, 20, 0.1],
                ['wordSpacing', 'Extra word spacing (mm)', 0, 30, 0.1],
                ['lineSpacing', 'Line spacing multiplier', 1, 4, 0.1],
                ['arcAngle', 'Arc angle (°)', -300, 300, 5],
              ] as const
            ).map(([key, label, min, max, step]) => (
              <div key={key} className="grid gap-1">
                <Label htmlFor={`text-${key}`}>{label}</Label>
                <Input
                  id={`text-${key}`}
                  type="number"
                  min={min}
                  max={max}
                  step={step}
                  value={options[key]}
                  disabled={Boolean(options.baseline) && (key === 'arcAngle' || key === 'lineSpacing')}
                  onChange={(e) => patch({ [key]: e.target.valueAsNumber })}
                />
              </div>
            ))}
            <div className="grid gap-1">
              <Label htmlFor="text-color">Thread color</Label>
              <Input id="text-color" type="color" value={color} onChange={(e) => setColor(e.target.value)} />
            </div>
          </div>
          {options.baseline && (
            <fieldset className="grid gap-2 rounded border p-3">
              <legend className="px-1 text-sm">Path baseline</legend>
              <Label htmlFor="baseline-offset">Offset from baseline (mm)</Label>
              <Input
                id="baseline-offset"
                type="number"
                min={-100}
                max={100}
                step={0.5}
                value={options.baselineOffset ?? 0}
                onChange={(e) => patch({ baselineOffset: e.target.valueAsNumber })}
              />
              <label className="flex gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={options.baselineReverse ?? false}
                  onChange={(e) => patch({ baselineReverse: e.target.checked })}
                />
                Reverse baseline direction
              </label>
              <p className="text-xs text-muted-foreground">
                Digitized letters follow the path tangent. OpenType outlines bend continuously along the path
                to retain script joins. Use Object → Edit lettering baseline to move its nodes. Baseline edits
                clear custom stitch entry/exit and direction hints. Alignment positions text along the
                available path; text must fit without shrinking below the font's supported size.
              </p>
            </fieldset>
          )}
          <Label htmlFor="text-align">Alignment</Label>
          <select
            id="text-align"
            className="rounded-md border bg-background p-2 text-sm"
            value={options.align}
            onChange={(e) => patch({ align: e.target.value as LetteringOptions['align'] })}
          >
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
          </select>
          <label className="flex gap-2 text-sm">
            <input
              type="checkbox"
              disabled={options.font === 'opentype'}
              checked={options.monogram}
              onChange={(e) =>
                patch({
                  monogram: e.target.checked,
                  height: e.target.checked ? Math.max(14, options.height) : options.height,
                })
              }
            />
            Three-letter monogram (larger middle initial)
          </label>
          <p className="text-xs text-muted-foreground">
            Select any letter and choose Object → Edit lettering to edit the block. Moving the complete block
            keeps text editable. Editing individual paths detaches it.
          </p>
          <details>
            <summary className="cursor-pointer text-sm">Batch names</summary>
            <div className="mt-2 grid gap-2">
              <Label htmlFor="batch-names">One name per line (up to 100)</Label>
              <textarea
                id="batch-names"
                className="min-h-20 rounded-md border bg-background p-2 text-sm"
                value={batch}
                onChange={(e) => setBatch(e.target.value)}
              />
              <Button variant="outline" disabled={busy || !batch.trim()} onClick={() => void exportBatch()}>
                {busy ? 'Generating…' : 'Download batch projects + PES'}
              </Button>
            </div>
          </details>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </fieldset>
        {busy && (
          <p role="status" className="text-sm text-muted-foreground">
            Processing lettering…
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void apply()} disabled={busy}>
            {group ? 'Update lettering' : 'Add lettering'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
