// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Step 1 of the SVG import (ARCH §8): parse and sanitise.
 *
 * The file is parsed as XML (falling back to HTML for sloppy files), unsupported active content
 * is counted for warnings, and the tree is cleaned by DOMPurify (SVG + SVG-filter profile):
 * no scripts, `foreignObject`, event handlers, `javascript:` URLs or external references
 * (`href`s must be `#fragment`s, `image` may only embed `data:image/*`; CSS `@import` and
 * non-fragment `url(...)` are removed). The result is re-serialised as standalone SVG/XML.
 */
import DOMPurify from 'dompurify';

export const SVG_NS = 'http://www.w3.org/2000/svg';
export const XLINK_NS = 'http://www.w3.org/1999/xlink';
export const INKSCAPE_NS = 'http://www.inkscape.org/namespaces/inkscape';

export interface SanitizedSvg {
  /** Sanitised, standalone SVG text (valid XML). */
  text: string;
  /** Parsed sanitised document (XML), root is `<svg>`. */
  doc: XMLDocument;
  /** Counts of active / unsupported content found before sanitising, by warning code. */
  removed: Record<string, number>;
}

export class SvgImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SvgImportError';
  }
}

/** Tags counted before sanitising (DOMPurify removes them), mapped to warning codes. */
const PRE_SCAN: Record<string, string> = {
  foreignobject: 'foreignObject',
  script: 'script',
  animate: 'animation',
  animatetransform: 'animation',
  animatemotion: 'animation',
  animatecolor: 'animation',
  set: 'animation',
  iframe: 'foreignObject',
};

const EXTERNAL_CSS_URL = /url\(\s*(['"]?)(?!#)[^)]*\1\s*\)/gi;
const CSS_IMPORT = /@import[^;]*;?/gi;
const DATA_IMAGE = /^\s*data:image\/(png|jpe?g|gif|webp|avif|bmp|svg\+xml)[;,]/i;

export function cleanCss(css: string): string {
  return css.replace(CSS_IMPORT, '').replace(EXTERNAL_CSS_URL, 'none');
}

function parseSource(text: string): Element {
  const src = text.replace(/^\uFEFF/, '');
  const xml = new DOMParser().parseFromString(src, 'image/svg+xml');
  const root = xml.documentElement;
  if (root && root.localName === 'svg' && !xml.getElementsByTagName('parsererror').length) return root;
  // Not well-formed XML (or missing namespace): let the forgiving HTML parser have a go.
  const html = new DOMParser().parseFromString(src, 'text/html');
  const svg = html.querySelector('svg');
  if (!svg || svg.namespaceURI !== SVG_NS) throw new SvgImportError('The file is not a valid SVG document.');
  return svg;
}

let purifier: ReturnType<typeof DOMPurify> | null = null;

function getPurifier(): ReturnType<typeof DOMPurify> {
  if (purifier) return purifier;
  const p = DOMPurify(window);
  p.addHook('uponSanitizeElement', (node) => {
    if ((node as Element).localName === 'style' && node.textContent)
      node.textContent = cleanCss(node.textContent);
  });
  p.addHook('afterSanitizeAttributes', (node) => {
    const el = node as Element;
    if (!el.getAttribute) return;
    for (const name of ['href', 'xlink:href']) {
      const v = el.getAttribute(name);
      if (v == null) continue;
      const ok = v.trim().startsWith('#') || (el.localName === 'image' && DATA_IMAGE.test(v));
      if (!ok) el.removeAttribute(name);
    }
    const style = el.getAttribute('style');
    if (style) el.setAttribute('style', cleanCss(style));
  });
  purifier = p;
  return p;
}

export function sanitizeSvg(text: string): SanitizedSvg {
  const source = parseSource(text);
  const removed: Record<string, number> = {};
  for (const el of Array.from(source.getElementsByTagName('*'))) {
    const code = PRE_SCAN[el.localName.toLowerCase()];
    if (code) removed[code] = (removed[code] ?? 0) + 1;
  }
  const body = getPurifier().sanitize(source as Node, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_TAGS: ['use', 'style', 'symbol', 'switch'],
    ADD_ATTR: [
      'inkscape:label',
      'inkscape:groupmode',
      'data-name',
      'clip-path',
      'clip-rule',
      'mask',
      'xml:space',
    ],
    FORBID_TAGS: ['script', 'foreignObject', 'foreignobject', 'iframe'],
    // Clobbering protection is irrelevant: the tree is only mounted inside a shadow root and
    // rendered via <img>; stripping ids would break references and names.
    SANITIZE_DOM: false,
    RETURN_DOM: true,
  }) as unknown as HTMLElement;
  const svg = body.querySelector('svg') ?? (body.localName === 'svg' ? body : null);
  if (!svg) throw new SvgImportError('The SVG has no content after sanitising.');
  const serialized = new XMLSerializer().serializeToString(svg);
  const doc = new DOMParser().parseFromString(serialized, 'image/svg+xml') as XMLDocument;
  if (doc.getElementsByTagName('parsererror').length || doc.documentElement.localName !== 'svg') {
    throw new SvgImportError('The SVG could not be sanitised.');
  }
  return { text: serialized, doc, removed };
}
