// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Export dialog (SPEC FR-6, §3.3): machine files — Brother PES (v1/v6, the default) with a
 * machine colour preview, or DST / JEF / EXP / VP3 — with stats and validation, plus PNG
 * preview, SVG geometry and the PDF production worksheet. The last machine format is
 * remembered. Opened with `{ viewPes: true, file }` it becomes a read-only PES viewer (FR-6.6).
 *
 * data: { format?: 'pes' | 'dst' | 'jef' | 'exp' | 'vp3' | 'png' | 'svg' | 'pdf' }
 *     | { viewPes: true; file: File }
 */
import { useEffect, useId, useMemo, useState } from 'react';
import { Download, LoaderCircle } from 'lucide-react';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { StitchPlan } from '@/engine/types';
import { exportPdf } from '@/io/export/pdf';
import { PNG_MAX_SIDE, exportPng } from '@/io/export/png';
import { getMachineFormat } from '@/io/export/registry';
import { exportSvg } from '@/io/export/svg';
import { hasErrors, validateMachineExport, validatePesExport } from '@/io/export/validation';
import { safeFileName } from '@/io/project/files';
import { getPref, setPref } from '@/library/library';
import { useDoc } from '@/store/documentStore';
import { waitForPlan } from '@/store/planStore';
import { useUi } from '@/store/uiStore';
import { PngExportTab, SvgExportTab, type PngBackground, type PngMode } from './export/ImageExportTabs';
import { MachineExportTab, MachineFormatPicker } from './export/MachineExportTab';
import { isMachineFormat, type MachineChoice } from './export/machineFormats';
import { PdfExportTab, type PdfBackground } from './export/PdfExportTab';
import { PesExportTab, type PesVersion } from './export/PesExportTab';
import { PesViewer } from './export/PesViewer';
import {
  ACCEPT_PDF,
  ACCEPT_PNG,
  ACCEPT_SVG,
  acceptMachine,
  errorMessage,
  saveWithToast,
} from './export/save';

/** Dialog tabs. Machine files share one tab with a format picker. */
type Tab = 'machine' | 'png' | 'svg' | 'pdf';
const PREF_PES_VERSION = 'export.pesVersion';
const PREF_MACHINE_FORMAT = 'export.machineFormat';
const PREF_PNG = 'export.png';
const PREF_PDF = 'export.pdf';

