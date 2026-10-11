// SPDX-License-Identifier: GPL-3.0-or-later
/** Synthetic, deterministic fixtures; no third-party artwork. Shared by both benchmark revisions. */
import { createDesign, createElement, createShape, createThread } from '@/model/factories';
import { compound, rectGeom, ellipseGeom } from '@/geom/shapes';
import type { Design, PathGeom } from '@/model/types';
import { stitchExamples } from './stitch-examples';

export function routingFixtures(): { name: string; design: Design }[] {
  const make = (
    name: string,
    geoms: PathGeom[],
    colors?: number[],
    outline = false,
    connectBranches = false,
  ) => {
    const design = createDesign();
    design.name = name;
    design.settings.defaultTie = 'never';
    const threads = ['#d44444', '#3366cc', '#55aa55'].map((c, i) => ({
      ...createThread(c),
      id: 'thread-' + i,
    }));
    for (const t of threads) design.threads[t.id] = t;
    geoms.forEach((g, i) => {
      const s = createShape('Part ' + i, g);
      s.id = 'shape-' + i;
      const el = createElement(
        outline ? 'outline' : 'fill',
        outline ? 'running' : 'tatami',
        threads[colors?.[i] ?? 0].id,
        { angle: 0, density: 0.4, underlay: 'none', pullComp: 0, connectBranches },
      );
      el.id = 'element-' + i;
      if (outline) s.outline = el;
      else s.fill = el;
      design.shapes[s.id] = s;
      design.zOrder.push(s.id);
      design.sequence.push({ kind: 'element', elementId: el.id });
    });
    return { name, design };
  };
  let state = 42;
  const random = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  const scattered = (n: number) =>
    Array.from({ length: n }, () => rectGeom(random() * 90, random() * 90, 2, 2));
  const result = [
    make(
      'colour-unlocking',
      [
        [7, 13, 7, 16],
        [3, 6, 12, 12],
        [21, 3, 13, 16],
        [13, 0, 10, 19],
        [27, 20, 16, 10],
        [4, 5, 7, 6],
        [15, 9, 9, 13],
        [14, 9, 17, 16],
        [20, 25, 15, 18],
        [4, 26, 18, 18],
      ].map(([x, y, w, h]) => rectGeom(x, y, w, h)),
      [2, 2, 1, 1, 0, 1, 2, 2, 0, 0],
    ),
    make('small-islands-12', scattered(12)),
    make('scattered-islands-48', scattered(48)),
    make(
      'three-colour-36',
      scattered(36),
      Array.from({ length: 36 }, (_, i) => i % 3),
    ),
    make(
      'overlapping-colours',
      Array.from({ length: 12 }, (_, i) => rectGeom((i % 4) * 10, Math.floor(i / 4) * 10, 14, 14)),
      Array.from({ length: 12 }, (_, i) => (i * 7) % 3),
    ),
    make('multipart-12', [compound(scattered(12))]),
    make('multipart-48', [compound(scattered(48))]),
    make('long-edge-joins', [
      rectGeom(0, 0, 80, 3),
      rectGeom(35, 6, 10, 3),
      rectGeom(0, 12, 80, 3),
      rectGeom(35, 18, 10, 3),
    ]),
    make('outline-loops', [compound(scattered(12))], undefined, true),
    make(
      'curved-holes',
      Array.from({ length: 6 }, (_, i) =>
        compound([
          ellipseGeom((i % 3) * 30, Math.floor(i / 3) * 35, 12, 10),
          ellipseGeom((i % 3) * 30, Math.floor(i / 3) * 35, 5, 4),
        ]),
      ),
    ),
    make(
      'connected-grid',
      [
        {
          fillRule: 'nonzero',
          subpaths: [
            ...Array.from({ length: 4 }, (_, i) => ({
              closed: false,
              nodes: [{ p: [0, i * 10] as [number, number] }, { p: [30, i * 10] as [number, number] }],
            })),
            ...Array.from({ length: 4 }, (_, i) => ({
              closed: false,
              nodes: [{ p: [i * 10, 0] as [number, number] }, { p: [i * 10, 30] as [number, number] }],
            })),
          ],
        },
      ],
      undefined,
      true,
      true,
    ),
    make('scale-128', scattered(128)),
    make(
      'open-strokes-12',
      [
        {
          fillRule: 'nonzero',
          subpaths: Array.from({ length: 12 }, () => ({
            closed: false,
            nodes: [
              { p: [random() * 90, random() * 90] as [number, number] },
              { p: [random() * 90, random() * 90] as [number, number] },
            ],
          })),
        },
      ],
      undefined,
      true,
    ),
  ];
  return [...result, ...stitchExamples()];
}
