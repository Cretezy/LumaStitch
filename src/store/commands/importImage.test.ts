// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { polylineGeom, rectGeom } from '@/geom/shapes';
import { createDesign, createElement, createShape, createThread } from '@/model/factories';
import { checkInvariants } from '@/model/invariants';
import type { Design, TraceSettings } from '@/model/types';
import type { TracedShape } from '@/raster/types';
import {
  IMAGE_CUTOUT_GROWTH,
  applyImageImport,
  imageBackdropMatrix,
  isTracedShape,
  outlineForStrokeWidth,
  tracedShapeIds,
  type ImageArtworkInput,
} from './importImage';

const trace: TraceSettings = {
  colors: 'auto',
  palette: [],
  background: 'auto',
  detail: 0.5,
  smoothness: 0.5,
  lineArt: true,
};

const artwork = (t: TraceSettings = trace): ImageArtworkInput => ({
  dataUrl: 'data:image/png;base64,AAAA',
  pxWidth: 200,
  pxHeight: 100,
  matrix: imageBackdropMatrix(200, 100, 90, 45),
  trace: t,
});

function traced(): TracedShape[] {
  return [
    { color: '#FF0000', geom: { ...rectGeom(-40, -20, 30, 20), fillRule: 'evenodd' }, paletteIndex: 1 },
    { color: '#00ff00', geom: { ...rectGeom(0, -20, 30, 20), fillRule: 'evenodd' }, paletteIndex: 2 },
    { color: '#ff0000', geom: { ...rectGeom(0, 5, 10, 10), fillRule: 'evenodd' }, paletteIndex: 1 },
    {
      color: '#000000',
      geom: polylineGeom([
        [-40, 15],
        [40, 15],
      ]),
      lineArt: true,
      strokeWidth: 0.4,
      paletteIndex: 3,
    },
    {
      color: '#000000',
      geom: polylineGeom([
        [-40, 18],
        [40, 18],
      ]),
      lineArt: true,
      strokeWidth: 1.4,
      paletteIndex: 3,
    },
  ];
}

describe('outlineForStrokeWidth', () => {
  it('classifies by width (SPEC §9 step 4)', () => {
    expect(outlineForStrokeWidth(0.3).type).toBe('running');
    expect(outlineForStrokeWidth(0.6).type).toBe('triple');
    expect(outlineForStrokeWidth(1.19).type).toBe('triple');
    expect(outlineForStrokeWidth(1.2)).toEqual({ type: 'satin', params: { width: 1.2 } });
    expect(outlineForStrokeWidth(7)).toEqual({ type: 'satin', params: { width: 7 } });
    expect(outlineForStrokeWidth(9)).toEqual({ type: 'satin', params: { width: 7 } });
    expect(outlineForStrokeWidth(Number.NaN).type).toBe('running');
  });
});

describe('imageBackdropMatrix', () => {
  it('maps the image centred on the origin', () => {
    const m = imageBackdropMatrix(200, 100, 90, 45);
    expect(m).toEqual([0.45, 0, 0, 0.45, -45, -22.5]);
  });
});

