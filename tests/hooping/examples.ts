// SPDX-License-Identifier: GPL-3.0-or-later
import { createDesign, createElement, createShape } from '@/model/factories';
import { compound, ellipseGeom, polylineGeom, rectGeom } from '@/geom/shapes';
import { splitHoopings } from '@/hooping/split';
export const hoopingOptions={width:100,height:100,margin:3,overlap:12};
export function hoopingSource(){
  const d=createDesign({name:'Three-hoop botanical border'});
  d.threads.green={id:'green',name:'Forest green',color:'#296450'};d.threads.gold={id:'gold',name:'Gold',color:'#cc9933'};
  const panel=createShape('Tatami panel with two holes',compound([rectGeom(0,0,200,38),ellipseGeom(25,19,8),ellipseGeom(175,19,8)]));panel.id='panel';panel.fill=createElement('fill','tatami','green',{density:0.6,stitchLength:3,underlay:'edge',pullComp:0,angle:35});panel.fill.id='panel-fill';d.shapes[panel.id]=panel;d.zOrder.push(panel.id);d.sequence.push({kind:'element',elementId:panel.fill.id});
  for(const [i,x] of [25,100,175].entries()){
    const flower=createShape(`Gold flower ${i+1}`,ellipseGeom(x,19,11),{strokeWidth:2});flower.id=`flower-${i}`;flower.outline=createElement('outline','satin','gold',{width:2,density:0.4,pullComp:0.1});flower.outline.id=`flower-outline-${i}`;d.shapes[flower.id]=flower;d.zOrder.push(flower.id);d.sequence.push({kind:'element',elementId:flower.outline.id});
  }
  for(const [i,y] of [-5,43].entries()){
    const line=createShape('Gold border',polylineGeom([[0,y],[200,y]]),{strokeWidth:2});line.id=`border-${i}`;line.outline=createElement('outline','satin','gold',{width:2,density:0.4});line.outline.id=`border-outline-${i}`;d.shapes[line.id]=line;d.zOrder.push(line.id);d.sequence.push({kind:'element',elementId:line.outline.id});
  }
  d.multiHoop=hoopingOptions;return d;
}
export function stitchExamples(){const source=hoopingSource();return [{name:'source-banner',design:source,optimize:false},...splitHoopings(source,hoopingOptions).map((p)=>({name:`hoop-${String(p.number).padStart(2,'0')}`,design:p.design,optimize:false}))];}
