// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Test-only module worker for the "paper-core in a Web Worker" spike (see paperAdapter.ts
 * header and paperAdapter.browser.test.ts). Runs a few adapter operations and posts the results.
 */
import { booleanGeoms, geomArea, geomBounds, parsePathDataPaper, simplifyGeom } from './paperAdapter';

self.onmessage = () => {
  try {
    const a = parsePathDataPaper('M0 0 H10 V10 H0 Z');
    const b = parsePathDataPaper('M5 5 H15 V15 H5 Z');
    const circle = parsePathDataPaper('M10 0 A10 10 0 1 1 -10 0 A10 10 0 1 1 10 0 Z');
    const [u] = booleanGeoms('unite', [a, b]);
    const simplified = simplifyGeom(circle, 0.05);
    self.postMessage({
      ok: true,
      hasWindow: typeof (self as unknown as { window?: unknown }).window !== 'undefined',
      hasDocument: typeof (self as unknown as { document?: unknown }).document !== 'undefined',
      unionArea: geomArea(u),
      circleBounds: geomBounds(circle),
      simplifiedNodes: simplified.subpaths[0].nodes.length,
    });
  } catch (e) {
    self.postMessage({ ok: false, error: String((e as Error)?.stack ?? e) });
  }
};
