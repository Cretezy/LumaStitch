// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { apply } from '@/geom/matrix';
import { geomArea, geomBounds } from '@/geom/paperAdapter';
import type { Shape, Vec2 } from '@/model/types';
import { artworkImageRect, importSvg, SvgImportError, type SvgImportResult } from './index';

interface ExpectedShape {
  name: string;
  bbox: [number, number, number, number];
  fill: string | null;
  stroke: string | null;
  strokeWidth: number | null;
  area?: number;
  subpaths?: number;
  closed?: boolean;
  fillRule?: 'nonzero' | 'evenodd';
}
interface Expected {
  description: string;
  shapes: ExpectedShape[];
  threads: string[];
  warnings: Record<string, number>;
  anchors?: { user: Vec2; shape: string; node: number }[];
}

const svgs = import.meta.glob('../../../tests/fixtures/svg/*.svg', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const specs = import.meta.glob('../../../tests/fixtures/svg/*.json', {
  import: 'default',
  eager: true,
}) as Record<string, Expected>;
const fixtures = Object.keys(svgs)
  .map((p) => ({
    name: p
      .split('/')
      .pop()!
      .replace(/\.svg$/, ''),
    svg: svgs[p],
    spec: specs[p.replace(/\.svg$/, '.json')],
  }))
  .sort((a, b) => a.name.localeCompare(b.name));
const fixture = (name: string) => fixtures.find((f) => f.name === name)!;

const TOL = 0.1; // mm
const near = (actual: number, expected: number, tol = TOL, label = '') =>
  expect(Math.abs(actual - expected), `${label}: ${actual} vs ${expected}`).toBeLessThanOrEqual(tol);

function unionBBox(shapes: ExpectedShape[]) {
  const b = shapes.reduce(
    (acc, s) => [
      Math.min(acc[0], s.bbox[0]),
      Math.min(acc[1], s.bbox[1]),
      Math.max(acc[2], s.bbox[2]),
      Math.max(acc[3], s.bbox[3]),
    ],
    [Infinity, Infinity, -Infinity, -Infinity],
  );
  return { minX: b[0], minY: b[1], maxX: b[2], maxY: b[3], cx: (b[0] + b[2]) / 2, cy: (b[1] + b[3]) / 2 };
}

function checkFixture(res: SvgImportResult, spec: Expected, scale = 1) {
  expect(res.shapes.map((s) => s.name)).toEqual(spec.shapes.map((s) => s.name));
  const u = unionBBox(spec.shapes);
  near(res.naturalSize.width, u.maxX - u.minX, TOL, 'natural width');
  near(res.naturalSize.height, u.maxY - u.minY, TOL, 'natural height');
  near(res.size.width, (u.maxX - u.minX) * scale, TOL, 'width');
  near(res.size.height, (u.maxY - u.minY) * scale, TOL, 'height');

  // Threads: one per unique colour, in first-use order, named by hex.
  expect(res.threads.map((t) => t.color)).toEqual(spec.threads);
  expect(res.threads.map((t) => t.name)).toEqual(spec.threads);
  const threadOf = (id: string) => res.threads.find((t) => t.id === id)?.color;

  spec.shapes.forEach((es, i) => {
    const s = res.shapes[i];
    const b = geomBounds(s.geom)!;
    const label = `${es.name}`;
    near(b.minX, (es.bbox[0] - u.cx) * scale, TOL, `${label} minX`);
    near(b.minY, (es.bbox[1] - u.cy) * scale, TOL, `${label} minY`);
    near(b.maxX, (es.bbox[2] - u.cx) * scale, TOL, `${label} maxX`);
    near(b.maxY, (es.bbox[3] - u.cy) * scale, TOL, `${label} maxY`);
    expect(s.art.fill ?? null, `${label} fill`).toBe(es.fill);
    expect(s.art.stroke ?? null, `${label} stroke`).toBe(es.stroke);
    if (es.strokeWidth == null) expect(s.art.strokeWidth).toBeUndefined();
    else near(s.art.strokeWidth!, es.strokeWidth * scale, 0.01, `${label} strokeWidth`);
    if (es.area != null)
      near(
        geomArea(s.geom),
        es.area * scale * scale,
        Math.max(TOL, es.area * scale * scale * 2e-3),
        `${label} area`,
      );
    if (es.subpaths != null) expect(s.geom.subpaths, label).toHaveLength(es.subpaths);
    if (es.closed != null)
      expect(
        s.geom.subpaths.every((sp) => sp.closed === es.closed),
        `${label} closed`,
      ).toBe(true);
    if (es.fillRule) expect(s.geom.fillRule).toBe(es.fillRule);
    // Default elements (ARCH §8.8).
    if (es.fill) {
      expect(s.fill?.role).toBe('fill');
      expect(s.fill?.type).toBe('tatami');
      expect(threadOf(s.fill!.threadId)).toBe(es.fill);
    } else {
      expect(s.fill, `${label} fill element`).toBeNull();
    }
    if (es.stroke) {
      expect(s.outline?.role).toBe('outline');
      expect(s.outline?.type).toBe('running');
      expect(threadOf(s.outline!.threadId)).toBe(es.stroke);
    } else {
      expect(s.outline).toBeNull();
    }
  });

  const warnings = Object.fromEntries(res.warnings.map((w) => [w.code, w.count]));
  expect(warnings).toEqual(spec.warnings);
  for (const w of res.warnings) expect(w.message.length).toBeGreaterThan(0);

  // Artwork backdrop: user units → mm must land exactly on the imported nodes.
  expect(res.artwork.kind).toBe('svg');
  expect(res.artwork.visible).toBe(true);
  expect(res.artwork.opacity).toBe(0.35);
  expect(artworkImageRect(res.artwork.svg)).not.toBeNull();
  for (const a of spec.anchors ?? []) {
    const shape = res.shapes.find((s) => s.name === a.shape)!;
    const node = shape.geom.subpaths[0].nodes[a.node].p;
    const p = apply(res.artwork.matrix, a.user);
    near(p[0], node[0], 1e-6, `${a.shape} anchor x`);
    near(p[1], node[1], 1e-6, `${a.shape} anchor y`);
  }
}

describe('importSvg fixtures (±0.1 mm)', () => {
  it('has fixtures with expectations', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(12);
    for (const f of fixtures) expect(f.spec, f.name).toBeDefined();
  });
  for (const f of fixtures) {
    it(`${f.name}: ${f.spec?.description ?? ''}`, () => {
      checkFixture(importSvg(f.svg), f.spec);
    });
  }
});

