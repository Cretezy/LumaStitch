// SPDX-License-Identifier: GPL-3.0-or-later
import { createServer } from 'vite';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const server=await createServer({configFile:false,resolve:{alias:{'@':resolve('src')}},server:{watch:null,hmr:false,ws:false}});
try{
  const {placementSource,customOptions,gridOptions}=await server.ssrLoadModule('/tests/hooping-placements/examples.ts');
  const {hoopingArchive}=await server.ssrLoadModule('/src/hooping/archive.ts');
  const {buildPlan}=await server.ssrLoadModule('/src/engine/plan.ts');
  const plan=buildPlan(placementSource()),needles=[];
  for(let i=0;i<plan.flags.length;i++)if(!(plan.flags[i]&31))needles.push([Math.round(plan.x[i]*10)/10,Math.round(plan.y[i]*10)/10]);
  writeFileSync('docs/hooping-placements/source-needles.json',JSON.stringify(needles)+'\n');
  const metrics=[];
  for(const [name,options] of [['before',gridOptions],['after',customOptions]]){
    const result=hoopingArchive(placementSource(),options,'pes');
    writeFileSync(`docs/hooping-placements/${name}.zip`,result.archive);
    writeFileSync(`docs/hooping-placements/${name}-manifest.json`,JSON.stringify(result.manifest,null,2)+'\n');
    writeFileSync(`docs/hooping-placements/${name}-layout.svg`,result.layout);
    metrics.push({name,hoopings:result.manifest.hoopings.length,sourceStitches:result.manifest.sourceStitches,stitches:result.manifest.hoopings.reduce((n,p)=>n+p.stats.stitches,0),trims:result.manifest.hoopings.reduce((n,p)=>n+p.stats.trims,0),stops:result.manifest.hoopings.reduce((n,p)=>n+p.stats.stops,0)});
  }
  writeFileSync('docs/hooping-placements/comparison.json',JSON.stringify(metrics,null,2)+'\n');
  console.log(metrics);
}finally{await server.close();}
