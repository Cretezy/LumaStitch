// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Image import dialog (SPEC FR-10.1–10.7, §3.2, §9.1; ARCHITECTURE §12.1).
 *
 * Original on the left, live traced preview on the right (raster worker, debounced, stale results
 * dropped), controls in a side column: target size, colour count, palette swatches (recolour / don't
 * stitch / merge), background, detail ↔ smooth, line art, auto-digitize. Import traces at full
 * resolution, commits one undo step (`importTracedImage`) and optionally auto-digitizes the shapes.
 *
 * `data.retrace === true` (FR-10.7) re-opens the design's image backdrop with its trace settings and
 * replaces the previously traced shapes (see `tracedShapeIds`).
 */
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { AlertTriangle, ChevronRight, ImageOff, Info, LoaderCircle, Sparkles } from 'lucide-react';
import type { DialogProps } from '@/components/DialogHost';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { fitDesign } from '@/canvas/CanvasView';
import { apply as applyMatrix, translate } from '@/geom/matrix';
import { getPref, setPref } from '@/library/library';
import { cn, fmt } from '@/lib/utils';
import { transformGeomM } from '@/model/geomOps';
import type { PaletteEdit, TraceSettings } from '@/model/types';
import { RASTER_CONFIG } from '@/raster/config';
import type { TracedShapes } from '@/raster/types';
import { autoDigitize } from '@/store/commands/autoDigitize';
import {
  IMAGE_CUTOUT_GROWTH,
  imageBackdropMatrix,
  importTracedImage,
  tracedShapeIds,
} from '@/store/commands/importImage';
import { useDoc } from '@/store/documentStore';
import { useUi } from '@/store/uiStore';
import { dataUrlToBlob, prepareImage, type PreparedImage } from './image/imageFiles';
import { PaletteSwatches } from './image/PaletteSwatches';
import { patchEdit, swatchViews } from './image/paletteEdits';
import { PREF_AUTO_DIGITIZE, PREF_IMAGE_SIZE } from './image/prefs';
import { LabelCanvas, PreviewFrame, TracedSvg } from './image/PreviewPane';
import { SizeFields, sizeToWH, type SizeValue } from './image/SizeFields';
import { useRasterPipeline } from './image/useRasterPipeline';

const DEFAULT_WIDTH_MM = 90;
const { minK, maxK } = RASTER_CONFIG.kmeans;

type Phase = 'edit' | 'tracing' | 'digitizing';