export default function ExportDialog({ open, onClose, data }: DialogProps) {
  const viewFile: File | null = data?.viewPes === true && data.file instanceof File ? data.file : null;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        {viewFile ? (
          <>
            <DialogHeader className="pr-6">
              <DialogTitle className="truncate">{viewFile.name}</DialogTitle>
              <DialogDescription>Embroidery file viewer. Files opened here are read-only.</DialogDescription>
            </DialogHeader>
            <PesViewer file={viewFile} />
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>
            </DialogFooter>
          </>
        ) : (
          <ExportBody
            onClose={onClose}
            initialTab={isTab(data?.format) ? data.format : 'machine'}
            requestedMachine={isMachineFormat(data?.format) ? data.format : null}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function isTab(v: unknown): v is Tab {
  return v === 'machine' || v === 'png' || v === 'svg' || v === 'pdf';
}

function ExportBody({
  onClose,
  initialTab,
  requestedMachine,
}: {
  onClose: () => void;
  initialTab: Tab;
  /** A machine format asked for by the caller (wins over the remembered one). */
  requestedMachine: MachineChoice | null;
}) {
  const design = useDoc((s) => s.design);
  const fabricColor = useUi((s) => s.view.fabricColor);
  const [plan, setPlan] = useState<StitchPlan | null | undefined>(undefined);
  const [tab, setTab] = useState<Tab>(requestedMachine ? 'machine' : initialTab);
  const [machine, setMachine] = useState<MachineChoice>(requestedMachine ?? 'pes');
  const [baseName, setBaseName] = useState(() => stripExt(design?.name.trim() || 'Untitled'));
  const [version, setVersion] = useState<PesVersion>(1);
  const [pngMode, setPngMode] = useState<PngMode>('realistic');
  const [pngBackground, setPngBackground] = useState<PngBackground>('transparent');
  const [pdfBackground, setPdfBackground] = useState<PdfBackground>('white');
  const [busy, setBusy] = useState(false);
  const nameId = useId();

  useEffect(() => {
    let alive = true;
    void waitForPlan().then((p) => alive && setPlan(p));
    void getPref<PesVersion>(PREF_PES_VERSION).then((v) => alive && (v === 1 || v === 6) && setVersion(v));
    if (!requestedMachine)
      void getPref<MachineChoice>(PREF_MACHINE_FORMAT).then(
        (v) => alive && isMachineFormat(v) && setMachine(v),
      );
    void getPref<{ background?: PdfBackground }>(PREF_PDF).then((p) => {
      if (alive && (p?.background === 'white' || p?.background === 'fabric')) setPdfBackground(p.background);
    });
    void getPref<{ mode?: PngMode; background?: PngBackground }>(PREF_PNG).then((p) => {
      if (!alive || !p) return;
      if (p.mode === 'flat' || p.mode === 'realistic') setPngMode(p.mode);
      if (p.background === 'transparent' || p.background === 'fabric') setPngBackground(p.background);
    });
    return () => {
      alive = false;
    };
  }, [requestedMachine]);

  const diagnostics = useMemo(
    () => (!plan ? [] : machine === 'pes' ? validatePesExport(plan) : validateMachineExport(plan, machine)),
    [plan, machine],
  );
  const blocked = hasErrors(diagnostics);
  const ext = tab === 'machine' ? machine : tab;
  const fileName = safeFileName(stripExt(baseName.trim()) || 'Untitled', ext);

  async function run(task: () => Promise<boolean>) {
    if (busy) return;
    setBusy(true);
    try {
      if (await task()) onClose();
    } catch (err) {
      useUi.getState().showToast(`Export failed: ${errorMessage(err)}`, 'error');
    } finally {
      setBusy(false);
    }
  }

  const exportMachine = () =>
    run(async () => {
      if (!plan || !design || blocked) return false;
      const fmt = getMachineFormat(machine);
      if (!fmt) throw new Error(`${machine.toUpperCase()} format is not registered`);
      const bytes = fmt.write(plan, design, machine === 'pes' ? { version, hoop: 'auto' } : {});
      void setPref(PREF_MACHINE_FORMAT, machine);
      if (machine === 'pes') void setPref(PREF_PES_VERSION, version);
      return saveWithToast(
        new Blob([bytes.slice()], { type: fmt.mime }),
        fileName,
        fmt.label,
        acceptMachine(fmt.ext),
      );
    });

  const exportPdfFile = () =>
    run(async () => {
      if (!plan || !design) return false;
      void setPref(PREF_PDF, { background: pdfBackground });
      const blob = await exportPdf(plan, design, {
        background: pdfBackground === 'fabric' ? fabricColor : '#ffffff',
      });
      return saveWithToast(blob, fileName, 'PDF worksheet', ACCEPT_PDF);
    });

  const exportPngFile = () =>
    run(async () => {
      if (!plan) return false;
      void setPref(PREF_PNG, { mode: pngMode, background: pngBackground });
      const blob = await exportPng(plan, {
        mode: pngMode,
        maxSide: PNG_MAX_SIDE,
        background: pngBackground === 'fabric' ? fabricColor : null,
      });
      return saveWithToast(blob, fileName, 'PNG image', ACCEPT_PNG);
    });

  const svg = useMemo(() => (tab === 'svg' && design ? exportSvg(design) : ''), [tab, design]);
  const exportSvgFile = () =>
    run(async () => {
      if (!design || !svg) return false;
      return saveWithToast(new Blob([svg], { type: 'image/svg+xml' }), fileName, 'SVG image', ACCEPT_SVG);
    });

  const header = (
    <DialogHeader>
      <DialogTitle>Export</DialogTitle>
      <DialogDescription>
        Save a machine file for your embroidery machine, a preview image or a printable worksheet.
      </DialogDescription>
    </DialogHeader>
  );

  if (!design) {
    return (
      <>
        {header}
        <p className="text-sm text-muted-foreground">Open or create a design to export it.</p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </>
    );
  }

  const needsPlan = tab !== 'svg';
  const planReady = !!plan && plan.stats.stitches > 0;
  const primary =
    tab === 'machine'
      ? { label: `Export .${machine}`, onClick: exportMachine, disabled: !plan || blocked }
      : tab === 'png'
        ? { label: 'Export PNG', onClick: exportPngFile, disabled: !planReady }
        : tab === 'pdf'
          ? { label: 'Export PDF', onClick: exportPdfFile, disabled: !planReady }
          : { label: 'Export SVG', onClick: exportSvgFile, disabled: false };
  const noStitches = (
    <p className="py-12 text-sm text-muted-foreground">The design has no stitches to render yet.</p>
  );

  return (
    <>
      {header}

      <div className="grid gap-1.5">
        <Label htmlFor={nameId}>File name</Label>
        <div className="flex items-center rounded-md border border-input shadow-xs focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/40">
          <Input
            id={nameId}
            value={baseName}
            onChange={(e) => setBaseName(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            maxLength={120}
            className="border-0 shadow-none focus-visible:ring-0"
            aria-describedby={`${nameId}-ext`}
          />
          <span id={`${nameId}-ext`} className="pr-2.5 text-sm text-muted-foreground">
            .{ext}
          </span>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => isTab(v) && setTab(v)}>
        <TabsList className="w-full">
          <TabsTrigger value="machine">Machine file (.{machine})</TabsTrigger>
          <TabsTrigger value="png">PNG preview</TabsTrigger>
          <TabsTrigger value="svg">SVG (geometry)</TabsTrigger>
          <TabsTrigger value="pdf">Worksheet (PDF)</TabsTrigger>
        </TabsList>

        {needsPlan && plan === undefined ? (
          <p className="flex items-center gap-2 py-12 text-sm text-muted-foreground" role="status">
            <LoaderCircle className="size-4 animate-spin" aria-hidden /> Generating stitches…
          </p>
        ) : needsPlan && !plan ? (
          <p className="py-12 text-sm text-muted-foreground">
            The stitches could not be generated. Check the Issues panel and try again.
          </p>
        ) : (
          <>
            <TabsContent value="machine" className="grid gap-4 pt-2">
              <MachineFormatPicker value={machine} onChange={setMachine} />
              {plan &&
                (machine === 'pes' ? (
                  <PesExportTab
                    plan={plan}
                    design={design}
                    version={version}
                    onVersion={setVersion}
                    diagnostics={diagnostics}
                    fabricColor={fabricColor}
                  />
                ) : (
                  <MachineExportTab
                    key={machine}
                    format={machine}
                    plan={plan}
                    design={design}
                    diagnostics={diagnostics}
                    fabricColor={fabricColor}
                  />
                ))}
            </TabsContent>
            <TabsContent value="png" className="pt-2">
              {plan &&
                (planReady ? (
                  <PngExportTab
                    plan={plan}
                    design={design}
                    mode={pngMode}
                    onMode={setPngMode}
                    background={pngBackground}
                    onBackground={setPngBackground}
                    fabricColor={fabricColor}
                  />
                ) : (
                  noStitches
                ))}
            </TabsContent>
            <TabsContent value="svg" className="pt-2">
              <SvgExportTab design={design} svg={svg} />
            </TabsContent>
            <TabsContent value="pdf" className="pt-2">
              {plan &&
                (planReady ? (
                  <PdfExportTab
                    plan={plan}
                    design={design}
                    background={pdfBackground}
                    onBackground={setPdfBackground}
                    fabricColor={fabricColor}
                  />
                ) : (
                  noStitches
                ))}
            </TabsContent>
          </>
        )}
      </Tabs>

      <DialogFooter className="items-center">
        {tab === 'machine' && blocked && (
          <p className="mr-auto text-xs text-destructive">Fix the errors above to export.</p>
        )}
        <Button variant="outline" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button onClick={primary.onClick} disabled={primary.disabled || busy}>
          {busy ? <LoaderCircle className="animate-spin" aria-hidden /> : <Download aria-hidden />}
          {primary.label}
        </Button>
      </DialogFooter>
    </>
  );
}

/** Removes a known export/project extension the user may have typed. */
function stripExt(name: string): string {
  return name.replace(/\.(pes|dst|jef|exp|vp3|png|svg|pdf|lumastitch)$/i, '');
}
