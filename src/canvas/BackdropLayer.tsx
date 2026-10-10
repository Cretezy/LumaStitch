// SPDX-License-Identifier: GPL-3.0-or-later
/** The original imported artwork as a locked reference layer (rendered via <img>, which never runs scripts). */
import { useEffect, useMemo, useState } from 'react';
import { artworkImageRect } from '@/io/svg-import';
import { compose, translate } from '@/geom/matrix';
import type { Matrix } from '@/model/types';
import { useDoc } from '@/store/documentStore';
import { useUi } from '@/store/uiStore';

export function BackdropLayer() {
  const artwork = useDoc((s) => s.design?.artwork);
  const viewport = useUi((s) => s.viewport);
  const show = useUi((s) => s.view.backdrop);
  const viewMode = useUi((s) => s.viewMode);
  const [url, setUrl] = useState<string | null>(null);

  const src = artwork?.kind === 'svg' ? artwork.svg : artwork?.kind === 'image' ? artwork.dataUrl : null;
  useEffect(() => {
    if (!artwork || !src) {
      setUrl(null);
      return;
    }
    if (artwork.kind === 'image') {
      setUrl(src);
      return;
    }
    const u = URL.createObjectURL(new Blob([src], { type: 'image/svg+xml' }));
    setUrl(u);
    return () => URL.revokeObjectURL(u);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  const rect = useMemo(() => {
    if (!artwork) return null;
    if (artwork.kind === 'svg') {
      try {
        return artworkImageRect(artwork.svg);
      } catch {
        return null;
      }
    }
    return { x: 0, y: 0, width: artwork.pxWidth, height: artwork.pxHeight };
  }, [artwork]);

  if (!artwork || !url || !rect || !show || !artwork.visible) return null;
  const v: Matrix = [viewport.zoom, 0, 0, viewport.zoom, viewport.pan[0], viewport.pan[1]];
  const m = compose(v, artwork.matrix, translate(rect.x, rect.y));
  const opacity = viewMode === 'artwork' ? artwork.opacity : artwork.opacity * 0.6;
  return (
    <img
      src={url}
      alt=""
      draggable={false}
      className="pointer-events-none absolute top-0 left-0 max-w-none origin-top-left select-none"
      style={{ width: rect.width, height: rect.height, transform: `matrix(${m.join(',')})`, opacity }}
    />
  );
}
