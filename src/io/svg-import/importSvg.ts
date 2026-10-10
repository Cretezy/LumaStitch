// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * SVG import (ARCHITECTURE §8, SPEC §3.1 / FR-1.1 / FR-1.1a). Main thread only: it needs the
 * DOM (DOMParser, DOMPurify, getComputedStyle) and Paper.
 *
 * Pipeline: sanitise → mount in an off-screen shadow root (so `<style>` rules apply without
 * leaking into the app) → root userToMm → expand `<use>` → walk in paint order, building one
 * shape per visible geometry element (matrix = userToMm × ancestors × own; computed style) →
 * names → threads → default elements → centre on the origin and scale to the target size →
 * artwork backdrop → unmount.
 */
import { invert, multiply, apply as applyMatrix, scaleFactor } from '@/geom/matrix';
import {
  clipGeom,
  geomArea,
  geomsBounds,
  parsePathDataPaper,
  transformGeom,
  JOIN_TOLERANCE,
} from '@/geom/paperAdapter';
import { createElement, createShape, createThread, hasClosedSubpath } from '@/model/factories';
import type { Artwork, Matrix, PathGeom, Shape, Subpath, Thread } from '@/model/types';
import { clipRegion } from './clip';
import { SVG_NS, sanitizeSvg } from './sanitize';
import { GEOMETRY_TAGS, shapeToPathData, type Viewport } from './shapes';
import { parseOpacity, resolvePaint } from './styles';
import { elementTransform, expandUses, groupName, ownName } from './tree';
import {
  MM_PER_PX,
  lengthToUser,
  parsePreserveAspectRatio,
  parseViewBox,
  rootViewport,
  viewBoxTransform,
} from './units';

export interface ImportWarning {
  code: string;
  message: string;
  count: number;
}

export interface SvgImportOptions {
  /** Target width in mm (aspect locked). Takes precedence over `targetHeight`. */
  targetWidth?: number;
  /** Target height in mm (aspect locked). */
  targetHeight?: number;
  /** Optional name (currently informational; returned unchanged as `name`). */
  name?: string;
}

export interface SvgImportResult {
  /** In paint order (= zOrder bottom → top); geometry in mm, centred on the origin, scaled to the target size. */
  shapes: Shape[];
  /** One per unique colour (#rrggbb, exact), name = hex. */
  threads: Thread[];
  /** Skipped / approximated features, aggregated by code. */
  warnings: ImportWarning[];
  /**
   * Backdrop. `matrix` maps root SVG user units → document mm. `svg` is the sanitised text with
   * its root normalised so that its `viewBox` is exactly the user-space rectangle covered by the
   * image (width/height in px, preserveAspectRatio="none"): draw it with
   * `ctx.transform(...matrix); ctx.drawImage(img, vb.x, vb.y, vb.width, vb.height)` — see
   * `artworkImageRect`.
   */
  artwork: Artwork & { kind: 'svg' };
  /** Size in mm before target scaling (bounds of all shapes, strokes excluded). */
  naturalSize: { width: number; height: number };
  /** Final size in mm. */
  size: { width: number; height: number };
  name?: string;
}

const MESSAGES: Record<string, string> = {
  text: 'Text is not supported. Convert text to outlines (paths) before importing.',
  image: 'Embedded images were ignored (digitizing embedded images is not available yet).',
  filter: 'Filters were ignored.',
  mask: 'Masks were ignored.',
  pattern: 'Pattern fills were replaced by a flat colour.',
  marker: 'Markers (arrowheads etc.) were ignored.',
  foreignObject: 'foreignObject content was removed.',
  script: 'Scripts were removed.',
  animation: 'Animations were ignored.',
  gradient: 'Gradients were approximated by the average colour of their stops.',
  clipPath: 'A clip-path could not be applied and was ignored.',
  use: 'A <use> reference could not be resolved and was skipped.',
};

class Warnings {
  private counts = new Map<string, number>();
  add(code: string, n = 1) {
    if (n > 0) this.counts.set(code, (this.counts.get(code) ?? 0) + n);
  }
  list(): ImportWarning[] {
    return [...this.counts].map(([code, count]) => ({ code, message: MESSAGES[code] ?? code, count }));
  }
}

interface WalkCtx {
  /** Current user space → mm (before placement). */
  matrix: Matrix;
  vp: Viewport;
  names: string[];
  opacity: number;
  clips: PathGeom[];
}

interface RawShape {
  name: string;
  geom: PathGeom;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
}

