// SPDX-License-Identifier: GPL-3.0-or-later
/** Original, editable examples in millimetres. Shared by baseline and current generators. */
import { compound, ellipseGeom, polylineGeom } from '@/geom/shapes';
import { createDesign, createElement, createShape, createThread } from '@/model/factories';
import type { Design, PathGeom, StitchType, Vec2 } from '@/model/types';

function add(
  design: Design,
  name: string,
  geom: PathGeom,
  type: StitchType,
  color: string,
  params: Record<string, number | string | boolean> = {},
) {
  const role = type === 'satin' ? 'outline' : 'fill';
  const threadId = color.slice(1);
  design.threads[threadId] ??= { ...createThread(color), id: threadId };
  const shape = createShape(name, geom);
  shape.id = name.toLowerCase().replaceAll(' ', '-');
  const el = createElement(role, type, threadId, params);
  el.id = shape.id + '-' + role;
  shape[role] = el;
  design.shapes[shape.id] = shape;
  design.zOrder.push(shape.id);
  design.sequence.push({ kind: 'element', elementId: el.id });
}

function curve(a: Vec2, b: Vec2, out: Vec2, input: Vec2): PathGeom {
  return {
    fillRule: 'nonzero',
    subpaths: [
      {
        closed: false,
        nodes: [
          { p: a, out },
          { p: b, in: input },
        ],
      },
    ],
  };
}

export function stitchExamples(): { name: string; design: Design }[] {
  const flower = createDesign({ name: 'Satin botanical' });
  // A compound element exercises even-pass edge+zigzag underlay on curved open columns.
  add(
    flower,
    'Stems',
    compound([
      curve([40, 76], [40, 34], [0, -18], [0, 14]),
      curve([39, 61], [24, 47], [-12, 0], [0, 7]),
      curve([41, 66], [57, 49], [13, 0], [0, 8]),
    ]),
    'satin',
    '#28745b',
    { width: 3, underlay: 'edgeZigzag', density: 0.4 },
  );
  add(
    flower,
    'Leaves',
    compound([curve([28, 54], [20, 40], [-8, 0], [0, 8]), curve([52, 59], [62, 43], [9, -1], [0, 8])]),
    'satin',
    '#5d9662',
    { width: 5, underlay: 'edgeZigzag', density: 0.4 },
  );
  const petals = Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4;
    const p = (r: number): Vec2 => [40 + Math.cos(a) * r, 25 + Math.sin(a) * r];
    return polylineGeom([p(6), p(17)]);
  });
  add(flower, 'Petals', compound(petals), 'satin', '#bd4b69', {
    width: 6,
    underlay: 'edgeZigzag',
    density: 0.4,
  });
  add(flower, 'Flower centre', ellipseGeom(40, 25, 5, 4), 'satinFill', '#d6a23b', {
    mode: 'fixed',
    angle: 90,
    underlay: 'edge',
    density: 0.4,
    splitAbove: 7,
  });

  const compass = createDesign({ name: 'Tatami compass' });
  add(
    compass,
    'Outer ring',
    compound([ellipseGeom(45, 45, 39), ellipseGeom(45, 45, 34)]),
    'tatami',
    '#285d78',
    { angle: 30, density: 0.4, underlay: 'edgeTatami' },
  );
  add(
    compass,
    'Cardinal points',
    compound([
      polylineGeom(
        [
          [45, 12],
          [37, 37],
          [45, 32],
        ],
        true,
      ),
      polylineGeom(
        [
          [78, 45],
          [53, 37],
          [58, 45],
        ],
        true,
      ),
      polylineGeom(
        [
          [45, 78],
          [53, 53],
          [45, 58],
        ],
        true,
      ),
      polylineGeom(
        [
          [12, 45],
          [37, 53],
          [32, 45],
        ],
        true,
      ),
    ]),
    'tatami',
    '#d59b34',
    { angle: 0, density: 0.4, underlay: 'tatami' },
  );
  add(
    compass,
    'Cardinal shadows',
    compound([
      polylineGeom(
        [
          [45, 12],
          [45, 32],
          [53, 37],
        ],
        true,
      ),
      polylineGeom(
        [
          [78, 45],
          [58, 45],
          [53, 53],
        ],
        true,
      ),
      polylineGeom(
        [
          [45, 78],
          [45, 58],
          [37, 53],
        ],
        true,
      ),
      polylineGeom(
        [
          [12, 45],
          [32, 45],
          [37, 37],
        ],
        true,
      ),
    ]),
    'tatami',
    '#a65b37',
    { angle: 90, density: 0.4, underlay: 'tatami' },
  );
  add(
    compass,
    'Compass hub',
    compound([ellipseGeom(45, 45, 10), ellipseGeom(45, 45, 4)]),
    'tatami',
    '#285d78',
    { angle: 45, density: 0.4, underlay: 'edgeTatami' },
  );
  add(
    compass,
    'Diagonal markers',
    compound(
      [
        [25, 25],
        [65, 25],
        [65, 65],
        [25, 65],
      ].map(([x, y]) => ellipseGeom(x, y, 2.5)),
    ),
    'tatami',
    '#d59b34',
    { angle: 0, density: 0.4, underlay: 'tatami' },
  );

  return [
    { name: 'satin-botanical', design: flower },
    { name: 'tatami-compass', design: compass },
  ];
}
