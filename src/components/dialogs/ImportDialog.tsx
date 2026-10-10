// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * SVG import dialog (SPEC FR-1.1a, FR-1.1b, §4 step 2; ARCHITECTURE §8).
 *
 * Reads the file, runs the importer once at natural size for the preview, size and the list of
 * skipped / approximated features, then on Import re-runs it at the target size, commits it as one
 * undo step (`importSvgIntoDesign`) and optionally auto-digitizes the new shapes.
 */
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { AlertTriangle, FileWarning, Info, LoaderCircle, Sparkles } from 'lucide-react';
import type { DialogProps } from '@/components/DialogHost';
import { Badge } from '@/components/ui/badge';
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
import { fitDesign } from '@/canvas/CanvasView';
import { importSvg, SvgImportError, type SvgImportResult } from '@/io/svg-import';
import { getPref, setPref } from '@/library/library';
import { cn, fmt } from '@/lib/utils';
import { autoDigitize } from '@/store/commands/autoDigitize';
import { baseFileName, importSvgIntoDesign } from '@/store/commands/importSvg';
import { useDoc } from '@/store/documentStore';
import { useUi } from '@/store/uiStore';
import { getChart, hasChart, listCharts } from '@/threads/charts';
import { PREF_AUTO_DIGITIZE, PREF_CHART, PREF_COLOR_MODE } from './image/prefs';
import { SizeFields, type SizeValue } from './image/SizeFields';

const DEFAULT_CHART = 'madeira-rayon';

/** Features the importer approximates (the rest of the warning codes are skipped content). */
const APPROXIMATED = new Set(['gradient', 'pattern']);

const TITLES: Record<string, string> = {
  text: 'Text',
  image: 'Embedded images',
  filter: 'Filters',
  mask: 'Masks',
  pattern: 'Pattern fills',
  marker: 'Markers',
  foreignObject: 'Embedded HTML',
  script: 'Scripts',
  animation: 'Animations',
  gradient: 'Gradients',
  clipPath: 'Clip paths',
  use: 'Broken references',
};

type Phase = 'reading' | 'ready' | 'error' | 'importing' | 'digitizing';

function errorMessage(err: unknown): string {
  if (err instanceof SvgImportError) return err.message;
  if (err instanceof Error) return `This file could not be imported: ${err.message}`;
  return 'This file could not be imported.';
}