describe('importSvg placement and target size', () => {
  it('centres on the origin', () => {
    const res = importSvg(fixture('basic-shapes').svg);
    const b = res.shapes.map((s) => geomBounds(s.geom)!);
    const minX = Math.min(...b.map((x) => x.minX));
    const maxX = Math.max(...b.map((x) => x.maxX));
    const minY = Math.min(...b.map((x) => x.minY));
    const maxY = Math.max(...b.map((x) => x.maxY));
    near(minX + maxX, 0, 1e-9);
    near(minY + maxY, 0, 1e-9);
  });

  it('scales to a target width (aspect locked), incl. stroke widths and the artwork matrix', () => {
    const f = fixture('basic-shapes');
    const res = importSvg(f.svg, { targetWidth: 180 });
    near(res.size.width, 180, 1e-6);
    near(res.size.height, 85, 1e-6);
    near(res.naturalSize.width, 90, 1e-6);
    checkFixture(res, f.spec, 2);
  });

  it('scales to a target height', () => {
    const f = fixture('nested-transforms');
    const res = importSvg(f.svg, { targetHeight: 45 });
    near(res.size.height, 45, 1e-6);
    checkFixture(res, f.spec, 0.5);
  });

  it('targetWidth wins over targetHeight', () => {
    const res = importSvg(fixture('basic-shapes').svg, { targetWidth: 45, targetHeight: 1000 });
    near(res.size.width, 45, 1e-6);
  });

  it('normalises the artwork root so the image covers its viewBox exactly', () => {
    const res = importSvg(fixture('aspect-meet').svg);
    const r = artworkImageRect(res.artwork.svg)!;
    near(r.x, -5, 1e-9);
    near(r.y, 0, 1e-9);
    near(r.width, 20, 1e-9);
    near(r.height, 10, 1e-9);
    const root = new DOMParser().parseFromString(res.artwork.svg, 'image/svg+xml').documentElement;
    near(parseFloat(root.getAttribute('width')!), (100 * 96) / 25.4, 1e-6);
    near(parseFloat(root.getAttribute('height')!), (50 * 96) / 25.4, 1e-6);
    expect(root.getAttribute('preserveAspectRatio')).toBe('none');
  });
});

/** Render the artwork through <img> exactly as a canvas backdrop would and sample the pixel at a doc-mm point. */
async function sampleArtwork(res: SvgImportResult, pointsMm: Vec2[]): Promise<number[][]> {
  const url = URL.createObjectURL(new Blob([res.artwork.svg], { type: 'image/svg+xml' }));
  const img = new Image();
  img.src = url;
  await img.decode();
  const pxPerMm = 4;
  const W = 600;
  const H = 400;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  // screen = doc · zoom + pan, then doc = artwork.matrix · user.
  ctx.setTransform(pxPerMm, 0, 0, pxPerMm, W / 2, H / 2);
  const m = res.artwork.matrix;
  ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
  const r = artworkImageRect(res.artwork.svg)!;
  ctx.drawImage(img, r.x, r.y, r.width, r.height);
  URL.revokeObjectURL(url);
  return pointsMm.map(([x, y]) =>
    Array.from(ctx.getImageData(Math.round(x * pxPerMm + W / 2), Math.round(y * pxPerMm + H / 2), 1, 1).data),
  );
}

