// SPDX-License-Identifier: GPL-3.0-or-later
import { createDesign, createElement, createShape } from '@/model/factories';
import { compound, ellipseGeom } from '@/geom/shapes';
import type { PathGeom } from '@/model/types';

export function guideGeometry(): PathGeom {
  return { fillRule:'nonzero', subpaths:[{closed:false,nodes:[
    {p:[-23,-8],out:[14,-4]}, {p:[0,0],in:[-10,-2],out:[10,2]}, {p:[23,8],in:[-14,4]},
  ]}]};
}
export function stitchExamples() {
  return (['parallel','copy','buffer'] as const).map((mode)=>{
    const design=createDesign({name:`Guided fill: ${mode}`});
    design.settings.maxStitchLength=3;
    design.threads.blue={id:'blue',name:'Blue',color:'#286e86'};
    const geom=compound([ellipseGeom(0,0,30,25),ellipseGeom(0,0,7,6),guideGeometry()],'evenodd');
    const s=createShape('Curved fill with a hole',geom,{fill:'#286e86'});s.id='guided';
    s.fill=createElement('fill','guidedFill','blue',{guideMode:mode,density:0.65,stitchLength:3,pullComp:0,underlay:'edgeTatami'});s.fill.id='guided-fill';
    design.shapes[s.id]=s;design.zOrder=[s.id];design.sequence=[{kind:'element',elementId:s.fill.id}];
    return {name:`guided-${mode}`,design,optimize:false};
  });
}
