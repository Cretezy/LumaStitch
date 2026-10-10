// SPDX-License-Identifier: GPL-3.0-or-later
/** SVG editing overlay in screen space: selection box + handles, nodes, marquee, tool previews, markers. */
import { useEffect, useState } from 'react';
import { flattenSubpath } from '@/geom/flatten';
import { cumulativeLengths, pointAtLength } from '@/geom/polyline';
import { buildElementIndex, getElement } from '@/model/factories';
import type { Design, Matrix, PathGeom, Vec2 } from '@/model/types';
import { selectedElementIds } from '@/store/commands';
import { useDoc } from '@/store/documentStore';
import { usePlan } from '@/store/planStore';
import { useUi, type Viewport } from '@/store/uiStore';
import { sim } from '@/simulator/controller';
import { F } from '@/engine/types';
import { selectionBBox } from '@/tools/selection';
import { useToolState } from '@/tools/toolState';
import { geomToD } from './pathD';

const ACCENT = '#4f46e5';

function S(v: Viewport, p: Vec2): Vec2 {
  return [p[0] * v.zoom + v.pan[0], p[1] * v.zoom + v.pan[1]];
}

function SelectionBox({ design, v }: { design: Design; v: Viewport }) {
  const sel = useUi((s) => s.selection.shapeIds);
  const preview = useUi((s) => s.dragPreview);
  const tool = useUi((s) => s.tool);
  const m: Matrix | null = preview?.kind === 'transform' ? preview.matrix : null;
  const b = selectionBBox(design, sel, m);
  if (!b) return null;
  const [x0, y0] = S(v, [b.minX, b.minY]);
  const [x1, y1] = S(v, [b.maxX, b.maxY]);
  const handles: [string, number, number][] = [
    ['nw', x0, y0],
    ['n', (x0 + x1) / 2, y0],
    ['ne', x1, y0],
    ['e', x1, (y0 + y1) / 2],
    ['se', x1, y1],
    ['s', (x0 + x1) / 2, y1],
    ['sw', x0, y1],
    ['w', x0, (y0 + y1) / 2],
  ];
  const cursors: Record<string, string> = {
    nw: 'nwse-resize',
    se: 'nwse-resize',
    ne: 'nesw-resize',
    sw: 'nesw-resize',
    n: 'ns-resize',
    s: 'ns-resize',
    e: 'ew-resize',
    w: 'ew-resize',
  };
  const showHandles = tool === 'select' && !preview;
  return (
    <g>
      <rect
        x={x0}
        y={y0}
        width={x1 - x0}
        height={y1 - y0}
        fill="none"
        stroke={ACCENT}
        strokeWidth={1}
        pointerEvents="none"
      />
      {sel.map((id) => {
        const s = design.shapes[id];
        if (!s || (preview?.kind === 'transform' && m)) return null;
        return (
          <path
            key={id}
            d={geomToD(s.geom)}
            transform={`matrix(${v.zoom} 0 0 ${v.zoom} ${v.pan[0]} ${v.pan[1]})`}
            fill="none"
            stroke={ACCENT}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
            opacity={0.8}
          />
        );
      })}
      {showHandles &&
        handles
          .filter(
            ([h]) =>
              (x1 - x0 >= 20 || !(h === 'n' || h === 's')) && (y1 - y0 >= 20 || !(h === 'e' || h === 'w')),
          )
          .map(([h, hx, hy]) => (
            <g key={h}>
              {h.length === 2 && (
                <circle
                  cx={hx + (h.includes('e') ? 10 : -10)}
                  cy={hy + (h.includes('s') ? 10 : -10)}
                  r={11}
                  fill="transparent"
                  data-hit="handle"
                  data-handle={'rotate-' + h}
                  style={{ cursor: 'grab' }}
                />
              )}
              <rect
                x={hx - 4}
                y={hy - 4}
                width={8}
                height={8}
                fill="white"
                stroke={ACCENT}
                strokeWidth={1.2}
                data-hit="handle"
                data-handle={h}
                style={{ cursor: cursors[h] }}
              />
            </g>
          ))}
    </g>
  );
}