const centreOf = (s: Shape): Vec2 => {
  const b = geomBounds(s.geom)!;
  return [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
};

describe('artwork backdrop alignment (rendered via <img>)', () => {
  it('basic-shapes: pixels under each filled shape have its colour', async () => {
    const res = importSvg(fixture('basic-shapes').svg, { targetWidth: 120 });
    const names = ['box', 'rounded', 'dot', 'oval'];
    const shapes = names.map((n) => res.shapes.find((s) => s.name === n)!);
    const px = await sampleArtwork(res, shapes.map(centreOf));
    shapes.forEach((s, i) => {
      const hex =
        '#' +
        px[i]
          .slice(0, 3)
          .map((v) => v.toString(16).padStart(2, '0'))
          .join('');
      expect(hex, s.name).toBe(s.art.fill);
    });
    // Just outside the box (left of its min x) is transparent.
    const b = geomBounds(shapes[0].geom)!;
    const [outside] = await sampleArtwork(res, [[b.minX - 2, (b.minY + b.maxY) / 2]]);
    expect(outside[3]).toBe(0);
  });

  it('aspect-meet / aspect-slice: letterboxing and overflow line up', async () => {
    for (const name of ['aspect-meet', 'aspect-slice', 'nested-transforms']) {
      const res = importSvg(fixture(name).svg);
      const filled = res.shapes.filter((s) => s.art.fill);
      const px = await sampleArtwork(res, filled.map(centreOf));
      filled.forEach((s, i) => {
        const hex =
          '#' +
          px[i]
            .slice(0, 3)
            .map((v) => v.toString(16).padStart(2, '0'))
            .join('');
        if (name !== 'aspect-slice') expect(hex, `${name} ${s.name}`).toBe(s.art.fill);
        expect(px[i][3], `${name} ${s.name} alpha`).toBe(255);
      });
    }
  });
});

describe('importSvg safety and robustness', () => {
  it('sanitises: no scripts run, no handlers / external refs / foreignObject in the artwork', () => {
    const w = window as unknown as { __svgImportPwned?: boolean };
    delete w.__svgImportPwned;
    const res = importSvg(fixture('unsupported').svg);
    expect(w.__svgImportPwned).toBeUndefined();
    expect(res.artwork.svg).not.toMatch(/<script|onclick|foreignObject|example\.com|<animate/i);
    expect(res.artwork.svg).toMatch(/data:image\/png/);
  });

  it('cleans up the off-screen mount', () => {
    const before = document.body.innerHTML;
    importSvg(fixture('css-classes').svg);
    expect(document.body.innerHTML).toBe(before);
  });

  it('rejects non-SVG input', () => {
    expect(() => importSvg('hello world')).toThrow(SvgImportError);
    expect(() => importSvg('<html><body><p>no svg</p></body></html>')).toThrow(SvgImportError);
  });

  it('accepts sloppy markup via the HTML parser fallback', () => {
    const res = importSvg(
      '<svg width="10mm" height="10mm" viewBox="0 0 10 10"><rect width="10" height="10" fill=red></svg>',
    );
    expect(res.shapes).toHaveLength(1);
    expect(res.shapes[0].art.fill).toBe('#ff0000');
    near(res.size.width, 10, 1e-6);
  });

  it('handles an empty SVG', () => {
    const res = importSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" width="20mm" height="10mm" viewBox="0 0 20 10"/>',
    );
    expect(res.shapes).toEqual([]);
    expect(res.threads).toEqual([]);
    expect(res.naturalSize).toEqual({ width: 0, height: 0 });
    // Backdrop is centred on the origin.
    const c = apply(res.artwork.matrix, [10, 5]);
    near(c[0], 0, 1e-9);
    near(c[1], 0, 1e-9);
  });

  it('keeps fill null for shapes without a closed subpath', () => {
    const res = importSvg(fixture('basic-shapes').svg);
    for (const s of res.shapes) if (!s.geom.subpaths.some((sp) => sp.closed)) expect(s.fill).toBeNull();
  });

  it('passes the name option through', () => {
    expect(importSvg(fixture('units-in').svg, { name: 'Logo' }).name).toBe('Logo');
  });
});
