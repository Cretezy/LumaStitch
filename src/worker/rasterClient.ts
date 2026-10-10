// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Client for the raster worker. One worker per image import dialog:
 *
 *   const raster = createRasterClient();
 *   const info = await loadImage(raster, await createImageBitmap(file), { width: 90 });
 *   const q = await raster.quantize({ colors: 'auto', preview: true, background: 'auto' });
 *   const traced = await raster.trace(settings, false);
 *   terminateRasterClient(raster);
 */
import * as Comlink from 'comlink';
import type { ImageInfo, RasterApi, RawImage } from '@/raster/types';

const workers = new WeakMap<object, Worker>();

/** Start a raster worker and return its Comlink proxy. */
export function createRasterClient(): Comlink.Remote<RasterApi> {
  const worker = new Worker(new URL('./raster.worker.ts', import.meta.url), {
    type: 'module',
    name: 'raster',
  });
  const remote = Comlink.wrap<RasterApi>(worker);
  workers.set(remote, worker);
  return remote;
}

/** Release the proxy and terminate its worker. Safe to call twice. */
export function terminateRasterClient(remote: Comlink.Remote<RasterApi>): void {
  const worker = workers.get(remote);
  if (!worker) return;
  workers.delete(remote);
  remote[Comlink.releaseProxy]();
  worker.terminate();
}

/**
 * `load` with zero-copy transfer: the ImageBitmap (or the raw pixel buffer) is moved to the worker and
 * becomes unusable on this side.
 */
export function loadImage(
  remote: Comlink.Remote<RasterApi>,
  image: ImageBitmap | RawImage,
  targetMm: { width?: number; height?: number },
): Promise<ImageInfo> {
  const transfer: Transferable[] =
    typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap
      ? [image]
      : [(image as RawImage).data.buffer];
  return remote.load(Comlink.transfer(image, transfer), targetMm);
}
