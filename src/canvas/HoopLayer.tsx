// SPDX-License-Identifier: GPL-3.0-or-later
import { useMemo } from 'react';
import { useDoc } from '@/store/documentStore';
import { usePlan } from '@/store/planStore';
import { useUi } from '@/store/uiStore';
import { hoopFit } from '@/engine/hoop';

export function HoopLayer() {
  const hoop = useDoc((s) => s.design?.hoop);
  const plan = usePlan((s) => s.plan);
  const viewport = useUi((s) => s.viewport);
  const fit = useMemo(() => (hoop && plan?.stats.stitches ? hoopFit(plan, hoop) : null), [plan, hoop]);
  if (!hoop || !fit) return null;
  const { outside, center } = fit;
  const x = center[0] * viewport.zoom + viewport.pan[0],
    y = center[1] * viewport.zoom + viewport.pan[1];
  const width = (hoop.width - hoop.margin * 2) * viewport.zoom,
    height = (hoop.height - hoop.margin * 2) * viewport.zoom;
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      aria-label={outside ? 'Design exceeds sewing field' : 'Design fits sewing field'}
    >
      <g fill="none" stroke={outside ? '#dc2626' : '#64748b'} strokeWidth="1.5" strokeDasharray="7 4">
        {hoop.shape === 'ellipse' ? (
          <ellipse cx={x} cy={y} rx={Math.max(0, width / 2)} ry={Math.max(0, height / 2)} />
        ) : (
          <rect
            x={x - width / 2}
            y={y - height / 2}
            width={Math.max(0, width)}
            height={Math.max(0, height)}
          />
        )}
      </g>
      <text x={x - width / 2} y={y - height / 2 - 6} fill={outside ? '#dc2626' : '#64748b'} fontSize="11">
        {hoop.width} × {hoop.height} mm · {hoop.margin} mm margin{outside ? ' · does not fit' : ''}
      </text>
    </svg>
  );
}
