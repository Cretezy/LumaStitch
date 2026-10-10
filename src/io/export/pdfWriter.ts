// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * A minimal, dependency-free PDF 1.4 writer: numbered objects, uncompressed content streams,
 * DCTDecode (JPEG) image XObjects, the standard Helvetica fonts with WinAnsiEncoding, an
 * xref table and trailer. Just enough for the production worksheet (src/io/export/pdf.ts).
 * No DOM APIs: runs in Node, workers and the browser.
 */

const LATIN = new TextEncoder();

/** Unicode → WinAnsiEncoding (cp1252) for the 0x80–0x9F block; 0xA0–0xFF match Latin-1. */
const WIN_ANSI_HIGH: Record<number, number> = {
  0x20ac: 0x80,
  0x201a: 0x82,
  0x0192: 0x83,
  0x201e: 0x84,
  0x2026: 0x85,
  0x2020: 0x86,
  0x2021: 0x87,
  0x02c6: 0x88,
  0x2030: 0x89,
  0x0160: 0x8a,
  0x2039: 0x8b,
  0x0152: 0x8c,
  0x017d: 0x8e,
  0x2018: 0x91,
  0x2019: 0x92,
  0x201c: 0x93,
  0x201d: 0x94,
  0x2022: 0x95,
  0x2013: 0x96,
  0x2014: 0x97,
  0x02dc: 0x98,
  0x2122: 0x99,
  0x0161: 0x9a,
  0x203a: 0x9b,
  0x0153: 0x9c,
  0x017e: 0x9e,
  0x0178: 0x9f,
};

/** Encodes text as WinAnsi bytes. Characters outside it lose accents or become '?'. */
export function winAnsi(text: string): number[] {
  const out: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if ((cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff)) out.push(cp);
    else if (WIN_ANSI_HIGH[cp] !== undefined) out.push(WIN_ANSI_HIGH[cp]);
    else if (cp === 0x09 || cp === 0x0a || cp === 0x0d) out.push(0x20);
    else {
      const base = ch.normalize('NFKD').replace(/[̀-ͯ]/g, '');
      const b = base.codePointAt(0);
      out.push(base.length === 1 && b !== undefined && b >= 0x20 && b <= 0x7e ? b : 0x3f);
    }
  }
  return out;
}

/** A PDF literal string `( … )` in WinAnsi, with non-printable bytes as octal escapes (keeps the file ASCII). */
export function pdfString(text: string): string {
  let s = '(';
  for (const b of winAnsi(text)) {
    if (b === 0x28 || b === 0x29 || b === 0x5c) s += '\\' + String.fromCharCode(b);
    else if (b < 0x20 || b > 0x7e) s += '\\' + b.toString(8).padStart(3, '0');
    else s += String.fromCharCode(b);
  }
  return s + ')';
}

// Standard Helvetica / Helvetica-Bold advance widths (AFM, 1/1000 em) for 0x20–0x7E.
// prettier-ignore
const HELVETICA = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
// prettier-ignore
const HELVETICA_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];
/** Widths of common WinAnsi characters above 0x7E (same in both weights, close enough for layout). */
const HIGH_WIDTHS: Record<number, number> = {
  0x85: 1000, // …
  0x91: 222,
  0x92: 222,
  0x93: 333,
  0x94: 333,
  0x95: 350, // •
  0x96: 556, // –
  0x97: 1000, // —
  0xb0: 400, // °
  0xb7: 278, // ·
  0xd7: 584, // ×
};

export type PdfFont = 'regular' | 'bold';

/** Width of `text` in points. */
export function textWidth(text: string, font: PdfFont, size: number): number {
  const table = font === 'bold' ? HELVETICA_BOLD : HELVETICA;
  let w = 0;
  for (const b of winAnsi(text)) w += b >= 0x20 && b <= 0x7e ? table[b - 0x20] : (HIGH_WIDTHS[b] ?? 556);
  return (w * size) / 1000;
}

/** Shortens `text` with an ellipsis so it fits in `maxWidth` points. */
export function fitText(text: string, font: PdfFont, size: number, maxWidth: number): string {
  if (textWidth(text, font, size) <= maxWidth) return text;
  const chars = [...text];
  while (chars.length && textWidth(chars.join('') + '…', font, size) > maxWidth) chars.pop();
  return chars.join('').trimEnd() + '…';
}