/** Elements whose content is never rendered directly. */
const SKIP = new Set([
  'defs',
  'symbol',
  'clipPath',
  'mask',
  'marker',
  'pattern',
  'linearGradient',
  'radialGradient',
  'filter',
  'style',
  'title',
  'desc',
  'metadata',
  'script',
  'view',
  'font',
  'font-face',
  'cursor',
]);
const CONTAINERS = new Set(['g', 'a', 'switch']);

function closeFilledSubpaths(geom: PathGeom, filled: boolean): PathGeom {
  const subpaths: Subpath[] = [];
  for (const sp of geom.subpaths) {
    if (sp.nodes.length === 0) continue;
    if (!sp.closed && sp.nodes.length >= 2) {
      const a = sp.nodes[0];
      const b = sp.nodes[sp.nodes.length - 1];
      if (Math.hypot(a.p[0] - b.p[0], a.p[1] - b.p[1]) <= JOIN_TOLERANCE) {
        // Coincident ends: merge into a closed subpath.
        const nodes = sp.nodes.slice(0, -1);
        nodes[0] = { ...nodes[0] };
        if (b.in) nodes[0].in = b.in;
        else delete nodes[0].in;
        if (nodes.length >= 2) {
          subpaths.push({ closed: true, nodes });
          continue;
        }
      } else if (filled) {
        // SVG fills open subpaths as if closed.
        const closed = { closed: true, nodes: sp.nodes };
        if (geomArea({ fillRule: 'nonzero', subpaths: [closed] }) > 1e-9) {
          subpaths.push(closed);
          continue;
        }
      }
    }
    subpaths.push(sp);
  }
  return { fillRule: geom.fillRule, subpaths };
}

function lookupIn(root: DocumentFragment): (id: string) => Element | null {
  return (id) => {
    try {
      return (root as ShadowRoot).getElementById(id);
    } catch {
      return null;
    }
  };
}

