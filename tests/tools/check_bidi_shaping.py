# SPDX-License-Identifier: GPL-3.0-or-later
"""Independent FriBidi + uharfbuzz check of mixed-lettering example glyphs and placement."""
import base64,ctypes,ctypes.util,json,unicodedata
from pathlib import Path
import uharfbuzz as hb
fb=ctypes.CDLL(ctypes.util.find_library('fribidi'))
u32,i32,u8=ctypes.c_uint32,ctypes.c_int,ctypes.c_uint8
fb.fribidi_get_bidi_type.argtypes=[u32];fb.fribidi_get_bidi_type.restype=u32
fb.fribidi_log2vis.argtypes=[ctypes.POINTER(u32),i32,ctypes.POINTER(u32),ctypes.POINTER(u32),ctypes.POINTER(i32),ctypes.POINTER(i32),ctypes.POINTER(u8)]
fb.fribidi_log2vis.restype=u8
print(ctypes.c_char_p.in_dll(fb,'fribidi_version_info').value.decode().splitlines()[0])
for path in sorted(Path('docs/bidi').glob('*/*.lumastitch')):
    o=json.loads(path.read_text())['design']['lettering']['text']['options'];f=o['openType']
    font=hb.Font(hb.Face(base64.b64decode(f['data'])));font.set_variations(f['variations'])
    for line,expected in zip(unicodedata.normalize('NFC',o['text']).split('\n'),f['prepared']['lines'],strict=True):
        assert all(ord(c)<=0xffff for c in line)  # These font fixtures use BMP scripts.
        n=len(line);logical=(u32*n)(*map(ord,line));visual=(u32*n)();l2v=(i32*n)();v2l=(i32*n)();levels=(u8*n)()
        base=u32(fb.fribidi_get_bidi_type(ord({'ltr':'A','rtl':'א','auto':'!'}[f['direction']])))
        assert fb.fribidi_log2vis(logical,n,ctypes.byref(base),visual,l2v,v2l,levels)
        scripts=[]
        for ch in line:
            buf=hb.Buffer();buf.add_str(ch);buf.guess_segment_properties();scripts.append(buf.script)
        # For these ordinary Latin/Arabic/Hebrew samples, shared marks inherit the prior script.
        current=next((s for s in scripts if s),None)
        for i,s in enumerate(scripts):
            if s:current=s
            scripts[i]=current
        runs=[]
        for i in range(n):
            if runs and runs[-1][2:]==[levels[i],scripts[i]]:runs[-1][1]=i+1
            else:runs.append([i,i+1,levels[i],scripts[i]])
        runs.sort(key=lambda r:min(l2v[r[0]:r[1]]))
        records=[]
        for start,end,level,script in runs:
            buf=hb.Buffer();buf.add_str(line,start,end-start);buf.direction='rtl'if level%2 else'ltr';buf.script=script
            if f['language']:buf.language=f['language']
            buf.flags=hb.BufferFlags.REMOVE_DEFAULT_IGNORABLES;hb.shape(font,buf)
            records.extend(zip(buf.glyph_infos,buf.glyph_positions))
        x=0;actual=[]
        for i,(info,pos)in enumerate(records):
            actual.append((info.codepoint,info.cluster,x+pos.x_offset,pos.y_offset));x+=pos.x_advance
            if i+1<len(records)and records[i+1][0].cluster!=info.cluster:x+=o['letterSpacing']*font.face.upem/o['height']
            if line[info.cluster]==' ':x+=o['wordSpacing']*font.face.upem/o['height']
        assert actual==[(g['id'],g['cluster'],g['x'],g['y'])for g in expected['glyphs']],(path,actual,expected)
        assert x==expected['advance']
    print(path.parent.name,': exact glyphs, clusters, positions and advance match independent FriBidi + HarfBuzz')
