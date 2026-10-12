// SPDX-License-Identifier: GPL-3.0-or-later
import { createDesign,createShape,createElement } from '@/model/factories';
import { rectGeom,ellipseGeom } from '@/geom/shapes';
import { splitHoopings } from '@/hooping/split';
export const objectOptions={width:100,height:100,margin:3,overlap:30};
export function objectSource(){
  const d=createDesign({name:'Whole satin medallions at hoop seams'});
  d.threads.green={id:'green',color:'#296450',name:'Forest green'};d.threads.gold={id:'gold',color:'#cc9933',name:'Gold'};
  const panel=createShape('Long running border',rectGeom(0,-14,160,28));panel.id='panel';panel.outline=createElement('outline','running','green',{stitchLength:2.5});panel.outline.id='panel-outline';d.shapes.panel=panel;d.zOrder.push(panel.id);d.sequence.push({kind:'element',elementId:panel.outline.id});
  for(const [i,x]of[48,112].entries()){
    const ring=createShape(`Medallion ${i+1}`,ellipseGeom(x,0,8));ring.id=`medallion-${i}`;
    ring.fill=createElement('fill','tatami','gold',{density:0.6,angle:90,underlay:'none',pullComp:0});ring.fill.id=`medallion-fill-${i}`;
    ring.outline=createElement('outline','satin','gold',{width:2,density:0.42,pullComp:0.1});ring.outline.id=`medallion-outline-${i}`;
    d.shapes[ring.id]=ring;d.zOrder.push(ring.id);d.sequence.push({kind:'element',elementId:ring.fill.id},{kind:'element',elementId:ring.outline.id});
  }
  d.multiHoop={...objectOptions,keepObjects:true};return d;
}
export function stitchExamples(){const d=objectSource();return [{name:'source-panel',design:d,optimize:false},...['before','after'].flatMap(name=>splitHoopings(d,{...objectOptions,keepObjects:name==='after'}).map(p=>({name:`${name}-hoop-${p.number}`,design:p.design,optimize:false})))];}