/** Greedy word wrap into lines no wider than `maxWidth`. */
export function wrapText(text: string, font: PdfFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (!line || textWidth(next, font, size) <= maxWidth) line = next;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.map((l) => fitText(l, font, size, maxWidth));
}

const num = (v: number) => {
  const r = Math.round(v * 100) / 100;
  return (Object.is(r, -0) ? 0 : r).toString();
};

/** `#rrggbb` → PDF colour operands "r g b". */
export function rgb(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const v = m ? parseInt(m[1], 16) : 0;
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((c) => num(c / 255)).join(' ');
}

/**
 * Page content builder. Coordinates are in points from the TOP-LEFT corner (y down); they
 * are flipped to PDF space (origin bottom-left) as operators are written.
 */
export class PdfPage {
  private ops: string[] = [];
  readonly fonts = new Set<PdfFont>();
  readonly images = new Set<string>();

  constructor(
    readonly width: number,
    readonly height: number,
  ) {}

  private y(top: number): number {
    return this.height - top;
  }

  /** Text with its baseline at `top`. */
  text(
    x: number,
    baseline: number,
    text: string,
    opts: { font?: PdfFont; size?: number; color?: string; align?: 'left' | 'right' | 'center' } = {},
  ): void {
    const font = opts.font ?? 'regular';
    const size = opts.size ?? 10;
    this.fonts.add(font);
    let tx = x;
    if (opts.align === 'right') tx = x - textWidth(text, font, size);
    else if (opts.align === 'center') tx = x - textWidth(text, font, size) / 2;
    this.ops.push(
      `BT /${font === 'bold' ? 'F2' : 'F1'} ${num(size)} Tf ${rgb(opts.color ?? '#000000')} rg ${num(tx)} ${num(this.y(baseline))} Td ${pdfString(text)} Tj ET`,
    );
  }

  rect(
    x: number,
    top: number,
    w: number,
    h: number,
    opts: { fill?: string; stroke?: string; lineWidth?: number },
  ): void {
    const parts = ['q'];
    if (opts.fill) parts.push(`${rgb(opts.fill)} rg`);
    if (opts.stroke) parts.push(`${rgb(opts.stroke)} RG ${num(opts.lineWidth ?? 0.5)} w`);
    parts.push(`${num(x)} ${num(this.y(top + h))} ${num(w)} ${num(h)} re`);
    parts.push(opts.fill && opts.stroke ? 'B' : opts.fill ? 'f' : 'S');
    parts.push('Q');
    this.ops.push(parts.join(' '));
  }

  line(x1: number, y1: number, x2: number, y2: number, color = '#000000', lineWidth = 0.5): void {
    this.ops.push(
      `q ${rgb(color)} RG ${num(lineWidth)} w ${num(x1)} ${num(this.y(y1))} m ${num(x2)} ${num(this.y(y2))} l S Q`,
    );
  }

  /** Draws a registered image XObject into the box (x, top, w, h). */
  image(name: string, x: number, top: number, w: number, h: number): void {
    this.images.add(name);
    this.ops.push(`q ${num(w)} 0 0 ${num(h)} ${num(x)} ${num(this.y(top + h))} cm /${name} Do Q`);
  }

  content(): string {
    return this.ops.join('\n') + '\n';
  }
}

export interface PdfJpeg {
  /** Baseline or progressive JPEG bytes (embedded as-is with DCTDecode). */
  bytes: Uint8Array;
  width: number;
  height: number;
}

/** Collects objects and serialises them with a cross-reference table. */
export class PdfDocument {
  private objects: (Uint8Array | null)[] = [];
  private pages: PdfPage[] = [];
  private imageObjects = new Map<string, number>();
  private info: Record<string, string> = {};

  /** Reserves an object number. */
  private reserve(): number {
    this.objects.push(null);
    return this.objects.length;
  }

  private set(id: number, body: string | Uint8Array): void {
    this.objects[id - 1] = typeof body === 'string' ? LATIN.encode(body) : body;
  }

  private add(body: string | Uint8Array): number {
    const id = this.reserve();
    this.set(id, body);
    return id;
  }