interface Setup {
  source: Blob;
  prepared: PreparedImage;
  /** Re-trace: settings, size and centre of the existing backdrop. */
  trace?: TraceSettings;
  size?: SizeValue;
  centre: [number, number];
  name: string;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Re-trace setup from the open design's image backdrop. */
function retraceSetup(): Setup | string {
  const art = useDoc.getState().design?.artwork;
  if (!art || art.kind !== 'image') return 'This design has no imported image to re-trace.';
  const m = art.matrix;
  const mmPerPx = Math.hypot(m[0], m[1]);
  const centre = applyMatrix(m, [art.pxWidth / 2, art.pxHeight / 2]);
  return {
    source: dataUrlToBlob(art.dataUrl),
    prepared: {
      width: art.pxWidth,
      height: art.pxHeight,
      backdrop: { dataUrl: art.dataUrl, pxWidth: art.pxWidth, pxHeight: art.pxHeight },
    },
    trace: structuredClone(art.trace),
    size: { axis: 'width', value: Math.round(art.pxWidth * mmPerPx * 10) / 10 },
    centre: [centre[0], centre[1]],
    name: useDoc.getState().design?.name ?? 'Image',
  };
}

export default function ImageImportDialog({ open, onClose, data }: DialogProps) {
  const retrace = data?.retrace === true;
  const file: File | null = retrace
    ? null
    : ((data?.file as File | undefined) ?? useUi.getState().pendingFile);
  const hasDesign = useDoc((s) => !!s.design);

  const [setup, setSetup] = useState<Setup | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('edit');

  // Controls.
  const [size, setSize] = useState<SizeValue>({ axis: 'width', value: DEFAULT_WIDTH_MM });
  const [colorsAuto, setColorsAuto] = useState(true);
  const [k, setK] = useState(6);
  const [palette, setPalette] = useState<PaletteEdit[]>([]);
  const [background, setBackground] = useState<string>('auto');
  const [detail, setDetail] = useState(0.5);
  const [smoothness, setSmoothness] = useState(0.5);
  const [lineArt, setLineArt] = useState(false);
  const [auto, setAuto] = useState(true);
  const [view, setView] = useState<'traced' | 'colours'>('traced');
  const [fineTune, setFineTune] = useState(false);
  const touched = useRef(new Set<string>());
  const alive = useRef(true);
  const ids = {
    auto: useId(),
    bg: useId(),
    lineArt: useId(),
    colorsAuto: useId(),
    k: useId(),
    smooth: useId(),
    detail: useId(),
    smooth2: useId(),
  };

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Source image (file or backdrop) and remembered options.
  useEffect(() => {
    let cancelled = false;
    void getPref<boolean>(PREF_AUTO_DIGITIZE).then((a) => {
      if (!cancelled && typeof a === 'boolean' && !touched.current.has('auto')) setAuto(a);
    });
    if (retrace) {
      try {
        const s = retraceSetup();
        if (typeof s === 'string') setSetupError(s);
        else {
          const t = s.trace!;
          setColorsAuto(t.colors === 'auto');
          if (t.colors !== 'auto') setK(t.colors);
          setPalette(t.palette);
          setBackground(t.background);
          setDetail(t.detail);
          setSmoothness(t.smoothness);
          setLineArt(t.lineArt);
          if (s.size) setSize(s.size);
          setSetup(s);
        }
      } catch (err) {
        setSetupError(`The backdrop image could not be read: ${messageOf(err)}`);
      }
      return () => {
        cancelled = true;
      };
    }
    if (!file) {
      setSetupError('No image was given to import.');
      return;
    }
    void getPref<SizeValue>(PREF_IMAGE_SIZE).then((v) => {
      if (cancelled || touched.current.has('size')) return;
      if (v && (v.axis === 'width' || v.axis === 'height') && v.value > 0) setSize(v);
    });
    prepareImage(file)
      .then((prepared) => {
        if (!cancelled) setSetup({ source: file, prepared, centre: [0, 0], name: file.name });
      })
      .catch((err) => {
        if (!cancelled) setSetupError(messageOf(err));
      });
    return () => {
      cancelled = true;
    };
  }, [file, retrace]);

  const trace: TraceSettings = useMemo(
    () => ({ colors: colorsAuto ? 'auto' : k, palette, background, detail, smoothness, lineArt }),
    [colorsAuto, k, palette, background, detail, smoothness, lineArt],
  );
  const target = useMemo(
    () => (size.axis === 'width' ? { width: size.value } : { height: size.value }),
    [size],
  );
  const pipe = useRasterPipeline({ source: setup?.source ?? null, target, trace });

  // Original image for the left pane.
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!setup) return;
    if (retrace) {
      setOriginalUrl(setup.prepared.backdrop.dataUrl);
      return;
    }
    const u = URL.createObjectURL(setup.source);
    setOriginalUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [setup, retrace]);

  const aspect = setup ? setup.prepared.width / setup.prepared.height : 1;
  const wh = sizeToWH(size, aspect);
  const quant = pipe.quant;
  const bgIndex = quant?.backgroundIndex ?? null;
  const swatches = useMemo(
    () => (quant ? swatchViews(quant.palette, palette, bgIndex) : null),
    [quant, palette, bgIndex],
  );
  const traced = pipe.traced;
  const stitchedColours = swatches ? swatches.views.filter((v) => !v.merged && v.stitched).length : 0;
  const working = phase !== 'edit';
  const previewBusy =
    !!setup && (pipe.phase === 'loading' || pipe.phase === 'quantizing' || pipe.phase === 'tracing');
  const photo = !!traced?.warnings.some((w) => /photo/i.test(w));
  const otherWarnings = traced?.warnings.filter((w) => !/photo/i.test(w)) ?? [];
  const replaceCount = useMemo(() => {
    const d = useDoc.getState().design;
    return retrace && d ? tracedShapeIds(d).length : 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retrace, setup]);

  // Detail ↔ smooth: one slider (FR-10.4) moving both settings; "Fine-tune" exposes them separately.
  const balance = Math.round(((smoothness + (1 - detail)) / 2) * 100) / 100;

  function changeColours(nextAuto: boolean, nextK: number) {
    setColorsAuto(nextAuto);
    setK(nextK);
    setPalette([]); // palette indices refer to the previous palette
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!setup || working || !hasDesign) return;
    setImportError(null);
    setPhase('tracing');
    const settings = trace;
    let full: TracedShapes;
    try {
      full = await pipe.traceFull(settings);
    } catch (err) {
      if (!alive.current) return;
      setImportError(`Tracing failed: ${messageOf(err)}`);
      setPhase('edit');
      return;
    }
    if (!alive.current) return;
    if (!full.shapes.length) {
      setImportError('Nothing to stitch: every colour is marked as background or not stitched.');
      setPhase('edit');
      return;
    }
    const [cx, cy] = setup.centre;
    const shapes =
      cx || cy
        ? full.shapes.map((s) => ({ ...s, geom: transformGeomM(s.geom, translate(cx, cy)) }))
        : full.shapes;
    const { backdrop } = setup.prepared;
    const design = useDoc.getState().design;
    const shapeIds = importTracedImage(
      { ...full, shapes },
      {
        ...backdrop,
        matrix: imageBackdropMatrix(
          backdrop.pxWidth,
          backdrop.pxHeight,
          full.widthMm,
          full.heightMm,
          setup.centre,
        ),
        trace: settings,
      },
      {
        replaceShapeIds: retrace && design ? tracedShapeIds(design) : undefined,
        name: retrace ? undefined : setup.name,
      },
    );
    void setPref(PREF_AUTO_DIGITIZE, auto);
    if (!retrace) void setPref(PREF_IMAGE_SIZE, size);

    const toast = useUi.getState().showToast;
    const nColours = new Set(shapes.map((s) => s.color.toLowerCase())).size;
    let summary = `${retrace ? 'Re-traced' : 'Traced'} ${shapeIds.length} ${shapeIds.length === 1 ? 'shape' : 'shapes'} in ${nColours} ${nColours === 1 ? 'colour' : 'colours'} · ${fmt(full.widthMm)} × ${fmt(full.heightMm)} mm`;
    if (auto && shapeIds.length) {
      if (alive.current) setPhase('digitizing');
      try {
        const s = await autoDigitize({
          shapeIds,
          removeOverlaps: false,
          cutoutGrowth: IMAGE_CUTOUT_GROWTH,
          fabric: useDoc.getState().design?.fabric,
        });
        if (s?.message) summary += ` · ${s.message}`;
      } catch (err) {
        toast(`Imported, but auto-digitize failed: ${messageOf(err)}`, 'error');
        summary = '';
      }
    }
    if (summary) toast(summary, 'success');
    onClose();
    requestAnimationFrame(() => fitDesign());
  }

  const title = retrace ? 'Re-trace image' : 'Import image';
  const fileLabel = retrace ? 'Artwork backdrop' : (file?.name ?? 'No file');

  return (
    <Dialog open={open} onOpenChange={(o) => !o && phase !== 'digitizing' && onClose()}>
      <DialogContent className="w-[min(1100px,calc(100%-2rem))] gap-3 sm:max-w-[1100px]">
        <form onSubmit={submit} className="grid gap-3">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription className="truncate">
              {fileLabel}
              {setup && (
                <span className="tabular-nums">
                  {' '}
                  · {setup.prepared.width} × {setup.prepared.height} px
                </span>
              )}
              {retrace &&
                replaceCount > 0 &&
                ` · replaces ${replaceCount} traced ${replaceCount === 1 ? 'shape' : 'shapes'} (one undo step)`}
            </DialogDescription>
          </DialogHeader>

          {setupError ? (
            <div
              role="alert"
              className="flex min-h-48 flex-col items-center justify-center gap-2 rounded-md border border-dashed text-sm text-muted-foreground"
            >
              <ImageOff className="size-6" aria-hidden />
              {setupError}
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
              {/* Previews */}
              <div className="grid min-w-0 content-start gap-2">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="grid min-w-0 gap-1.5">
                    <div className="flex h-7 items-center text-xs font-medium">Original</div>
                    <PreviewFrame aspect={aspect} label="Original image" busy={!setup}>
                      {originalUrl && (
                        <img
                          src={originalUrl}
                          alt=""
                          className="absolute inset-0 size-full object-contain"
                          draggable={false}
                        />
                      )}
                    </PreviewFrame>
                  </div>
                  <div className="grid min-w-0 gap-1.5">
                    <div className="flex h-7 items-center justify-between gap-2">
                      <span className="text-xs font-medium">Traced preview</span>
                      <ToggleGroup
                        type="single"
                        value={view}
                        onValueChange={(v) => v && setView(v as 'traced' | 'colours')}
                        aria-label="Preview mode"
                        className="h-7 p-0"
                      >
                        <ToggleGroupItem value="traced" className="h-6 px-2 text-[11px]">
                          Shapes
                        </ToggleGroupItem>
                        <ToggleGroupItem value="colours" className="h-6 px-2 text-[11px]">
                          Colours
                        </ToggleGroupItem>
                      </ToggleGroup>
                    </div>
                    <PreviewFrame
                      aspect={aspect}
                      label="Traced preview"
                      busy={previewBusy || phase === 'tracing'}
                    >
                      {quant && swatches && (view === 'colours' || !traced) && (
                        <LabelCanvas quant={quant} resolved={swatches.resolved} />
                      )}
                      {traced && view === 'traced' && <TracedSvg traced={traced} />}
                      {!quant && !traced && setup && pipe.phase !== 'error' && (
                        <span className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
                          <LoaderCircle className="mr-1.5 size-3.5 animate-spin" aria-hidden />
                          {pipe.phase === 'loading' ? 'Loading image…' : 'Finding colours…'}
                        </span>
                      )}
                    </PreviewFrame>
                  </div>
                </div>

                <div
                  className="flex min-h-5 flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground tabular-nums"
                  aria-live="polite"
                >
                  <span>
                    {fmt(wh.width)} × {fmt(wh.height)} mm
                  </span>
                  {traced && (
                    <span>
                      {traced.shapes.length} {traced.shapes.length === 1 ? 'shape' : 'shapes'} ·{' '}
                      {stitchedColours} {stitchedColours === 1 ? 'colour' : 'colours'} stitched
                    </span>
                  )}
                  {pipe.info && pipe.info.mmPerPx > 0 && <span>{fmt(pipe.info.mmPerPx, 2)} mm/px</span>}
                </div>

                <div
                  className={cn(
                    'flex gap-2 rounded-md px-2.5 py-2 text-xs',
                    photo ? 'bg-warning/15 text-foreground' : 'bg-muted text-muted-foreground',
                  )}
                >
                  {photo ? (
                    <AlertTriangle className="mt-px size-3.5 shrink-0 text-warning" aria-hidden />
                  ) : (
                    <Info className="mt-px size-3.5 shrink-0" aria-hidden />
                  )}
                  <span>
                    {photo
                      ? 'This looks like a photo. Photos are posterised into flat colour regions; flat-colour artwork (logos, clip art, icons) works best.'
                      : 'Works best with flat-colour artwork such as logos, clip art and icons. Photos are posterised into flat colour regions.'}
                  </span>
                </div>
                {otherWarnings.length > 0 && (
                  <ul className="grid gap-0.5 text-[11px] text-muted-foreground">
                    {otherWarnings.map((w) => (
                      <li key={w} className="flex gap-1.5">
                        <AlertTriangle className="mt-px size-3 shrink-0 text-warning" aria-hidden />
                        {w}
                      </li>
                    ))}
                  </ul>
                )}
                {(pipe.error || importError) && (
                  <p
                    role="alert"
                    className="flex gap-2 rounded-md bg-destructive/10 px-2.5 py-2 text-xs text-destructive"
                  >
                    <Info className="mt-px size-3.5 shrink-0" aria-hidden />
                    {importError ?? pipe.error}
                  </p>
                )}
              </div>

              {/* Controls */}
              <div className="grid min-w-0 content-start gap-4 lg:max-h-[min(560px,calc(100vh-14rem))] lg:overflow-y-auto lg:pr-1">
                <fieldset className="grid gap-1.5" disabled={!setup || working}>
                  <legend className="mb-1 text-xs font-medium">Size</legend>
                  <SizeFields
                    value={size}
                    aspect={aspect}
                    disabled={!setup || working}
                    onChange={(v) => {
                      touched.current.add('size');
                      setSize(v);
                    }}
                  />
                </fieldset>

                <fieldset className="grid gap-2" disabled={!setup || working}>
                  <legend className="mb-1 flex w-full items-center justify-between text-xs font-medium">
                    Colours
                  </legend>
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor={ids.colorsAuto} className="text-sm font-normal">
                      Automatic
                      {quant ? (
                        <span className="text-muted-foreground tabular-nums">
                          {' '}
                          (suggests {quant.suggestedK})
                        </span>
                      ) : null}
                    </Label>
                    <Switch
                      id={ids.colorsAuto}
                      checked={colorsAuto}
                      onCheckedChange={(c) => changeColours(c, c ? k : (quant?.suggestedK ?? k))}
                    />
                  </div>
                  <div className={cn('flex items-center gap-3', colorsAuto && 'opacity-50')}>
                    <Slider
                      id={ids.k}
                      aria-label="Number of colours"
                      min={minK}
                      max={maxK}
                      step={1}
                      disabled={colorsAuto}
                      value={[colorsAuto ? (quant?.suggestedK ?? k) : k]}
                      onValueChange={([v]) => changeColours(false, v)}
                    />
                    <span className="w-5 text-right text-sm tabular-nums">
                      {colorsAuto ? (quant?.suggestedK ?? '–') : k}
                    </span>
                  </div>
                  {swatches && quant ? (
                    <PaletteSwatches
                      views={swatches.views}
                      resolved={swatches.resolved}
                      edits={palette}
                      backgroundIndex={bgIndex}
                      onChange={setPalette}
                      disabled={!setup || working}
                    />
                  ) : (
                    <div className="h-16 animate-pulse rounded-md bg-muted" aria-hidden />
                  )}
                </fieldset>

                <div className="flex items-start justify-between gap-3">
                  <Label htmlFor={ids.bg} className="grid gap-0.5 text-sm font-normal">
                    Leave background unstitched
                    <span className="text-[11px] text-muted-foreground">
                      Detected from the image border or transparency.
                    </span>
                  </Label>
                  <Switch
                    id={ids.bg}
                    disabled={!setup || working}
                    checked={background !== 'none'}
                    onCheckedChange={(c) => {
                      setBackground(c ? 'auto' : 'none');
                      // Per-colour overrides of the old background no longer apply.
                      if (bgIndex != null) setPalette((p) => patchEdit(p, bgIndex, { skip: null }));
                    }}
                  />
                </div>

                <fieldset className="grid gap-2" disabled={!setup || working}>
                  <legend className="mb-1 text-xs font-medium">Detail</legend>
                  <div className="grid gap-1">
                    <Slider
                      id={ids.smooth}
                      aria-label="Detail to smooth"
                      min={0}
                      max={1}
                      step={0.05}
                      value={[balance]}
                      onValueChange={([t]) => {
                        setDetail(Math.round((1 - t) * 100) / 100);
                        setSmoothness(Math.round(t * 100) / 100);
                      }}
                    />
                    <div className="flex justify-between text-[11px] text-muted-foreground">
                      <span>More detail</span>
                      <span>Smoother</span>
                    </div>
                  </div>
                  <Collapsible open={fineTune} onOpenChange={setFineTune}>
                    <CollapsibleTrigger className="flex items-center gap-1 rounded-sm text-[11px] text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none">
                      <ChevronRight
                        className={cn('size-3 transition-transform', fineTune && 'rotate-90')}
                        aria-hidden
                      />
                      Fine-tune
                    </CollapsibleTrigger>
                    <CollapsibleContent className="grid gap-2 pt-2">
                      <div className="grid grid-cols-[72px_1fr_32px] items-center gap-2">
                        <Label htmlFor={ids.detail} className="font-normal">
                          Detail
                        </Label>
                        <Slider
                          id={ids.detail}
                          aria-label="Detail"
                          min={0}
                          max={1}
                          step={0.05}
                          value={[detail]}
                          onValueChange={([v]) => setDetail(v)}
                        />
                        <span className="text-right text-[11px] tabular-nums">
                          {Math.round(detail * 100)}
                        </span>
                      </div>
                      <div className="grid grid-cols-[72px_1fr_32px] items-center gap-2">
                        <Label htmlFor={ids.smooth2} className="font-normal">
                          Smoothness
                        </Label>
                        <Slider
                          id={ids.smooth2}
                          aria-label="Smoothness"
                          min={0}
                          max={1}
                          step={0.05}
                          value={[smoothness]}
                          onValueChange={([v]) => setSmoothness(v)}
                        />
                        <span className="text-right text-[11px] tabular-nums">
                          {Math.round(smoothness * 100)}
                        </span>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                </fieldset>

                <div className="flex items-start justify-between gap-3">
                  <Label htmlFor={ids.lineArt} className="grid gap-0.5 text-sm font-normal">
                    Line art
                    <span className="text-[11px] text-muted-foreground">
                      Thin dark lines become running or satin outlines.
                    </span>
                  </Label>
                  <Switch
                    id={ids.lineArt}
                    disabled={!setup || working}
                    checked={lineArt}
                    onCheckedChange={setLineArt}
                  />
                </div>

                <div className="flex items-center gap-2 border-t pt-3">
                  <Checkbox
                    id={ids.auto}
                    checked={auto}
                    disabled={working}
                    onCheckedChange={(c) => {
                      touched.current.add('auto');
                      setAuto(c === true);
                    }}
                  />
                  <Label htmlFor={ids.auto} className="text-sm font-normal">
                    Auto-digitize after import
                  </Label>
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="items-center">
            <span className="mr-auto text-xs text-muted-foreground" aria-live="polite">
              {phase === 'tracing' && 'Tracing at full resolution…'}
              {phase === 'digitizing' && 'Auto-digitizing…'}
            </span>
            <Button type="button" variant="outline" onClick={onClose} disabled={phase === 'digitizing'}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                !setup || !!setupError || working || !hasDesign || (!!traced && traced.shapes.length === 0)
              }
            >
              {working ? (
                <LoaderCircle className="animate-spin" aria-hidden />
              ) : auto ? (
                <Sparkles aria-hidden />
              ) : null}
              {retrace ? 'Re-trace' : 'Import'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
