// SPDX-License-Identifier: GPL-3.0-or-later
import {createServer} from 'vite';import {writeFileSync} from 'node:fs';import {resolve} from 'node:path';
const server=await createServer({configFile:false,resolve:{alias:{'@':resolve('src')}},server:{watch:null,hmr:false,ws:false}});
try{
  const {objectSource,objectOptions}=await server.ssrLoadModule('/tests/hooping-objects/examples.ts');
  const {hoopingArchive}=await server.ssrLoadModule('/src/hooping/archive.ts');
  const metrics=[];
  for(const name of ['before','after']){
    const result=hoopingArchive(objectSource(),{...objectOptions,keepObjects:name==='after'},'pes');
    writeFileSync(`docs/hooping-objects/${name}.zip`,result.archive);writeFileSync(`docs/hooping-objects/${name}-layout.svg`,result.layout);
    writeFileSync(`docs/hooping-objects/${name}-manifest.json`,JSON.stringify(result.manifest,null,2)+'\n');
    metrics.push({name,hoopings:result.manifest.hoopings.length,sourceStitches:result.manifest.sourceStitches,stitches:result.manifest.hoopings.reduce((n,p)=>n+p.stats.stitches,0),trims:result.manifest.hoopings.reduce((n,p)=>n+p.stats.trims,0),wholeObjects:result.manifest.hoopings.flatMap(p=>p.wholeObjects).length});
  }
  writeFileSync('docs/hooping-objects/comparison.json',JSON.stringify(metrics,null,2)+'\n');console.log(metrics);
}finally{await server.close();}
