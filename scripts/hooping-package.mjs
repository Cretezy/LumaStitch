// SPDX-License-Identifier: GPL-3.0-or-later
import { createServer } from 'vite';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const server=await createServer({configFile:false,resolve:{alias:{'@':resolve('src')}},server:{watch:null,hmr:false,ws:false}});
try{
  const {hoopingSource,hoopingOptions}=await server.ssrLoadModule('/tests/hooping/examples.ts');
  const {hoopingArchive}=await server.ssrLoadModule('/src/hooping/archive.ts');
  const result=hoopingArchive(hoopingSource(),hoopingOptions,'pes');
  writeFileSync('docs/hooping/multi-hooping.zip',result.archive);
  writeFileSync('docs/hooping/manifest.json',JSON.stringify(result.manifest,null,2)+'\n');
  writeFileSync('docs/hooping/layout.svg',result.layout);
}finally{await server.close();}
