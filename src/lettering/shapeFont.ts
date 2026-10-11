// SPDX-License-Identifier: GPL-3.0-or-later
/** Worker-only TTF/OTF validation and OpenType shaping. */
import * as hb from 'harfbuzzjs';
import type { LetteringOptions, OpenTypeLettering } from '@/model/types';
import { shapingKey } from './opentype';

export function fontBytes(data: string): Uint8Array {
  if (data.length > 14_000_000) throw new Error('Fonts must be at most 10 MB.');
  return Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
}
export function encodeFont(bytes: Uint8Array): string {
  let value = '';
  for (let i = 0; i < bytes.length; i += 8192) value += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(value);
}
function faceFrom(bytes: Uint8Array): hb.Face {
  if (bytes.length < 12 || bytes.length > 10_000_000)
    throw new Error('Use a TTF/OTF font smaller than 10 MB.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    magic = view.getUint32(0);
  if (magic !== 0x00010000 && magic !== 0x4f54544f)
    throw new Error(
      'Use an individual TrueType or OpenType font (TTF/OTF). Collections and web fonts are not supported.',
    );
  const count = view.getUint16(4);
  if (!count || count > 256 || 12 + count * 16 > bytes.length)
    throw new Error('Invalid font table directory.');
  for (let i = 0; i < count; i++) {
    const start = view.getUint32(12 + i * 16 + 8),
      length = view.getUint32(12 + i * 16 + 12);
    if (start > bytes.length || length > bytes.length - start) throw new Error('Truncated font table.');
  }
  const face = new hb.Face(new hb.Blob(bytes));
  if (face.upem < 16 || face.upem > 16384) throw new Error('Font has no usable outline metrics.');
  return face;
}

export function inspectFont(bytes: Uint8Array, filename: string) {
  const face = faceFrom(bytes);
  return {
    name: (face.getName(4, 'en') || filename.replace(/\.[^.]+$/, '')).slice(0, 200),
    axes: Object.values(face.getAxisInfos())
      .filter((a) => !(a.flags & hb.AxisFlags.HIDDEN))
      .map((a) => ({ tag: a.tag, min: a.min, max: a.max, default: a.default })),
    data: encodeFont(bytes),
    license: face.getName(13, 'en') || '',
  };
}

export function prepareOpenType(o: LetteringOptions): LetteringOptions {
  if (o.font !== 'opentype') return o;
  if (!o.openType) throw new Error('Choose a font first.');
  if (!o.text.trim() || o.text.length > 1000) throw new Error('Enter between 1 and 1,000 characters.');
  const f = o.openType;
  const face = faceFrom(fontBytes(f.data)),
    font = new hb.Font(face),
    axes = face.getAxisInfos();
  const variations = Object.entries(f.variations).map(([tag, value]) => {
    if (!axes[tag] || !Number.isFinite(value) || value < axes[tag].min || value > axes[tag].max)
      throw new Error(`Invalid font variation: ${tag}.`);
    return new hb.Variation(tag, value);
  });
  font.setVariations(variations);
  const upem = face.upem,
    extents = font.hExtents();
  let count = 0,
    pathSize = 0;
  const paths = new Map<number, string>();
  const lines: NonNullable<OpenTypeLettering['prepared']>['lines'] = o.text
    .normalize('NFC')
    .split('\n')
    .map((line) => {
      // HarfBuzz shapes directional runs; it is not a paragraph bidi engine.
      // Reject mixed-direction runs instead of silently reversing numbers/Latin inside Arabic.
      const rtl = /[\p{Script=Arabic}\p{Script=Hebrew}]/u.test(line);
      if (rtl && /[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{Number}]/u.test(line))
        throw new Error(
          'Use separate text blocks for right-to-left scripts and Latin text or numbers. Mixed-direction paragraph layout is not supported yet.',
        );
      if (rtl && o.letterSpacing !== 0)
        throw new Error('Keep extra letter spacing at zero for connected right-to-left scripts.');
      if (/[\u202a-\u202e\u2066-\u2069\t\r]/u.test(line))
        throw new Error('Use plain text without bidi controls or tabs.');
      const buffer = new hb.Buffer();
      buffer.addText(line);
      buffer.guessSegmentProperties();
      if (f.direction !== 'auto')
        buffer.setDirection(f.direction === 'rtl' ? hb.Direction.RTL : hb.Direction.LTR);
      if (f.language) buffer.setLanguage(f.language);
      hb.shape(font, buffer);
      const infos = buffer.getGlyphInfos(),
        positions = buffer.getGlyphPositions();
      count += infos.length;
      if (count > 4000) throw new Error('Text exceeds the 4,000 shaped-glyph limit.');
      let x = 0;
      const glyphs = infos.map((info, i) => {
        if (!info.codepoint)
          throw new Error(`This font has no glyph for text near character ${info.cluster + 1}.`);
        let path = paths.get(info.codepoint);
        if (path === undefined) {
          path = font.glyphToPath(info.codepoint);
          paths.set(info.codepoint, path);
        }
        if (!path && !/^[\s\p{Cf}]$/u.test(String.fromCodePoint(line.codePointAt(info.cluster) ?? 32)))
          throw new Error(
            'This font has a character without vector outlines. Bitmap/color-only glyphs are not supported.',
          );
        pathSize += path.length;
        if (pathSize > 5_000_000) throw new Error('Font outlines are too complex for this text.');
        const p = positions[i],
          glyph = { id: info.codepoint, cluster: info.cluster, x: x + p.xOffset, y: p.yOffset, path };
        x += p.xAdvance;
        if (i + 1 < infos.length && infos[i + 1].cluster !== info.cluster)
          x += (o.letterSpacing * upem) / o.height;
        // HarfBuzz addText uses UTF-16 cluster offsets.
        if (line[info.cluster] === ' ') x += (o.wordSpacing * upem) / o.height;
        return glyph;
      });
      return { advance: x, glyphs };
    });
  if (!lines.some((l) => l.glyphs.some((g) => g.path)))
    throw new Error('This text has no vector outlines. Bitmap/color-only fonts are not supported.');
  return {
    ...o,
    openType: {
      ...f,
      prepared: {
        key: shapingKey(o),
        upem,
        leading: Math.max(upem, extents.ascender - extents.descender + extents.lineGap),
        lines,
      },
    },
  };
}