function NodeHandles({ design, v }: { design: Design; v: Viewport }) {
  const sel = useUi((s) => s.selection);
  const preview = useUi((s) => s.dragPreview);
  const out: React.ReactNode[] = [];
  for (const sid of sel.shapeIds) {
    const shape = design.shapes[sid];
    if (!shape || shape.locked) continue;
    const geom: PathGeom = preview?.kind === 'nodes' && preview.shapeId === sid ? preview.geom : shape.geom;
    geom.subpaths.forEach((sp, si) =>
      sp.nodes.forEach((n, ni) => {
        const p = S(v, n.p);
        const selected = sel.nodes.some((r) => r.shapeId === sid && r.sub === si && r.idx === ni);
        if (selected || sel.nodes.length === 0 || sel.nodes.some((r) => r.shapeId === sid)) {
          for (const which of ['in', 'out'] as const) {
            const h = n[which];
            if (!h || !selected) continue;
            const hp = S(v, [n.p[0] + h[0], n.p[1] + h[1]]);
            out.push(
              <g key={`${sid}-${si}-${ni}-${which}`}>
                <line
                  x1={p[0]}
                  y1={p[1]}
                  x2={hp[0]}
                  y2={hp[1]}
                  stroke={ACCENT}
                  strokeWidth={1}
                  pointerEvents="none"
                />
                <circle
                  cx={hp[0]}
                  cy={hp[1]}
                  r={3.5}
                  fill={ACCENT}
                  data-hit="ctrl"
                  data-shape={sid}
                  data-sub={si}
                  data-idx={ni}
                  data-which={which}
                  style={{ cursor: 'move' }}
                />
              </g>,
            );
          }
        }
        out.push(
          <rect
            key={`${sid}-${si}-${ni}`}
            x={p[0] - 3.5}
            y={p[1] - 3.5}
            width={7}
            height={7}
            rx={n.smooth ? 3.5 : 0}
            fill={selected ? ACCENT : 'white'}
            stroke={ACCENT}
            strokeWidth={1.2}
            data-hit="node"
            data-shape={sid}
            data-sub={si}
            data-idx={ni}
            style={{ cursor: 'move' }}
          />,
        );
      }),
    );
  }
  return <g>{out}</g>;
}

function ElementMarkers({ design, v }: { design: Design; v: Viewport }) {
  const tool = useUi((s) => s.tool);
  useToolState((s) => s.marker);
  useUi((s) => s.selection);
  const ids = selectedElementIds(design);
  if (ids.length !== 1) return null;
  const index = buildElementIndex(design);
  const ref = index.get(ids[0]);
  const el = getElement(design, ref);
  if (!el || !ref) return null;
  const out: React.ReactNode[] = [];
  const markerDrag = useToolState.getState().marker;
  const marker = (p0: Vec2, label: string, color: string, key: 'entry' | 'exit') => {
    const p = markerDrag && markerDrag.which === key && markerDrag.elementId === el.id ? markerDrag.p : p0;
    const [x, y] = S(v, p);
    out.push(
      <g key={key} data-hit={key} data-element={el.id} style={{ cursor: 'move' }}>
        <circle cx={x} cy={y} r={6} fill={color} stroke="white" strokeWidth={1.5} />
        <text x={x} y={y + 3.5} textAnchor="middle" fontSize={9} fontWeight={700} fill="white">
          {label}
        </text>
      </g>,
    );
  };
  if (el.entry) marker(el.entry, 'S', '#16a34a', 'entry');
  if (el.exit) marker(el.exit, 'E', '#dc2626', 'exit');
  if (el.type === 'satinFill' || tool === 'satinDirection') {
    (el.guides ?? []).forEach(([a, b], i) => {
      const [ax, ay] = S(v, a);
      const [bx, by] = S(v, b);
      out.push(
        <line
          key={'g' + i}
          x1={ax}
          y1={ay}
          x2={bx}
          y2={by}
          stroke="#ea580c"
          strokeWidth={2}
          strokeDasharray="5 3"
          pointerEvents="none"
        />,
      );
    });
    if (el.railSplit) {
      const shape = design.shapes[ref.shapeId];
      const sp = shape.geom.subpaths.find((s) => s.closed);
      if (sp) {
        const ring = flattenSubpath(sp);
        const closed = new Float64Array(ring.length + 2);
        closed.set(ring);
        closed[ring.length] = ring[0];
        closed[ring.length + 1] = ring[1];
        const cum = cumulativeLengths(closed);
        el.railSplit.forEach((t, i) => {
          const p = pointAtLength(closed, cum, t * cum[cum.length - 1]);
          const [x, y] = S(v, p);
          out.push(
            <rect
              key={'rs' + i}
              x={x - 5}
              y={y - 5}
              width={10}
              height={10}
              fill="#ea580c"
              stroke="white"
              transform={`rotate(45 ${x} ${y})`}
              pointerEvents="none"
            />,
          );
        });
      }
    }
  }
  return <g>{out}</g>;
}

