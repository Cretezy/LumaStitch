// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { buildPlan } from '@/engine/plan';
import { createDesign } from '@/model/factories';
import { geomBBox } from '@/model/geomOps';
import { DEFAULT_LETTERING, FONT_CHARACTERS, layoutLettering } from './layout';

describe('digitized lettering', () => {
  it('generates every licensed glyph without invalid rails or empty output', () => {
    for (const char of FONT_CHARACTERS) {
      const d = createDesign();
      d.threads.t = { id: 't', name: 'Blue', color: '#123456' };
      const shapes = layoutLettering({ ...DEFAULT_LETTERING, text: char }, 't', '#123456');
      for (const s of shapes) {
        d.shapes[s.id] = s;
        d.zOrder.push(s.id);
        d.sequence.push({ kind: 'element', elementId: s.outline!.id });
      }
      const p = buildPlan(d);
      expect(
        p.diagnostics.filter((v) => v.code === 'satin-rails'),
        char,
      ).toEqual([]);
      expect(p.stats.stitches, char).toBeGreaterThan(5);
    }
  });
  it('uses kerning and regenerates at size instead of scaling needle coordinates', () => {
    const a = layoutLettering({ ...DEFAULT_LETTERING, text: 'AV' }, 't', '#123456');
    const b = layoutLettering({ ...DEFAULT_LETTERING, text: 'AV', letterSpacing: 2 }, 't', '#123456');
    expect(geomBBox(b.at(-1)!.geom).minX - geomBBox(a.at(-1)!.geom).minX).toBeCloseTo(2);
    const big = layoutLettering({ ...DEFAULT_LETTERING, text: 'AV', height: 20 }, 't', '#123456');
    expect(geomBBox(big[0].geom).minX).toBeCloseTo(geomBBox(a[0].geom).minX * 2);
  });
  it('rejects unsupported letters and invalid layouts without silently dropping text', () => {
    expect(() => layoutLettering({ ...DEFAULT_LETTERING, text: '你好' }, 't', '#123456')).toThrow('no glyph');
    expect(() =>
      layoutLettering({ ...DEFAULT_LETTERING, text: 'A\nB', arcAngle: 60 }, 't', '#123456'),
    ).toThrow('one line');
  });
});
