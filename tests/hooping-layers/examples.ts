// SPDX-License-Identifier: GPL-3.0-or-later
import { createDesign, createShape, createElement } from '@/model/factories';
import { rectGeom, ellipseGeom, polylineGeom } from '@/geom/shapes';
import { splitHoopings } from '@/hooping/split';
import type { Vec2 } from '@/model/types';
export const layerOptions = {width:100,height:100,margin:3,overlap:30};
export function layerSource() {
  const d = createDesign({name:'Layered gold and cream badges at hoop seams'});
  d.threads.green = {id:'green',color:'#296450',name:'Forest green'};
  d.threads.gold = {id:'gold',color:'#c89432',name:'Gold'};
  d.threads.cream = {id:'cream',color:'#eee0bb',name:'Cream'};
  const border = createShape('Long running border',rectGeom(0,-14,160,28));
  border.id='panel';border.outline=createElement('outline','running','green',{stitchLength:2.5});border.outline.id='panel-outline';
  d.shapes.panel=border;d.zOrder.push(border.id);d.sequence.push({kind:'element',elementId:border.outline.id});
  for (const [i,x] of [48,112].entries()) {
    const disk=createShape(`Badge ${i+1} gold background`,ellipseGeom(x,0,8),{fill:'#c89432'});
    disk.id=`background-${i}`;disk.fill=createElement('fill','tatami','gold',{density:0.6,angle:90,underlay:'none',pullComp:0});disk.fill.id=`background-fill-${i}`;
    d.shapes[disk.id]=disk;d.zOrder.push(disk.id);d.sequence.push({kind:'element',elementId:disk.fill.id});
  }
  for (const [i,x] of [48,112].entries()) {
    const points:Vec2[]=Array.from({length:10},(_,j)=>{const a=j*Math.PI/5-Math.PI/2,r=j%2?2.6:5.8;return[x+Math.cos(a)*r,Math.sin(a)*r];});
    const star=createShape(`Badge ${i+1} cream star`,polylineGeom(points,true),{stroke:'#eee0bb',strokeWidth:1.2});
    star.id=`star-${i}`;star.outline=createElement('outline','satin','cream',{width:1.2,density:0.42,underlay:'center',pullComp:0.05});star.outline.id=`star-outline-${i}`;
    d.shapes[star.id]=star;d.zOrder.push(star.id);d.sequence.push({kind:'element',elementId:star.outline.id});
  }
  d.multiHoop={...layerOptions,keepObjects:true};return d;
}
export function stitchExamples(){const d=layerSource();return[{name:'source-panel',design:d,optimize:false},...['before','after'].flatMap(name=>splitHoopings(d,{...layerOptions,keepObjects:name==='after'}).map(p=>({name:`${name}-hoop-${p.number}`,design:p.design,optimize:false})))];}