function ToolPreview({ v }: { v: Viewport }) {
  const { pen, box, line } = useToolState();
  const marquee = useUi((s) => s.marquee);
  const out: React.ReactNode[] = [];
  if (marquee) {
    const [x0, y0] = S(v, marquee.a);
    const [x1, y1] = S(v, marquee.b);
    out.push(
      <rect
        key="marquee"
        x={Math.min(x0, x1)}
        y={Math.min(y0, y1)}
        width={Math.abs(x1 - x0)}
        height={Math.abs(y1 - y0)}
        fill="rgba(79,70,229,0.08)"
        stroke={ACCENT}
        strokeDasharray="4 3"
        pointerEvents="none"
      />,
    );
  }
  if (box) {
    const [x0, y0] = S(v, box.a);
    const [x1, y1] = S(v, box.b);
    out.push(
      box.kind === 'rect' ? (
        <rect
          key="box"
          x={x0}
          y={y0}
          width={x1 - x0}
          height={y1 - y0}
          fill="none"
          stroke={ACCENT}
          strokeWidth={1.5}
          pointerEvents="none"
        />
      ) : (
        <ellipse
          key="box"
          cx={(x0 + x1) / 2}
          cy={(y0 + y1) / 2}
          rx={(x1 - x0) / 2}
          ry={(y1 - y0) / 2}
          fill="none"
          stroke={ACCENT}
          strokeWidth={1.5}
          pointerEvents="none"
        />
      ),
    );
  }
  if (line) {
    const [x0, y0] = S(v, line.a);
    const [x1, y1] = S(v, line.b);
    out.push(
      <g key="line" pointerEvents="none">
        <line x1={x0} y1={y0} x2={x1} y2={y1} stroke="#ea580c" strokeWidth={2} />
        <circle cx={x0} cy={y0} r={3} fill="#ea580c" />
        {line.label && (
          <text x={x1 + 8} y={y1 - 8} fontSize={12} fontWeight={600} fill="#ea580c">
            {line.label}
          </text>
        )}
      </g>,
    );
  }
  if (pen && pen.nodes.length) {
    const geom: PathGeom = { fillRule: 'nonzero', subpaths: [{ closed: false, nodes: pen.nodes }] };
    out.push(
      <path
        key="pen"
        d={geomToD(geom)}
        transform={`matrix(${v.zoom} 0 0 ${v.zoom} ${v.pan[0]} ${v.pan[1]})`}
        fill="none"
        stroke={ACCENT}
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
        pointerEvents="none"
      />,
    );
    const last = pen.nodes[pen.nodes.length - 1].p;
    if (pen.hover && !pen.dragging) {
      const [x0, y0] = S(v, last);
      const [x1, y1] = S(v, pen.hover);
      out.push(
        <line
          key="penhover"
          x1={x0}
          y1={y0}
          x2={x1}
          y2={y1}
          stroke={ACCENT}
          strokeDasharray="3 3"
          pointerEvents="none"
        />,
      );
    }
    pen.nodes.forEach((n, i) => {
      const [x, y] = S(v, n.p);
      out.push(
        <rect
          key={'pn' + i}
          x={x - 3}
          y={y - 3}
          width={6}
          height={6}
          fill={i === 0 ? ACCENT : 'white'}
          stroke={ACCENT}
          pointerEvents="none"
        />,
      );
    });
  }
  return <g>{out}</g>;
}