export default function ImportDialog({ open, onClose, data }: DialogProps) {
  const file: File | null = (data?.file as File | undefined) ?? useUi.getState().pendingFile;
  const design = useDoc((s) => s.design);
  const [phase, setPhase] = useState<Phase>('reading');
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [natural, setNatural] = useState<SvgImportResult | null>(null);
  const [keepSize, setKeepSize] = useState(true);
  const [size, setSize] = useState<SizeValue>({ axis: 'width', value: 100 });
  const [auto, setAuto] = useState(true);
  const [colorMode, setColorMode] = useState<'exact' | 'chart'>('exact');
  const [chartId, setChartId] = useState<string>(DEFAULT_CHART);
  const [replaceArtwork, setReplaceArtwork] = useState(false);
  const touched = useRef(new Set<string>());
  const alive = useRef(true);
  const ids = {
    auto: useId(),
    keep: useId(),
    custom: useId(),
    colors: useId(),
    chart: useId(),
    replace: useId(),
  };
  const charts = useMemo(() => listCharts(), []);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Remembered options.
  useEffect(() => {
    void Promise.all([
      getPref<boolean>(PREF_AUTO_DIGITIZE),
      getPref<string>(PREF_COLOR_MODE),
      getPref<string>(PREF_CHART),
    ]).then(([a, m, c]) => {
      if (!alive.current) return;
      if (typeof a === 'boolean' && !touched.current.has('auto')) setAuto(a);
      if ((m === 'exact' || m === 'chart') && !touched.current.has('mode')) setColorMode(m);
      const docChart = useDoc.getState().design?.threadChart;
      const pick = [c, docChart !== 'exact' ? docChart : undefined, DEFAULT_CHART].find(
        (id) => id && hasChart(id),
      );
      if (pick && !touched.current.has('chart')) setChartId(pick);
      else if (!pick && charts[0] && !touched.current.has('chart')) setChartId(charts[0].id);
    });
  }, [charts]);

  // Read and analyse the file at its natural size (once).
  useEffect(() => {
    if (!file) {
      setPhase('error');
      setError('No file was given to import.');
      return;
    }
    let cancelled = false;
    setPhase('reading');
    file
      .text()
      .then(
        (t) =>
          new Promise<void>((resolve) => {
            // Let the dialog paint its loading state before the (synchronous) importer runs.
            setTimeout(() => {
              if (cancelled) return resolve();
              try {
                const r = importSvg(t, { name: file.name });
                if (cancelled) return resolve();
                setText(t);
                setNatural(r);
                if (r.naturalSize.width > 0 && r.naturalSize.height > 0) {
                  setSize({ axis: 'width', value: Math.round(r.naturalSize.width * 10) / 10 });
                }
                if (!r.shapes.length) {
                  setError(
                    r.warnings.some((w) => w.code === 'text')
                      ? 'This SVG has nothing to stitch: its text must be converted to outlines (paths) first.'
                      : 'This SVG has no visible shapes to import.',
                  );
                  setPhase('error');
                } else setPhase('ready');
              } catch (err) {
                setError(errorMessage(err));
                setPhase('error');
              }
              resolve();
            }, 0);
          }),
      )
      .catch((err) => {
        if (cancelled) return;
        setError(errorMessage(err));
        setPhase('error');
      });
    return () => {
      cancelled = true;
    };
  }, [file]);

  // Live preview of the sanitised artwork (rendered via <img>, which never runs scripts).
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!natural) return;
    const url = URL.createObjectURL(new Blob([natural.artwork.svg], { type: 'image/svg+xml' }));
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [natural]);

  const nat = natural?.naturalSize ?? { width: 0, height: 0 };
  const aspect = nat.width > 0 && nat.height > 0 ? nat.width / nat.height : 1;
  const busy = phase === 'importing' || phase === 'digitizing' || phase === 'reading';
  const colourCount = natural?.threads.length ?? 0;
  const designHasShapes = !!design && design.zOrder.length > 0;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!text || !file || phase !== 'ready' || !design) return;
    setPhase('importing');
    const target = keepSize
      ? {}
      : size.axis === 'width'
        ? { targetWidth: size.value }
        : { targetHeight: size.value };
    const mapToChart = colorMode === 'chart' ? chartId : null;
    void setPref(PREF_AUTO_DIGITIZE, auto);
    void setPref(PREF_COLOR_MODE, colorMode);
    if (colorMode === 'chart') void setPref(PREF_CHART, chartId);
    const toast = useUi.getState().showToast;
    let shapeIds: string[];
    let result: SvgImportResult;
    try {
      if (mapToChart) await getChart(mapToChart);
      await new Promise((r) => setTimeout(r, 0));
      result = importSvg(text, { ...target, name: file.name });
      shapeIds = importSvgIntoDesign(result, {
        mapToChart,
        replaceArtwork: replaceArtwork || undefined,
        name: baseFileName(file.name),
      });
    } catch (err) {
      if (!alive.current) return;
      setError(errorMessage(err));
      setPhase('ready');
      return;
    }
    useUi.getState().set({
      importNotes: [
        ...result.warnings.map((w) => ({
          code: w.code,
          message: w.count > 1 ? `${w.message} (×${w.count})` : w.message,
        })),
        // Very large imports stay usable but slow; suggest simplifying (ARCHITECTURE §21).
        ...(shapeIds.length > 5000
          ? [
              {
                code: 'large',
                message: `${shapeIds.length.toLocaleString()} shapes imported. Consider Path → Simplify or removing tiny details to keep editing fast.`,
              },
            ]
          : []),
      ],
    });
    if (shapeIds.length > 5000)
      useUi.getState().showToast(`Large design: ${shapeIds.length.toLocaleString()} shapes.`);
    let summary = `Imported ${shapeIds.length} ${shapeIds.length === 1 ? 'shape' : 'shapes'} · ${fmt(result.size.width)} × ${fmt(result.size.height)} mm`;
    if (auto && shapeIds.length) {
      if (alive.current) setPhase('digitizing');
      try {
        const s = await autoDigitize({
          shapeIds,
          fabric: useDoc.getState().design?.fabric,
          ...(mapToChart ? { colors: 'chart' as const, chartId: mapToChart } : { colors: 'exact' as const }),
        });
        if (s?.message) summary += ` · ${s.message}`;
      } catch (err) {
        toast(
          `Imported, but auto-digitize failed: ${err instanceof Error ? err.message : String(err)}`,
          'error',
        );
        summary = '';
      }
    }
    if (summary) toast(summary, 'success');
    onClose();
    requestAnimationFrame(() => fitDesign());
  }

  const warnings = natural?.warnings ?? [];

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Import SVG</DialogTitle>
            <DialogDescription className="truncate">
              {file ? file.name : 'No file'}
              {designHasShapes && ' · added to the current design'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-[220px_1fr]">
            {/* Preview */}
            <div
              className="relative flex h-44 items-center sm:aspect-square sm:h-auto justify-center overflow-hidden rounded-md border bg-[length:16px_16px]"
              style={{
                backgroundImage:
                  'linear-gradient(45deg, var(--muted) 25%, transparent 25%), linear-gradient(-45deg, var(--muted) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, var(--muted) 75%), linear-gradient(-45deg, transparent 75%, var(--muted) 75%)',
                backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0',
              }}
            >
              {previewUrl ? (
                <img
                  src={previewUrl}
                  alt={`Preview of ${file?.name ?? 'the SVG'}`}
                  className="max-h-full max-w-full object-contain p-2"
                  draggable={false}
                />
              ) : phase === 'reading' ? (
                <LoaderCircle
                  className="size-5 animate-spin text-muted-foreground"
                  aria-label="Reading file"
                />
              ) : (
                <FileWarning className="size-6 text-muted-foreground" aria-hidden />
              )}
              {natural && (
                <span className="absolute bottom-1.5 left-1.5 rounded bg-background/85 px-1.5 py-0.5 text-[11px] text-muted-foreground tabular-nums shadow-xs">
                  {natural.shapes.length} {natural.shapes.length === 1 ? 'shape' : 'shapes'} · {colourCount}{' '}
                  {colourCount === 1 ? 'colour' : 'colours'}
                </span>
              )}
            </div>

            {/* Options */}
            <div className="grid content-start gap-4">
              <fieldset className="grid gap-2" disabled={!natural || busy}>
                <legend className="mb-1 text-xs font-medium">Size</legend>
                <label htmlFor={ids.keep} className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    id={ids.keep}
                    type="radio"
                    name="svg-size"
                    checked={keepSize}
                    onChange={() => setKeepSize(true)}
                    className="accent-primary"
                  />
                  <span>
                    Keep original size{' '}
                    <span className="text-muted-foreground tabular-nums">
                      ({fmt(nat.width)} × {fmt(nat.height)} mm)
                    </span>
                  </span>
                </label>
                <label htmlFor={ids.custom} className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    id={ids.custom}
                    type="radio"
                    name="svg-size"
                    checked={!keepSize}
                    onChange={() => setKeepSize(false)}
                    className="accent-primary"
                  />
                  Set width or height
                </label>
                <div className={cn('pl-6', keepSize && 'opacity-50')}>
                  <SizeFields
                    value={size}
                    aspect={aspect}
                    disabled={!natural || busy}
                    onChange={(v) => {
                      setKeepSize(false);
                      setSize(v);
                    }}
                  />
                </div>
                <p className="pl-6 text-[11px] text-muted-foreground">
                  The artwork is centred on the canvas origin.
                </p>
              </fieldset>

              <fieldset className="grid gap-2" disabled={!natural || busy}>
                <legend className="mb-1 text-xs font-medium">Thread colours</legend>
                <div className="flex items-center gap-2">
                  <Select
                    value={colorMode}
                    onValueChange={(v) => {
                      touched.current.add('mode');
                      setColorMode(v as 'exact' | 'chart');
                    }}
                  >
                    <SelectTrigger id={ids.colors} className="w-44" aria-label="Thread colours">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="exact">Keep exact colours</SelectItem>
                      <SelectItem value="chart">Map to thread chart</SelectItem>
                    </SelectContent>
                  </Select>
                  {colorMode === 'chart' && (
                    <Select
                      value={chartId}
                      onValueChange={(v) => {
                        touched.current.add('chart');
                        setChartId(v);
                      }}
                    >
                      <SelectTrigger id={ids.chart} className="min-w-0 flex-1" aria-label="Thread chart">
                        <SelectValue placeholder="Choose a chart" />
                      </SelectTrigger>
                      <SelectContent className="max-h-72">
                        {charts.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </fieldset>

              <div className="grid gap-2">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id={ids.auto}
                    checked={auto}
                    disabled={busy}
                    onCheckedChange={(c) => {
                      touched.current.add('auto');
                      setAuto(c === true);
                    }}
                  />
                  <Label htmlFor={ids.auto} className="text-sm font-normal">
                    Auto-digitize after import
                  </Label>
                </div>
                {design?.artwork && (
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id={ids.replace}
                      checked={replaceArtwork}
                      disabled={busy}
                      onCheckedChange={(c) => setReplaceArtwork(c === true)}
                    />
                    <Label htmlFor={ids.replace} className="text-sm font-normal">
                      Use this file as the artwork backdrop
                    </Label>
                  </div>
                )}
              </div>
            </div>
          </div>

          {warnings.length > 0 && (
            <section
              aria-label="Skipped or approximated features"
              className="grid gap-1 rounded-md border bg-muted/40 p-2.5"
            >
              <h3 className="flex items-center gap-1.5 text-xs font-medium">
                <AlertTriangle className="size-3.5 text-warning" aria-hidden />
                Some features were skipped or approximated
              </h3>
              <ul className="grid max-h-36 gap-1 overflow-y-auto">
                {warnings.map((w) => (
                  <li key={w.code} className="flex items-start gap-2 text-xs">
                    <Badge
                      variant={APPROXIMATED.has(w.code) ? 'secondary' : 'warning'}
                      className="mt-px w-[86px] justify-center"
                    >
                      {APPROXIMATED.has(w.code) ? 'Approximated' : 'Skipped'}
                    </Badge>
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{TITLES[w.code] ?? w.code}</span>
                      {w.count > 1 && <span className="text-muted-foreground tabular-nums"> ×{w.count}</span>}
                      <span className="text-muted-foreground"> — {w.message}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {error && (
            <p
              role="alert"
              className="flex gap-2 rounded-md bg-destructive/10 px-2.5 py-2 text-xs text-destructive"
            >
              <Info className="mt-px size-3.5 shrink-0" aria-hidden />
              <span>{error}</span>
            </p>
          )}

          <DialogFooter className="items-center">
            <span className="mr-auto text-xs text-muted-foreground" aria-live="polite">
              {phase === 'reading' && 'Reading file…'}
              {phase === 'importing' && 'Importing…'}
              {phase === 'digitizing' && 'Auto-digitizing…'}
            </span>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={phase === 'importing' || phase === 'digitizing'}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={phase !== 'ready' || !design}>
              {phase === 'importing' || phase === 'digitizing' ? (
                <LoaderCircle className="animate-spin" aria-hidden />
              ) : auto ? (
                <Sparkles aria-hidden />
              ) : null}
              Import
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
