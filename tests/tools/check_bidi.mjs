// SPDX-License-Identifier: GPL-3.0-or-later
/** node tests/tools/check_bidi.mjs /path/to/Unicode17/UCD */
import {readFileSync} from 'node:fs';
import {getEmbeddingLevels,getReorderedIndices} from '../../src/lettering/vendor/bidi/index.js';
const file=readFileSync(`${process.argv[2]}/BidiCharacterTest.txt`,'utf8');
let checked=0,failed=0;
for(const raw of file.split('\n')){
  const line=raw.split('#')[0].trim();if(!line)continue;
  const [codes,dir,base,lv,reorder]=line.split(';').map(s=>s.trim());
  const text=String.fromCodePoint(...codes.split(/\s+/).map(s=>parseInt(s,16))),expected=lv.split(/\s+/),levels=getEmbeddingLevels(text,['ltr','rtl','auto'][+dir]);
  const order=getReorderedIndices(text,levels).filter(i=>expected[i]!=='x');
  const wanted=reorder?reorder.split(/\s+/).map(Number):[];
  checked++;
  if(levels.paragraphs[0].level!==+base||expected.some((v,i)=>v!=='x'&&+v!==levels.levels[i])||JSON.stringify(order)!==JSON.stringify(wanted)){
    if(failed++<5)console.error({codes,dir,expected,actual:[...levels.levels],wanted,order});
  }
}
console.log({checked,failed});if(failed)process.exitCode=1;
const representatives={L:'A',R:'א',AL:'ا',EN:'0',ES:'+',ET:'$',AN:'٠',CS:',',B:'\u2029',S:'\t',WS:' ',ON:'!',BN:'\u00ad',NSM:'\u0300',LRE:'\u202a',RLE:'\u202b',LRO:'\u202d',RLO:'\u202e',PDF:'\u202c',LRI:'\u2066',RLI:'\u2067',FSI:'\u2068',PDI:'\u2069'};
let expected=[],wanted=[],typesChecked=0,typesFailed=0;
for(const raw of readFileSync(`${process.argv[2]}/BidiTest.txt`,'utf8').split('\n')){
  const line=raw.split('#')[0].trim();if(!line)continue;
  if(line.startsWith('@Levels:')){expected=line.slice(8).trim().split(/\s+/);continue;}
  if(line.startsWith('@Reorder:')){const body=line.slice(9).trim();wanted=body?body.split(/\s+/).map(Number):[];continue;}
  if(line.startsWith('@'))continue;
  const [types,mask]=line.split(';').map(s=>s.trim()),text=types.split(/\s+/).map(t=>representatives[t]).join('');
  for(const [bit,dir] of [[1,'auto'],[2,'ltr'],[4,'rtl']])if(+mask&bit){
    const levels=getEmbeddingLevels(text,dir),order=getReorderedIndices(text,levels).filter(i=>expected[i]!=='x');typesChecked++;
    if(expected.some((v,i)=>v!=='x'&&+v!==levels.levels[i])||JSON.stringify(order)!==JSON.stringify(wanted)){
      if(typesFailed++<5)console.error({types,dir,expected,actual:[...levels.levels],wanted,order});
    }
  }
}
console.log({typesChecked,typesFailed});if(typesFailed)process.exitCode=1;