function SimNeedle({ v }: { v: Viewport }) {
  const plan = usePlan((s) => s.plan);
  const [i, setI] = useState(() => Math.floor(sim.index));
  useEffect(() => sim.subscribe(setI), []);
  if (!plan || !plan.flags.length) return null;
  const k = Math.min(i, plan.flags.length - 1);
  const [x, y] = S(v, [plan.x[k], plan.y[k]]);
  // Upcoming jump, dashed.
  let jump: React.ReactNode = null;
  for (let j = k + 1; j < Math.min(plan.flags.length, k + 4); j++) {
    if (plan.flags[j] & F.JUMP) {
      const [jx, jy] = S(v, [plan.x[j], plan.y[j]]);
      jump = (
        <line
          x1={x}
          y1={y}
          x2={jx}
          y2={jy}
          stroke="#111"
          strokeDasharray="4 3"
          strokeWidth={1}
          opacity={0.6}
        />
      );
      break;
    }
    if (!(plan.flags[j] & (F.TRIM | F.COLOR_CHANGE | F.STOP))) break;
  }
  const block =
    plan.colorBlocks.find((b) => k >= b.start && k < b.end) ?? plan.colorBlocks[plan.colorBlocks.length - 1];
  return (
    <g pointerEvents="none">
      {jump}
      <line x1={x - 14} y1={y} x2={x + 14} y2={y} stroke="#111" strokeWidth={1} />
      <line x1={x} y1={y - 14} x2={x} y2={y + 14} stroke="#111" strokeWidth={1} />
      <circle cx={x} cy={y} r={5} fill={block?.color ?? '#000'} stroke="white" strokeWidth={1.5} />
    </g>
  );
}

/** Problem markers (FR-3.5) for diagnostics that carry a position; clicking selects the element. */
function DiagnosticMarkers({ v, design }: { v: Viewport; design: Design }) {
  const plan = usePlan((s) => s.plan);
  const show = useUi((s) => s.viewMode !== 'artwork');
  if (!plan || !show) return null;
  const index = buildElementIndex(design);
  return (
    <g>
      {plan.diagnostics
        .filter((d) => d.at && d.severity !== 'info')
        .slice(0, 200)
        .map((d, i) => {
          const [x, y] = S(v, d.at!);
          const color = d.severity === 'error' ? '#dc2626' : '#d97706';
          return (
            <g
              key={i}
              data-hit="diag"
              style={{ cursor: 'pointer' }}
              onPointerDown={(e) => {
                e.stopPropagation();
                const ref = d.elementId ? index.get(d.elementId) : undefined;
                if (ref)
                  useUi
                    .getState()
                    .setSelection({ shapeIds: [ref.shapeId], elementIds: [d.elementId!], nodes: [] });
                useUi.getState().set({ sidebarTab: 'issues' });
              }}
            >
              <title>{d.message}</title>
              <path
                d={`M${x} ${y - 9} L${x + 8} ${y + 5} L${x - 8} ${y + 5} Z`}
                fill={color}
                stroke="white"
                strokeWidth={1.5}
              />
              <text x={x} y={y + 3.5} textAnchor="middle" fontSize={9} fontWeight={800} fill="white">
                !
              </text>
            </g>
          );
        })}
    </g>
  );
}

export function OverlayLayer() {
  const design = useDoc((s) => s.design);
  const v = useUi((s) => s.viewport);
  const tool = useUi((s) => s.tool);
  const simActive = useUi((s) => s.sim.active);
  if (!design) return null;
  return (
    <svg className="pointer-events-none absolute inset-0 size-full overflow-visible [&_[data-hit]]:pointer-events-auto">
      {!simActive && <SelectionBox design={design} v={v} />}
      {!simActive && tool === 'direct' && <NodeHandles design={design} v={v} />}
      {!simActive && <ElementMarkers design={design} v={v} />}
      {!simActive && <ToolPreview v={v} />}
      {!simActive && <DiagnosticMarkers v={v} design={design} />}
      {simActive && <SimNeedle v={v} />}
    </svg>
  );
}
