// SPDX-License-Identifier: GPL-3.0-or-later
import { createDesign, createElement, createShape } from '@/model/factories';
import { compound, ellipseGeom, polylineGeom, rectGeom } from '@/geom/shapes';
import { transformGeom } from '@/geom/pathData';
import { splitHoopings } from '@/hooping/split';
import type { MultiHoopOptions } from '@/model/types';
export const gridOptions: MultiHoopOptions = {width:100,height:100,margin:3,overlap:12};
export const customOptions: MultiHoopOptions = {...gridOptions,placements:[{center:[28,28],angle:45},{center:[85,85],angle:40},{center:[142,142],angle:50}]};
export function placementSource() {
  const d=createDesign({name:'Diagonal botanical ribbon'});
  d.threads.green={id:'green',name:'Forest green',color:'#296450'};
  d.threads.gold={id:'gold',name:'Gold',color:'#cc9933'};
  const panel=createShape('Tatami ribbon with cutouts',compound([rectGeom(0,-11,240,22),...[30,120,210].map(x=>ellipseGeom(x,0,6))]));panel.id='panel';
  panel.fill=createElement('fill','tatami','green',{density:0.6,stitchLength:3,underlay:'edge',pullComp:0,angle:80});panel.fill.id='panel-fill';
  d.shapes[panel.id]=panel;d.zOrder.push(panel.id);d.sequence.push({kind:'element',elementId:panel.fill.id});
  for(const [i,x] of [30,120,210].entries()){
    const ring=createShape(`Gold ring ${i+1}`,ellipseGeom(x,0,7));ring.id=`ring-${i}`;
    ring.outline=createElement('outline','satin','gold',{width:1.5,density:0.42,pullComp:0.1});ring.outline.id=`ring-outline-${i}`;
    d.shapes[ring.id]=ring;d.zOrder.push(ring.id);d.sequence.push({kind:'element',elementId:ring.outline.id});
  }
  for(const [i,y] of [-9,9].entries()){
    const edge=createShape('Gold ribbon edge',polylineGeom([[2,y],[238,y]]));edge.id=`edge-${i}`;
    edge.outline=createElement('outline','satin','gold',{width:1.2,density:0.42,pullComp:0.1});edge.outline.id=`edge-outline-${i}`;
    d.shapes[edge.id]=edge;d.zOrder.push(edge.id);d.sequence.push({kind:'element',elementId:edge.outline.id});
  }
  const c=Math.SQRT1_2;
  for(const shape of Object.values(d.shapes))shape.geom=transformGeom(shape.geom,[c,c,-c,c,0,0]);
  d.multiHoop=customOptions;
  return d;
}
export function stitchExamples(){const source=placementSource();return [{name:'source-ribbon',design:source,optimize:false},...splitHoopings(source,customOptions).map(p=>({name:`hoop-${String(p.number).padStart(2,'0')}`,design:p.design,optimize:false}))];}
