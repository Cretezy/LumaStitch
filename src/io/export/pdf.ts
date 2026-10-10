// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Production worksheet (SPEC §3.3, P2): a printable A4 PDF with the design name and date,
 * size and stitch statistics, fabric preset and stabiliser hint, a large realistic preview
 * and the colour sequence (step, swatch, thread, chart and code, stitches, stops). The
 * colour table continues on further pages when it does not fit.
 *
 * `buildWorksheetPdf` is pure (Node-testable); `exportPdf` renders the preview JPEG with the
 * canvas stitch renderer first.
 */
import { renderPlanImage } from '@/canvas/stitchRenderer';
import { COMMAND_MASK, F, type Diagnostic, type StitchPlan } from '@/engine/types';
import { FABRIC_PRESETS } from '@/engine/params/fabric';
import type { Design } from '@/model/types';
import { fmt, fmtInt, fmtTime } from '@/lib/utils';
import { PdfDocument, fitText, wrapText, type PdfJpeg, type PdfPage } from './pdfWriter';
import { resolveChart } from './pesFormat';
import { pngSize } from './png';
import type { DocumentExportFormat } from './registry';

export type { PdfJpeg } from './pdfWriter';

/** A4 portrait, points. */
export const A4 = { width: 595.28, height: 841.89 } as const;

export interface WorksheetRow {
  /** 1-based sewing step (colour block). */
  step: number;
  /** #rrggbb */
  color: string;
  threadName: string;
  /** Chart name and/or thread code, e.g. "Isacord Polyester 1902". Empty when unknown. */
  chartCode: string;
  stitches: number;
  /** The machine stops before this step (same thread, e.g. for appliqué). */
  stop: boolean;
}