  private stream(dict: string, data: Uint8Array): Uint8Array {
    const head = LATIN.encode(`<< ${dict} /Length ${data.length} >>\nstream\n`);
    const tail = LATIN.encode('\nendstream');
    const out = new Uint8Array(head.length + data.length + tail.length);
    out.set(head, 0);
    out.set(data, head.length);
    out.set(tail, head.length + data.length);
    return out;
  }

  /** Registers a JPEG under a resource name, e.g. "Im1". */
  addJpeg(name: string, jpeg: PdfJpeg): void {
    const id = this.add(
      this.stream(
        `/Type /XObject /Subtype /Image /Width ${jpeg.width} /Height ${jpeg.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`,
        jpeg.bytes,
      ),
    );
    this.imageObjects.set(name, id);
  }

  addPage(width: number, height: number): PdfPage {
    const page = new PdfPage(width, height);
    this.pages.push(page);
    return page;
  }

  get pageCount(): number {
    return this.pages.length;
  }

  setInfo(info: { title?: string; producer?: string; creationDate?: Date }): void {
    if (info.title) this.info.Title = pdfString(info.title);
    if (info.producer) this.info.Producer = pdfString(info.producer);
    if (info.creationDate) {
      const d = info.creationDate;
      const p = (n: number, w = 2) => String(n).padStart(w, '0');
      this.info.CreationDate = `(D:${p(d.getUTCFullYear(), 4)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z)`;
    }
  }

  private built = false;

  /** Serialises the document (once). */
  toBytes(): Uint8Array {
    if (this.built) throw new Error('PdfDocument.toBytes() can only be called once');
    this.built = true;
    const fontIds: Record<PdfFont, number> = {
      regular: this.add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'),
      bold: this.add(
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
      ),
    };
    const pagesId = this.reserve();
    const pageIds: number[] = [];
    for (const page of this.pages) {
      const contentId = this.add(this.stream('', LATIN.encode(page.content())));
      const fonts = `/Font << /F1 ${fontIds.regular} 0 R /F2 ${fontIds.bold} 0 R >>`;
      const xobjects = [...page.images]
        .filter((n) => this.imageObjects.has(n))
        .map((n) => `/${n} ${this.imageObjects.get(n)} 0 R`)
        .join(' ');
      const resources = `<< ${fonts}${xobjects ? ` /XObject << ${xobjects} >>` : ''} >>`;
      pageIds.push(
        this.add(
          `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${num(page.width)} ${num(page.height)}] /Resources ${resources} /Contents ${contentId} 0 R >>`,
        ),
      );
    }
    this.set(
      pagesId,
      `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`,
    );
    const catalogId = this.add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
    const infoEntries = Object.entries(this.info)
      .map(([k, v]) => `/${k} ${v}`)
      .join(' ');
    const infoId = infoEntries ? this.add(`<< ${infoEntries} >>`) : 0;

    // Serialise: header (with a binary comment so tools treat the file as binary), objects, xref, trailer.
    const chunks: Uint8Array[] = [];
    let length = 0;
    const push = (b: Uint8Array) => {
      chunks.push(b);
      length += b.length;
    };
    push(new Uint8Array([...LATIN.encode('%PDF-1.4\n%'), 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
    const offsets: number[] = [];
    this.objects.forEach((body, i) => {
      offsets.push(length);
      push(LATIN.encode(`${i + 1} 0 obj\n`));
      push(body ?? LATIN.encode('null'));
      push(LATIN.encode('\nendobj\n'));
    });
    const xrefAt = length;
    const size = this.objects.length + 1;
    let xref = `xref\n0 ${size}\n0000000000 65535 f \n`;
    for (const off of offsets) xref += `${String(off).padStart(10, '0')} 00000 n \n`;
    xref += `trailer\n<< /Size ${size} /Root ${catalogId} 0 R${infoId ? ` /Info ${infoId} 0 R` : ''} >>\nstartxref\n${xrefAt}\n%%EOF\n`;
    push(LATIN.encode(xref));

    const out = new Uint8Array(length);
    let at = 0;
    for (const c of chunks) {
      out.set(c, at);
      at += c.length;
    }
    return out;
  }
}
