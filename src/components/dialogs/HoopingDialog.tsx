// SPDX-License-Identifier: GPL-3.0-or-later
import { useEffect, useMemo, useRef, useState } from 'react';
import * as Comlink from 'comlink';
import type { DialogProps } from '../DialogHost';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { NumberField } from '@/components/inspector/NumberField';
import { useDoc, exec } from '@/store/documentStore';
import type { MultiHoopOptions } from '@/model/types';
import type { optimizeHoopLayout } from '@/hooping/optimize';
import type { hoopingArchive } from '@/hooping/archive';
import { saveFile } from '@/io/project/files';
import { placementPreview } from '@/hooping/preview';
import type { Placement } from '@/hooping/placement';

type Package = ReturnType<typeof hoopingArchive>;
export default function HoopingDialog({ open, onClose }: DialogProps) {
  const design = useDoc((s) => s.design);
  const [options, setOptions] = useState<MultiHoopOptions>(
    () =>
      design?.multiHoop ?? {
        width: design?.hoop?.width ?? 100,
        height: design?.hoop?.height ?? 100,
        margin: Math.max(1, design?.hoop?.margin ?? 3),
        overlap: 12,
      },
  );
  const [format, setFormat] = useState('pes'),
    [result, setResult] = useState<Package | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const preview = useMemo(
    () => (design && options.placements ? placementPreview(design, options) : null),
    [design, options],
  );
  const worker = useRef<Worker | null>(null);
  useEffect(() => () => worker.current?.terminate(), []);
  const change = (key: keyof MultiHoopOptions, value: number) => {
    setOptions((v) => ({ ...v, [key]: value }));
    setResult(null);
  };
  function placements(value: Placement[] | undefined) {
    setOptions((o) => ({ ...o, placements: value }));
    setResult(null);
    setError('');
  }
  function editPlacement(index: number, key: 'x' | 'y' | 'angle', value: number) {
    placements(
      options.placements!.map((p, i) =>
        i !== index
          ? p
          : key === 'angle'
            ? { ...p, angle: value }
            : { ...p, center: key === 'x' ? [value, p.center[1]] : [p.center[0], value] },
      ),
    );
  }
  async function calculate(optimize = false) {
    if (!design) return;
    setBusy(true);
    setError('');
    setResult(null);
    worker.current?.terminate();
    const w = new Worker(new URL('../../worker/hooping.worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    try {
      const api = Comlink.wrap<{
        hoopingArchive: typeof hoopingArchive;
        optimizeHoopLayout: typeof optimizeHoopLayout;
      }>(w);
      const settings = optimize ? await api.optimizeHoopLayout(structuredClone(design), options) : options;
      const next = await api.hoopingArchive(structuredClone(design), settings, format);
      if (worker.current !== w) return;
      setResult(next);
      setOptions(settings);
      exec('Set multi-hooping layout', (d) => {
        d.multiHoop = settings;
      });
    } catch (e) {
      setError(String(e));
    } finally {
      w.terminate();
      if (worker.current === w) {
        worker.current = null;
        setBusy(false);
      }
    }
  }
  async function download() {
    if (!result) return;
    try {
      await saveFile(
        new Blob([new Uint8Array(result.archive)], { type: 'application/zip' }),
        'multi-hooping.zip',
        { description: 'Multi-hooping package', accept: { 'application/zip': ['.zip'] } },
      );
    } catch (e) {
      setError(String(e));
    }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Multi-hooping export</DialogTitle>
          <DialogDescription>
            Split the stitch plan into overlapping rectangular fields with shared registration marks.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(
            [
              ['width', 'Field width', 30, 1000],
              ['height', 'Field height', 30, 1000],
              ['margin', 'Field margin', 1, 20],
              ['overlap', 'Field overlap', 6, 100],
            ] as const
          ).map(([key, label, min, max]) => (
            <label className="grid gap-1 text-xs" key={key}>
              {label}
              <NumberField
                value={options[key]}
                min={min}
                max={max}
                step={1}
                digits={1}
                unit="mm"
                disabled={busy || (key === 'overlap' && !!options.placements)}
                ariaLabel={label}
                onCommit={(v) => change(key, v)}
              />
            </label>
          ))}
        </div>
        {options.placements ? (
          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">Custom hoop placements</span>
              <Button variant="outline" size="sm" disabled={busy} onClick={() => placements(undefined)}>
                Use automatic grid
              </Button>
            </div>
            {preview && !result && (
              <img
                alt="Editable hoop placements over design artwork"
                className="max-h-64 w-full rounded border bg-white object-contain"
                src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(preview)}`}
              />
            )}
            <p className="text-xs text-muted-foreground">
              Centers use design coordinates; angles rotate clockwise. Dashed frames must cover all stitches.
              Arrowheads mark the top of each field. Calculate to check coverage and registration; sewing
              order follows connected overlaps.
            </p>
            <div className="max-h-44 overflow-y-auto rounded border p-2">
              <div className="grid grid-cols-[2rem_1fr_1fr_1fr_auto] items-center gap-2 text-xs">
                <span>Field</span>
                <span>Center X</span>
                <span>Center Y</span>
                <span>Angle</span>
                <span />
                {options.placements.map((p, i) => (
                  <PlacementRow
                    key={i}
                    index={i}
                    placement={p}
                    disabled={busy}
                    canRemove={options.placements!.length > 1}
                    edit={editPlacement}
                    remove={() => placements(options.placements!.filter((_, j) => i !== j))}
                  />
                ))}
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={busy || options.placements.length >= 64}
              onClick={() => {
                const last = options.placements!.at(-1)!;
                placements([
                  ...options.placements!,
                  { ...last, center: [last.center[0] + 20, last.center[1]] },
                ]);
              }}
            >
              Add hoop placement
            </Button>
          </div>
        ) : (
          result && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                placements(
                  result.manifest.hoopings.map((p) => ({ center: p.centerMm, angle: p.clockwiseDegrees })),
                )
              }
            >
              Edit calculated placements
            </Button>
          )
        )}
        <label className="grid gap-1 text-xs">
          Machine format
          <select
            aria-label="Hooping machine format"
            className="rounded border bg-background p-2"
            disabled={busy}
            value={format}
            onChange={(e) => {
              setFormat(e.target.value);
              setResult(null);
            }}
          >
            {['pes', 'dst', 'jef', 'exp', 'vp3'].map((id) => (
              <option key={id} value={id}>
                {id.toUpperCase()}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs">
          <Switch
            aria-label="Join nearby seam endpoints"
            disabled={busy}
            checked={options.joinSeams !== false}
            onCheckedChange={(value) => {
              setOptions((o) => ({ ...o, joinSeams: value }));
              setResult(null);
            }}
          />
          Join nearby seam endpoints (up to 1 mm along the same seam)
        </label>
        <label className="flex items-center gap-2 text-xs">
          <Switch
            aria-label="Keep whole objects when they fit"
            disabled={busy}
            checked={options.keepObjects ?? false}
            onCheckedChange={(value) => {
              setOptions((o) => ({ ...o, keepObjects: value }));
              setResult(null);
            }}
          />
          Keep whole objects when they fit (touching layers move together if their group fits)
        </label>
        <p className="text-xs text-muted-foreground">
          Each file begins with temporary basting and shared crosses, then stops before the design. Keep the
          basting frame to preserve file centering. The package includes the original project, editable stitch
          projects, a placement SVG and a manifest. Seam locks and extra penetrations are added; rehooping
          accuracy still needs a physical sample.
        </p>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {result && (
          <div className="grid gap-2">
            <p className="text-sm">
              {result.manifest.hoopings.length} hoopings · {result.manifest.sourceStitches.toLocaleString()}{' '}
              source penetrations retained
              {options.keepObjects &&
                ` · ${result.manifest.hoopings.reduce((n, p) => n + p.wholeObjects.length, 0)} objects kept whole`}
            </p>
            <img
              alt="Numbered hooping layout with shared registration marks"
              className="max-h-80 w-full rounded border bg-white object-contain"
              src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(result.layout)}`}
            />
            {options.placements && (
              <p className="text-xs text-muted-foreground">
                {result.manifest.hoopings
                  .map(
                    (p) =>
                      `Hoop ${p.number}: placement ${p.placement}, ${p.clockwiseDegrees}°${p.registrationParent ? `, align with hoop ${p.registrationParent}` : ', start here'}`,
                  )
                  .join(' · ')}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Sew in numbered order. Red cross pairs are shared between neighboring fields. Empty fields are
              retained for registration continuity. Rectangular fields only; this is separate from a
              machine-specific multi-position hoop.
            </p>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button variant="outline" disabled={busy || !design} onClick={() => void calculate(true)}>
            Optimize field angle
          </Button>
          <Button disabled={busy || !design} onClick={() => void calculate()}>
            {busy ? 'Calculating…' : 'Calculate hoopings'}
          </Button>
          <Button disabled={!result || busy} onClick={() => void download()}>
            Download hooping ZIP
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PlacementRow({
  index,
  placement,
  disabled,
  canRemove,
  edit,
  remove,
}: {
  index: number;
  placement: Placement;
  disabled: boolean;
  canRemove: boolean;
  edit: (index: number, key: 'x' | 'y' | 'angle', value: number) => void;
  remove: () => void;
}) {
  return (
    <>
      <span>{index + 1}</span>
      {(['x', 'y', 'angle'] as const).map((key, i) => (
        <NumberField
          key={key}
          ariaLabel={`Hoop ${index + 1} ${key}`}
          value={key === 'angle' ? placement.angle : placement.center[i]}
          min={key === 'angle' ? -180 : -100000}
          max={key === 'angle' ? 180 : 100000}
          digits={1}
          unit={key === 'angle' ? '°' : 'mm'}
          step={key === 'angle' ? 15 : 1}
          disabled={disabled}
          onCommit={(v) => edit(index, key, v)}
        />
      ))}
      <Button
        variant="ghost"
        size="sm"
        aria-label={`Remove hoop ${index + 1}`}
        disabled={disabled || !canRemove}
        onClick={remove}
      >
        Remove
      </Button>
    </>
  );
}