export interface WorksheetData {
  title: string;
  date: string;
  /** [label, value] rows of the statistics panel. */
  stats: [string, string][];
  fabric: string;
  stabilizer: string;
  rows: WorksheetRow[];
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** "10 October 2026" (fixed English format, independent of the browser locale). */
export function worksheetDate(d: Date): string {
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** Collects what the worksheet shows from a plan and its design. */
export function worksheetData(
  plan: StitchPlan,
  design: Pick<Design, 'name' | 'threads' | 'fabric'>,
  date: Date = new Date(),
): WorksheetData {
  const s = plan.stats;
  const b = plan.bounds;
  const w = Math.max(0, b.maxX - b.minX);
  const h = Math.max(0, b.maxY - b.minY);
  const colors = new Set(plan.colorBlocks.map((blk) => blk.threadId)).size;
  const rows: WorksheetRow[] = plan.colorBlocks.map((blk, i) => {
    let stitches = 0;
    for (let k = blk.start; k < blk.end; k++) if ((plan.flags[k] & COMMAND_MASK) === 0) stitches++;
    const t = design.threads[blk.threadId];
    const chart = t?.chart ? (resolveChart(t.chart)?.chart ?? t.chart) : '';
    // The colour change / stop that starts a block is the last command of the previous one.
    const boundary = blk.start > 0 ? plan.flags[blk.start - 1] & COMMAND_MASK : 0;
    return {
      step: i + 1,
      color: blk.color,
      threadName: t?.name || blk.color.toUpperCase(),
      chartCode: [chart, t?.code ?? ''].filter(Boolean).join(' '),
      stitches,
      stop: i > 0 && (boundary & F.STOP) !== 0,
    };
  });
  const fabric = FABRIC_PRESETS[design.fabric];
  return {
    title: design.name.trim() || 'Untitled',
    date: worksheetDate(date),
    stats: [
      ['Size', `${fmt(w)} × ${fmt(h)} mm`],
      ['Stitches', fmtInt(s.stitches)],
      ['Colours', fmtInt(colors)],
      ['Colour changes', fmtInt(s.colorChanges)],
      ['Stops', fmtInt(s.stops)],
      ['Trims', fmtInt(s.trims)],
      ['Estimated time', fmtTime(s.estSeconds)],
    ],
    fabric: fabric?.label ?? String(design.fabric ?? ''),
    stabilizer: fabric?.stabilizer ?? '',
    rows,
  };
}

// Layout (points).
const M = 42;
const CW = A4.width - 2 * M;
const INK = '#1f1f1f';
const MUTED = '#6b6b6b';
const RULE = '#d4d4d4';
const STOP_RED = '#b42318';
const PREVIEW = { x: M, top: M + 58, w: 322, h: 322 };
const SIDE = { x: M + 338, w: CW - 338 };
const ROW_H = 20;
const TABLE_TOP_FIRST = PREVIEW.top + PREVIEW.h + 30;
const TABLE_TOP_NEXT = M + 46;
const BOTTOM = A4.height - M - 22;
const COL = {
  step: M + 20, // right edge
  swatch: M + 28,
  thread: M + 52,
  threadW: 196,
  chart: M + 256,
  chartW: 150,
  stitches: M + 452, // right edge
  stop: M + 466,
};
const LEGEND_H = 22;

function header(page: PdfPage, data: WorksheetData, continued: boolean): void {
  if (!continued) {
    page.text(M, M + 18, fitText(data.title, 'bold', 20, CW), { font: 'bold', size: 20, color: INK });
    page.text(M, M + 36, `Production worksheet · ${data.date}`, { size: 9.5, color: MUTED });
    page.line(M, M + 46, M + CW, M + 46, RULE, 0.75);
  } else {
    page.text(M, M + 14, fitText(`${data.title} — colour sequence (continued)`, 'bold', 12, CW), {
      font: 'bold',
      size: 12,
      color: INK,
    });
    page.line(M, M + 24, M + CW, M + 24, RULE, 0.75);
  }
}

function footer(page: PdfPage, data: WorksheetData, index: number, count: number): void {
  const y = A4.height - M + 8;
  page.text(M, y, fitText(`LumaStitch · ${data.title}`, 'regular', 8, CW - 80), { size: 8, color: MUTED });
  page.text(M + CW, y, `Page ${index + 1} of ${count}`, { size: 8, color: MUTED, align: 'right' });
}

function preview(page: PdfPage, image: PdfJpeg | null | undefined): void {
  const { x, top, w, h } = PREVIEW;
  page.rect(x, top, w, h, { stroke: RULE, lineWidth: 0.75 });
  if (!image || image.width <= 0 || image.height <= 0) {
    page.text(x + w / 2, top + h / 2, 'Preview not available', { size: 10, color: MUTED, align: 'center' });
    return;
  }
  const pad = 6;
  const scale = Math.min((w - 2 * pad) / image.width, (h - 2 * pad) / image.height);
  const iw = image.width * scale;
  const ih = image.height * scale;
  page.image('Im1', x + (w - iw) / 2, top + (h - ih) / 2, iw, ih);
}

function sidePanel(page: PdfPage, data: WorksheetData): void {
  const { x, w } = SIDE;
  let y = PREVIEW.top;
  page.text(x, y + 10, 'Design', { font: 'bold', size: 11, color: INK });
  y += 20;
  for (const [label, value] of data.stats) {
    page.text(x, y + 12, label, { size: 9, color: MUTED });
    page.text(x + w, y + 12, value, { font: 'bold', size: 10, color: INK, align: 'right' });
    y += 18;
    page.line(x, y, x + w, y, '#ececec', 0.5);
  }
  y += 16;
  const block = (label: string, value: string) => {
    if (!value) return;
    page.text(x, y + 10, label, { size: 9, color: MUTED });
    y += 14;
    for (const line of wrapText(value, 'regular', 10, w)) {
      page.text(x, y + 10, line, { size: 10, color: INK });
      y += 13;
    }
    y += 8;
  };
  block('Fabric', data.fabric);
  block('Stabiliser', data.stabilizer);
}

function tableHeader(page: PdfPage, top: number): number {
  page.text(COL.step, top + 10, '#', { font: 'bold', size: 8.5, color: MUTED, align: 'right' });
  page.text(COL.thread, top + 10, 'Thread', { font: 'bold', size: 8.5, color: MUTED });
  page.text(COL.chart, top + 10, 'Chart / code', { font: 'bold', size: 8.5, color: MUTED });
  page.text(COL.stitches, top + 10, 'Stitches', { font: 'bold', size: 8.5, color: MUTED, align: 'right' });
  page.line(M, top + 16, M + CW, top + 16, RULE, 0.75);
  return top + 18;
}

function tableRow(page: PdfPage, top: number, row: WorksheetRow, shaded: boolean): void {
  if (shaded) page.rect(M, top, CW, ROW_H, { fill: '#f6f6f4' });
  const base = top + 13.5;
  page.text(COL.step, base, String(row.step), { size: 9.5, color: INK, align: 'right' });
  page.rect(COL.swatch, top + 3.5, 18, 13, { fill: row.color, stroke: '#9a9a9a', lineWidth: 0.5 });
  page.text(COL.thread, base, fitText(row.threadName, 'regular', 9.5, COL.threadW), {
    size: 9.5,
    color: INK,
  });
  page.text(COL.chart, base, fitText(row.chartCode || '—', 'regular', 9.5, COL.chartW), {
    size: 9.5,
    color: row.chartCode ? INK : MUTED,
  });
  page.text(COL.stitches, base, fmtInt(row.stitches), { size: 9.5, color: INK, align: 'right' });
  if (row.stop) {
    page.rect(COL.stop, top + 4, 40, 12, { stroke: STOP_RED, lineWidth: 0.75 });
    page.text(COL.stop + 20, top + 13, 'STOP', { font: 'bold', size: 7.5, color: STOP_RED, align: 'center' });
  }
}

/** Splits the rows over pages: as many as fit under the preview, then full pages. */
function paginate(rows: readonly WorksheetRow[], needLegend: boolean): WorksheetRow[][] {
  const firstCap = Math.floor((BOTTOM - (TABLE_TOP_FIRST + 22 + 18)) / ROW_H);
  const nextCap = Math.floor((BOTTOM - (TABLE_TOP_NEXT + 18)) / ROW_H);
  const pages: WorksheetRow[][] = [rows.slice(0, firstCap)];
  for (let i = firstCap; i < rows.length; i += nextCap) pages.push(rows.slice(i, i + nextCap));
  // Keep room for the stop legend under the last row.
  if (needLegend) {
    const last = pages.length - 1;
    const cap = last === 0 ? firstCap : nextCap;
    if (pages[last].length * ROW_H + LEGEND_H > cap * ROW_H) pages.push([]);
  }
  return pages;
}

/** Number of A4 pages the worksheet will have. */
export function worksheetPageCount(data: Pick<WorksheetData, 'rows'>): number {
  return paginate(
    data.rows,
    data.rows.some((r) => r.stop),
  ).length;
}

/** Builds the worksheet PDF. `image` is the JPEG preview (omitted → a placeholder box). */
export function buildWorksheetPdf(
  data: WorksheetData,
  image?: PdfJpeg | null,
  opts: { creationDate?: Date } = {},
): Uint8Array {
  const doc = new PdfDocument();
  doc.setInfo({ title: data.title, producer: 'LumaStitch', creationDate: opts.creationDate ?? new Date() });
  if (image) doc.addJpeg('Im1', image);
  const needLegend = data.rows.some((r) => r.stop);
  const chunks = paginate(data.rows, needLegend);
  const pages = chunks.map(() => doc.addPage(A4.width, A4.height));

  chunks.forEach((rows, p) => {
    const page = pages[p];
    header(page, data, p > 0);
    let top: number;
    if (p === 0) {
      preview(page, image);
      sidePanel(page, data);
      page.text(M, TABLE_TOP_FIRST + 12, 'Colour sequence', { font: 'bold', size: 12, color: INK });
      top = TABLE_TOP_FIRST + 22;
    } else top = TABLE_TOP_NEXT;
    if (rows.length > 0 || p === 0) top = tableHeader(page, top);
    if (p === 0 && data.rows.length === 0) {
      page.text(M + 4, top + 14, 'No colours: the design has no stitches yet.', { size: 9.5, color: MUTED });
    }
    const offset = chunks.slice(0, p).reduce((n, c) => n + c.length, 0);
    rows.forEach((row, i) => {
      tableRow(page, top, row, (offset + i) % 2 === 1);
      top += ROW_H;
    });
    if (needLegend && p === chunks.length - 1) {
      page.rect(M, top + 8, 40, 12, { stroke: STOP_RED, lineWidth: 0.75 });
      page.text(M + 20, top + 17, 'STOP', { font: 'bold', size: 7.5, color: STOP_RED, align: 'center' });
      page.text(M + 48, top + 17.5, 'The machine stops before this step; the thread stays the same.', {
        size: 8.5,
        color: MUTED,
      });
    }
    footer(page, data, p, chunks.length);
  });
  return doc.toBytes();
}

export interface PdfExportOptions {
  /** Worksheet date (default: now). */
  date?: Date;
  /** Preview background (JPEG has no transparency). Default white. */
  background?: string;
  /** Longest side of the preview image in pixels. Default 1400 (≈ 300 dpi in the preview box). */
  imageMaxSide?: number;
  /** JPEG quality 0–1. Default 0.9. */
  quality?: number;
  /** Use this JPEG instead of rendering one (tests); null = no preview image. */
  jpeg?: PdfJpeg | null;
}

/** Renders the realistic stitch preview as a JPEG. Returns null when the browser can't encode JPEG. */
export async function renderPlanJpeg(
  plan: StitchPlan,
  opts: { maxSide?: number; background?: string; quality?: number } = {},
): Promise<PdfJpeg | null> {
  const { width, height, padding } = pngSize(plan, opts.maxSide ?? 1400);
  const canvas = renderPlanImage(plan, {
    width,
    height,
    mode: 'realistic',
    padding,
    background: opts.background ?? '#ffffff',
  });
  const quality = opts.quality ?? 0.9;
  const blob =
    'convertToBlob' in canvas
      ? await canvas.convertToBlob({ type: 'image/jpeg', quality })
      : await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob) return null;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null; // not a JPEG (encoder fell back to PNG)
  return { bytes, width, height };
}

/** Builds the production worksheet for a plan. */
export async function exportPdf(
  plan: StitchPlan,
  design: Pick<Design, 'name' | 'threads' | 'fabric'>,
  opts: PdfExportOptions = {},
): Promise<Blob> {
  const date = opts.date ?? new Date();
  const jpeg =
    opts.jpeg !== undefined
      ? opts.jpeg
      : plan.stats.stitches > 0
        ? await renderPlanJpeg(plan, {
            maxSide: opts.imageMaxSide,
            background: opts.background,
            quality: opts.quality,
          })
        : null;
  const bytes = buildWorksheetPdf(worksheetData(plan, design, date), jpeg, { creationDate: date });
  return new Blob([bytes.slice()], { type: 'application/pdf' });
}

function validatePdf(plan: StitchPlan): Diagnostic[] {
  return plan.stats.stitches > 0
    ? []
    : [{ severity: 'error', code: 'export.empty', message: 'The design has no stitches to export.' }];
}

/** Options: `PdfExportOptions` (date, background, imageMaxSide, quality). */
export const pdfFormat: DocumentExportFormat = {
  id: 'pdf',
  kind: 'document',
  ext: 'pdf',
  mime: 'application/pdf',
  label: 'Production worksheet (PDF)',
  validate(plan: StitchPlan, _design: Design) {
    return validatePdf(plan);
  },
  async write(plan: StitchPlan, design: Design, opts: unknown) {
    const o = (opts && typeof opts === 'object' ? opts : {}) as PdfExportOptions;
    const blob = await exportPdf(plan, design, o);
    return new Uint8Array(await blob.arrayBuffer());
  },
};