describe('applyImageImport', () => {
  it('creates threads, fills with cutout growth, line-art outlines, names and the backdrop', () => {
    const d = createDesign();
    const ids = applyImageImport(d, { shapes: traced() }, artwork(), { name: 'cat.png' });
    expect(ids).toHaveLength(5);
    expect(checkInvariants(d)).toEqual([]);
    expect(
      Object.values(d.threads)
        .map((t) => t.color)
        .sort(),
    ).toEqual(['#000000', '#00ff00', '#ff0000']);

    const shapes = ids.map((id) => d.shapes[id]);
    // Named after the dialog's swatch number (palette index + 1).
    expect(shapes.map((s) => s.name)).toEqual([
      'Colour 2',
      'Colour 3',
      'Colour 2 (part 2)',
      'Colour 4 line',
      'Colour 4 line (part 2)',
    ]);
    expect(shapes[0].fill).toMatchObject({ type: 'tatami', params: { cutoutGrowth: IMAGE_CUTOUT_GROWTH } });
    expect(shapes[0].art).toEqual({ fill: '#ff0000' });
    expect(shapes[0].fill!.threadId).toBe(shapes[2].fill!.threadId);
    expect(shapes[3].fill).toBeNull();
    expect(shapes[3].outline!.type).toBe('running');
    expect(shapes[3].art).toEqual({ stroke: '#000000', strokeWidth: 0.4 });
    expect(shapes[4].outline).toMatchObject({ type: 'satin', params: { width: 1.4 } });

    expect(d.zOrder).toEqual(ids);
    expect(d.sequence.map((e) => (e.kind === 'element' ? e.elementId : ''))).toEqual(
      shapes.map((s) => (s.fill ?? s.outline)!.id),
    );
    expect(d.artwork).toMatchObject({
      kind: 'image',
      pxWidth: 200,
      pxHeight: 100,
      visible: true,
      opacity: 0.35,
      trace,
    });
    expect(d.name).toBe('cat');
  });

  it('reuses an existing thread of the same colour', () => {
    const d = createDesign();
    const red = createThread('#ff0000', 'Red');
    d.threads[red.id] = red;
    const ids = applyImageImport(d, { shapes: traced() }, artwork());
    expect(d.shapes[ids[0]].fill!.threadId).toBe(red.id);
    expect(Object.keys(d.threads)).toHaveLength(3);
  });

  it('re-trace replaces the previous trace in place, as one mutation', () => {
    const d: Design = createDesign({ name: 'Patch' });
    // A hand-made shape below and above the traced ones.
    const blue = createThread('#0000ff');
    d.threads[blue.id] = blue;
    const below = createShape('Frame', rectGeom(-50, -30, 100, 60), { fill: '#0000ff' });
    below.fill = createElement('fill', 'tatami', blue.id);
    d.shapes[below.id] = below;
    d.zOrder.push(below.id);
    d.sequence.push({ kind: 'element', elementId: below.fill.id });

    const first = applyImageImport(d, { shapes: traced() }, artwork());

    const above = createShape('Text', rectGeom(-5, -5, 10, 10), { fill: '#0000ff' });
    above.fill = createElement('fill', 'tatami', blue.id);
    d.shapes[above.id] = above;
    d.zOrder.push(above.id);
    d.sequence.push({ kind: 'stop', id: 'stop1' }, { kind: 'element', elementId: above.fill.id });

    // Simulate auto-digitize having changed a fill to satin but kept the growth, and a rename.
    d.shapes[first[1]].fill!.type = 'satinFill';
    d.shapes[first[1]].name = 'Leaf';

    expect(tracedShapeIds(d)).toEqual(first);
    expect(isTracedShape(below)).toBe(false);

    const newTrace: TraceSettings = { ...trace, colors: 2, lineArt: false };
    const second = applyImageImport(
      d,
      {
        shapes: [
          { color: '#00ff00', geom: { ...rectGeom(-10, -10, 20, 20), fillRule: 'evenodd' }, paletteIndex: 0 },
        ],
      },
      artwork(newTrace),
      { replaceShapeIds: tracedShapeIds(d) },
    );
    expect(checkInvariants(d)).toEqual([]);
    for (const id of first) expect(d.shapes[id]).toBeUndefined();
    expect(d.zOrder).toEqual([below.id, ...second, above.id]);
    const seq = d.sequence.map((e) => (e.kind === 'element' ? e.elementId : e.id));
    expect(seq).toEqual([below.fill.id, d.shapes[second[0]].fill!.id, 'stop1', above.fill.id]);
    // Unused traced threads (red, black) are gone; blue and green remain.
    expect(
      Object.values(d.threads)
        .map((t) => t.color)
        .sort(),
    ).toEqual(['#0000ff', '#00ff00']);
    expect(d.artwork?.kind === 'image' && d.artwork.trace).toEqual(newTrace);
    expect(d.name).toBe('Patch');
  });

  it('skips empty traced shapes', () => {
    const d = createDesign();
    const ids = applyImageImport(
      d,
      { shapes: [{ color: '#123456', geom: { subpaths: [], fillRule: 'evenodd' }, paletteIndex: 0 }] },
      artwork(),
    );
    expect(ids).toEqual([]);
    expect(checkInvariants(d)).toEqual([]);
    expect(d.artwork?.kind).toBe('image');
  });
});
