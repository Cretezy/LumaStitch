// SPDX-License-Identifier: GPL-3.0-or-later
/** DOM-tree helpers for the SVG import: transforms, names, `<use>` expansion (ARCH §8.4–8.6). */
import { IDENTITY, multiply } from '@/geom/matrix';
import type { Matrix } from '@/model/types';
import { INKSCAPE_NS, SVG_NS, XLINK_NS } from './sanitize';
import { lengthToUser } from './units';

const fromDom = (m: DOMMatrixReadOnly | SVGMatrix): Matrix => [m.a, m.b, m.c, m.d, m.e, m.f];
const close = (a: Matrix, b: Matrix) => {
  const scale = Math.max(1, ...a.map(Math.abs));
  return a.every((v, i) => Math.abs(v - b[i]) <= 1e-4 * scale);
};

const DEG = Math.PI / 180;
const TRANSFORM_RE = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;

/**
 * Parse an SVG `transform` attribute in double precision (SVGMatrix / `transform.baseVal` is
 * single precision in browsers, which costs ~1e-6 relative error). Returns null if invalid.
 */
export function parseTransform(s: string | null): Matrix | null {
  if (!s || !s.trim()) return IDENTITY;
  let m: Matrix = IDENTITY;
  let consumed = '';
  for (const match of s.matchAll(TRANSFORM_RE)) {
    consumed += match[0];
    const a = (match[2].match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g) ?? []).map(Number);
    let t: Matrix;
    switch (match[1]) {
      case 'matrix':
        if (a.length !== 6) return null;
        t = [a[0], a[1], a[2], a[3], a[4], a[5]];
        break;
      case 'translate':
        if (a.length < 1 || a.length > 2) return null;
        t = [1, 0, 0, 1, a[0], a[1] ?? 0];
        break;
      case 'scale':
        if (a.length < 1 || a.length > 2) return null;
        t = [a[0], 0, 0, a[1] ?? a[0], 0, 0];
        break;
      case 'rotate': {
        if (a.length !== 1 && a.length !== 3) return null;
        const c = Math.cos(a[0] * DEG);
        const sn = Math.sin(a[0] * DEG);
        const [cx, cy] = a.length === 3 ? [a[1], a[2]] : [0, 0];
        t = [c, sn, -sn, c, cx - c * cx + sn * cy, cy - sn * cx - c * cy];
        break;
      }
      case 'skewX':
        if (a.length !== 1) return null;
        t = [1, 0, Math.tan(a[0] * DEG), 1, 0, 0];
        break;
      default:
        if (a.length !== 1) return null;
        t = [1, Math.tan(a[0] * DEG), 0, 1, 0, 0];
    }
    m = multiply(m, t);
  }
  // Anything left besides separators means a syntax error (the attribute is then ignored).
  const rest = s.replace(TRANSFORM_RE, '').replace(/[\s,]/g, '');
  return rest || !consumed ? null : m;
}

/**
 * An element's own transform. The `transform` attribute is parsed in double precision (equal to
 * `transform.baseVal.consolidate()`, which is only used as a fallback). A CSS `transform` (from a
 * stylesheet or `style`) overrides it, honouring `transform-origin` and `transform-box`.
 */
export function elementTransform(el: Element, cs?: CSSStyleDeclaration): Matrix {
  let m = parseTransform(el.getAttribute('transform'));
  if (!m) {
    m = IDENTITY;
    const list = (el as SVGGraphicsElement).transform?.baseVal;
    if (list) {
      for (let i = 0; i < list.numberOfItems; i++) m = multiply(m, fromDom(list.getItem(i).matrix));
    }
  }
  const css = cs?.getPropertyValue('transform');
  if (css && css !== 'none') {
    let cm: Matrix;
    try {
      cm = fromDom(new DOMMatrixReadOnly(css));
    } catch {
      return m;
    }
    // Chrome reports the transform attribute as the computed CSS transform too; only a different
    // value means a stylesheet / style override.
    if (!close(cm, m)) {
      const [ox, oy] = (cs!.getPropertyValue('transform-origin') || '0 0')
        .split(/\s+/)
        .map((v) => parseFloat(v) || 0);
      let bx = 0;
      let by = 0;
      if (cs!.getPropertyValue('transform-box') === 'fill-box') {
        try {
          const b = (el as SVGGraphicsElement).getBBox();
          bx = b.x;
          by = b.y;
        } catch {
          /* not rendered */
        }
      }
      const tx = ox + bx;
      const ty = oy + by;
      m = multiply(multiply([1, 0, 0, 1, tx, ty], cm), [1, 0, 0, 1, -tx, -ty]);
    }
  }
  return m;
}