/** Root-normalised artwork image rectangle (user units) of a stored artwork SVG. */
export function artworkImageRect(
  svg: string,
): { x: number; y: number; width: number; height: number } | null {
  const m = /<svg\b[^>]*?\sviewBox\s*=\s*(["'])([^"']*)\1/i.exec(svg);
  return m ? parseViewBox(m[2]) : null;
}

export function importSvg(text: string, opts: SvgImportOptions = {}): SvgImportResult {
  const warnings = new Warnings();
  const sanitized = sanitizeSvg(text);
  for (const [code, n] of Object.entries(sanitized.removed)) warnings.add(code, n);

  const root = rootViewport(sanitized.doc.documentElement);

  // Mount (ARCH §8.2) inside a shadow root: <style> rules apply but never leak to the app, and
  // the app's CSS does not reach the SVG. Inherited properties are reset on the host.
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText =
    'all: initial; position: fixed; left: -100000px; top: 0; width: 1px; height: 1px; overflow: hidden; ' +
    'pointer-events: none; color: #000; color-scheme: light; font-size: 16px;';
  const shadow = host.attachShadow({ mode: 'open' });
  const svgRoot = document.importNode(sanitized.doc.documentElement, true) as unknown as SVGSVGElement;
  shadow.appendChild(svgRoot);
  document.body.appendChild(host);

  const raw: RawShape[] = [];
  try {
    const lookup = lookupIn(shadow);
    warnings.add('use', expandUses(shadow, lookup, { width: root.userWidth, height: root.userHeight }));
    const tagCounts = new Map<string, number>();

    const walkChildren = (parent: Element, ctx: WalkCtx) => {
      for (const child of Array.from(parent.children)) {
        walk(child, ctx);
        if (parent.localName === 'switch') break; // render only the first child of <switch>
      }
    };

    const walk = (el: Element, ctx: WalkCtx): void => {
      if (el.namespaceURI !== SVG_NS) return;
      const tag = el.localName;
      if (SKIP.has(tag)) return;
      const cs = getComputedStyle(el);
      if (cs.display === 'none') return;
      if (tag === 'text') {
        warnings.add('text');
        return;
      }
      if (tag === 'image') {
        warnings.add('image');
        return;
      }
      const isContainer = CONTAINERS.has(tag) || tag === 'svg';
      if (!isContainer && !GEOMETRY_TAGS.has(tag)) return;

      const opacity = ctx.opacity * parseOpacity(cs.opacity);
      if (opacity <= 0) return;
      const filter = cs.getPropertyValue('filter');
      if (filter && filter !== 'none') warnings.add('filter');
      const mask = cs.getPropertyValue('mask-image') || cs.getPropertyValue('mask');
      if (mask && mask !== 'none' && /url\(/.test(mask)) warnings.add('mask');

      let matrix = multiply(ctx.matrix, elementTransform(el, cs));
      let vp = ctx.vp;
      if (tag === 'svg') {
        // Nested viewport.
        const x = lengthToUser(el.getAttribute('x'), vp.width);
        const y = lengthToUser(el.getAttribute('y'), vp.height);
        const w = lengthToUser(el.getAttribute('width') ?? '100%', vp.width);
        const h = lengthToUser(el.getAttribute('height') ?? '100%', vp.height);
        if (!(w > 0 && h > 0)) return;
        matrix = multiply(matrix, [1, 0, 0, 1, x, y]);
        const vb = parseViewBox(el.getAttribute('viewBox'));
        if (vb) {
          matrix = multiply(
            matrix,
            viewBoxTransform(vb, w, h, parsePreserveAspectRatio(el.getAttribute('preserveAspectRatio'))),
          );
          vp = { width: vb.width, height: vb.height };
        } else {
          vp = { width: w, height: h };
        }
      }

      let clips = ctx.clips;
      const clipValue = cs.getPropertyValue('clip-path');
      if (clipValue && clipValue !== 'none') {
        const m = /url\(\s*['"]?[^#'")]*#([^'")]+)['"]?\s*\)/.exec(clipValue);
        const clipEl = m ? lookup(m[1]) : null;
        if (!clipEl || clipEl.localName !== 'clipPath') {
          warnings.add('clipPath');
        } else {
          // userSpaceOnUse: the clip lives in the referencing element's user space (incl. its transform).
          const region = clipRegion(clipEl, el, matrix, vp);
          if (!region.ok) warnings.add('clipPath');
          else if (region.geom.subpaths.length === 0)
            return; // everything clipped away
          else clips = [...clips, region.geom];
        }
      }

      if (isContainer) {
        const gname = groupName(el);
        walkChildren(el, { matrix, vp, opacity, clips, names: gname ? [...ctx.names, gname] : ctx.names });
        return;
      }

      // ── Geometry element ──
      const index = (tagCounts.get(tag) ?? 0) + 1;
      tagCounts.set(tag, index);
      if (cs.visibility === 'hidden' || cs.visibility === 'collapse') return;
      const d = shapeToPathData(el, vp);
      if (!d) return;
      if (/^(path|line|polyline|polygon)$/.test(tag)) {
        if (
          ['marker-start', 'marker-mid', 'marker-end'].some(
            (p) => (cs.getPropertyValue(p) || 'none') !== 'none',
          )
        ) {
          warnings.add('marker');
        }
      }
      const fillRule = cs.getPropertyValue('fill-rule') === 'evenodd' ? 'evenodd' : 'nonzero';
      let geom = parsePathDataPaper(d, matrix, fillRule);
      if (!geom.subpaths.some((s) => s.nodes.length > 0)) return;

      const fill =
        tag === 'line'
          ? { color: null }
          : resolvePaint(
              cs.getPropertyValue('fill'),
              parseOpacity(cs.getPropertyValue('fill-opacity')),
              lookup,
            );
      let stroke = resolvePaint(
        cs.getPropertyValue('stroke'),
        parseOpacity(cs.getPropertyValue('stroke-opacity')),
        lookup,
      );
      const swRaw = cs.getPropertyValue('stroke-width') || '1';
      const swUser = lengthToUser(swRaw, Math.sqrt((vp.width ** 2 + vp.height ** 2) / 2), 1);
      if (!(swUser > 0)) stroke = { color: null };
      if (fill.warn) warnings.add(fill.warn);
      if (stroke.warn) warnings.add(stroke.warn);

      geom = closeFilledSubpaths(geom, !!fill.color);
      let hasFill = !!fill.color && hasClosedSubpath(geom);
      if (!hasFill && !stroke.color) return;

      for (const clip of clips) {
        const clipped = clipGeom(geom, clip, hasFill ? 'fill' : 'stroke');
        if (!clipped) return;
        geom = clipped;
      }
      hasFill = !!fill.color && hasClosedSubpath(geom);
      if (!hasFill && !stroke.color) return;

      const own = ownName(el) ?? `${tag} ${index}`;
      raw.push({
        name: [...ctx.names, own].join('/'),
        geom,
        fill: hasFill ? fill.color! : undefined,
        stroke: stroke.color ?? undefined,
        strokeWidth: stroke.color ? swUser * scaleFactor(matrix) : undefined,
      });
    };

    const rootCs = getComputedStyle(svgRoot);
    const rootOpacity = parseOpacity(rootCs.opacity);
    if (rootCs.display !== 'none' && rootOpacity > 0) {
      walkChildren(svgRoot, {
        matrix: root.userToMm,
        vp: { width: root.userWidth, height: root.userHeight },
        names: [],
        opacity: rootOpacity,
        clips: [],
      });
    }
  } finally {
    host.remove();
  }

  // ── Placement (ARCH §8.9): centre the bounding box on the origin, then scale about it. ──
  const bbox = geomsBounds(raw.map((r) => r.geom));
  const naturalSize = bbox
    ? { width: bbox.maxX - bbox.minX, height: bbox.maxY - bbox.minY }
    : { width: 0, height: 0 };
  let s = 1;
  if (opts.targetWidth && opts.targetWidth > 0 && naturalSize.width > 0)
    s = opts.targetWidth / naturalSize.width;
  else if (opts.targetHeight && opts.targetHeight > 0 && naturalSize.height > 0)
    s = opts.targetHeight / naturalSize.height;

  // Image rectangle in root user units (the whole <img> viewport).
  let rect: { x: number; y: number; width: number; height: number };
  let widthMm = root.widthMm;
  let heightMm = root.heightMm;
  if (root.viewBox && widthMm != null && heightMm != null) {
    const inv = invert(root.userToMm);
    const [x0, y0] = applyMatrix(inv, [0, 0]);
    const [x1, y1] = applyMatrix(inv, [widthMm, heightMm]);
    rect = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  } else {
    widthMm ??= Math.max(bbox ? bbox.maxX : 0, MM_PER_PX);
    heightMm ??= Math.max(bbox ? bbox.maxY : 0, MM_PER_PX);
    rect = { x: 0, y: 0, width: widthMm / MM_PER_PX, height: heightMm / MM_PER_PX };
  }
  const centre = bbox
    ? [(bbox.minX + bbox.maxX) / 2, (bbox.minY + bbox.maxY) / 2]
    : [widthMm / 2, heightMm / 2]; // nothing imported: centre the backdrop instead
  const place: Matrix = [s, 0, 0, s, -s * centre[0], -s * centre[1]];

  // ── Threads, shapes, default elements (ARCH §8.6–8.8). ──
  const threadsByColor = new Map<string, Thread>();
  const threadFor = (hex: string) => {
    let t = threadsByColor.get(hex);
    if (!t) {
      t = createThread(hex, hex);
      threadsByColor.set(hex, t);
    }
    return t;
  };
  const shapes: Shape[] = raw.map((r) => {
    const geom = transformGeom(r.geom, place);
    const art: Shape['art'] = {};
    if (r.fill) art.fill = r.fill;
    if (r.stroke) {
      art.stroke = r.stroke;
      art.strokeWidth = r.strokeWidth! * s;
    }
    const shape = createShape(r.name, geom, art);
    if (r.fill && hasClosedSubpath(geom)) shape.fill = createElement('fill', 'tatami', threadFor(r.fill).id);
    if (r.stroke) shape.outline = createElement('outline', 'running', threadFor(r.stroke).id);
    return shape;
  });

  // ── Artwork backdrop (ARCH §8.10): normalised root so the image maps exactly to `rect`. ──
  const svgEl = sanitized.doc.documentElement;
  const num = (v: number) => String(+v.toPrecision(12));
  svgEl.setAttribute('width', num(widthMm / MM_PER_PX));
  svgEl.setAttribute('height', num(heightMm / MM_PER_PX));
  svgEl.setAttribute('viewBox', [rect.x, rect.y, rect.width, rect.height].map(num).join(' '));
  svgEl.setAttribute('preserveAspectRatio', 'none');
  const artwork: Artwork & { kind: 'svg' } = {
    kind: 'svg',
    svg: new XMLSerializer().serializeToString(svgEl),
    matrix: multiply(place, root.userToMm),
    visible: true,
    opacity: 0.35,
  };

  return {
    shapes,
    threads: [...threadsByColor.values()],
    warnings: warnings.list(),
    artwork,
    naturalSize,
    size: { width: naturalSize.width * s, height: naturalSize.height * s },
    ...(opts.name != null ? { name: opts.name } : {}),
  };
}