/** Name from inkscape:label, data-name (Illustrator) or id. */
export function ownName(el: Element): string | null {
  const v =
    el.getAttributeNS(INKSCAPE_NS, 'label') ||
    el.getAttribute('inkscape:label') ||
    el.getAttribute('data-name') ||
    el.getAttribute('id');
  return v?.trim() || null;
}

/** Auto-generated group ids ("g123", "layer1", "group_2") are not useful as name prefixes. */
const AUTO_GROUP_ID = /^(g|group|layer|svg|use|a|clip|clippath|defs|switch)[-_]?\d+(?:[-_]\d+)*$/i;

export function groupName(el: Element): string | null {
  const label =
    el.getAttributeNS(INKSCAPE_NS, 'label') ||
    el.getAttribute('inkscape:label') ||
    el.getAttribute('data-name');
  if (label?.trim()) return label.trim();
  const id = el.getAttribute('id')?.trim();
  return id && !AUTO_GROUP_ID.test(id) ? id : null;
}

export function hrefOf(el: Element): string | null {
  return el.getAttribute('href') ?? el.getAttributeNS(XLINK_NS, 'href') ?? el.getAttribute('xlink:href');
}

const USE_GEOMETRY_ATTRS = new Set(['x', 'y', 'width', 'height', 'href', 'xlink:href']);

/**
 * Replace every `<use>` by `<g transform="(use transform) translate(x y)">clone</g>` so that
 * style inheritance and CSS selectors work through `getComputedStyle`. A referenced `<symbol>`
 * becomes a nested `<svg>` viewport (use width/height, default 100%). Unresolvable or cyclic
 * references are removed; returns how many were dropped.
 */
export function expandUses(
  root: DocumentFragment | Element,
  lookup: (id: string) => Element | null,
  vp: { width: number; height: number },
): number {
  let dropped = 0;
  for (let pass = 0; pass < 32; pass++) {
    const uses = Array.from(root.querySelectorAll('use'));
    if (!uses.length) return dropped;
    for (const use of uses) {
      if (!use.isConnected) continue;
      const href = hrefOf(use);
      const ref = href?.startsWith('#') ? lookup(href.slice(1)) : null;
      if (!ref || ref === use || ref.contains(use) || pass === 31) {
        use.remove();
        dropped++;
        continue;
      }
      const doc = use.ownerDocument;
      const g = doc.createElementNS(SVG_NS, 'g');
      for (const attr of Array.from(use.attributes)) {
        if (
          USE_GEOMETRY_ATTRS.has(attr.name) ||
          (attr.namespaceURI === XLINK_NS && attr.localName === 'href')
        )
          continue;
        if (attr.name === 'transform') continue;
        g.setAttributeNS(attr.namespaceURI, attr.name, attr.value);
      }
      const x = lengthToUser(use.getAttribute('x'), vp.width);
      const y = lengthToUser(use.getAttribute('y'), vp.height);
      const t = [use.getAttribute('transform') ?? '', x || y ? `translate(${x} ${y})` : ''].join(' ').trim();
      if (t) g.setAttribute('transform', t);
      let clone: Element;
      if (ref.localName === 'symbol' || ref.localName === 'svg') {
        clone = doc.createElementNS(SVG_NS, 'svg');
        for (const attr of Array.from(ref.attributes)) {
          if (['x', 'y', 'width', 'height'].includes(attr.name)) continue;
          clone.setAttributeNS(attr.namespaceURI, attr.name, attr.value);
        }
        for (const dim of ['width', 'height']) {
          const v = use.getAttribute(dim) ?? ref.getAttribute(dim);
          if (v != null) clone.setAttribute(dim, v);
        }
        if (ref.localName === 'svg') {
          for (const pos of ['x', 'y']) {
            const v = ref.getAttribute(pos);
            if (v != null) clone.setAttribute(pos, v);
          }
        }
        for (const c of Array.from(ref.childNodes)) clone.appendChild(c.cloneNode(true));
      } else {
        clone = ref.cloneNode(true) as Element;
      }
      g.appendChild(clone);
      use.replaceWith(g);
    }
  }
  return dropped;
}
