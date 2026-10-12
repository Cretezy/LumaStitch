// SPDX-License-Identifier: GPL-3.0-or-later
import { createDesign, createElement, createShape } from '@/model/factories';
import { rectGeom, polylineGeom } from '@/geom/shapes';
import { starterProfile } from '@/fabric/profiles';

export function stitchExamples() {
  const design=createDesign({name:'Reusable fabric profile sampler'});
  design.fabricProfile={...starterProfile('woven'),name:'Example cotton calibration (unsewn)',fillSpacing:0.5,satinSpacing:0.45,pullComp:0.2,needle:'Record the needle used',thread:'Record thread brand and weight',notes:'Software example only. Sew this sampler and adjust before treating it as a calibrated fabric profile.'};
  design.threads.blue={id:'blue',name:'Blue calibration thread',color:'#234a73'};
  for(const [i,geom] of [rectGeom(0,0,30,30),polylineGeom([[40,0],[40,30]]),polylineGeom([[50,0],[50,30]])].entries()){
    const s=createShape(i?'Inherited satin':'Inherited tatami',geom,{strokeWidth:i===1?3:6});s.id=`profile-${i}`;
    const el=createElement(i?'outline':'fill',i?'satin':'tatami','blue');el.id=`profile-el-${i}`;if(i)s.outline=el;else s.fill=el;
    design.shapes[s.id]=s;design.zOrder.push(s.id);design.sequence.push({kind:'element',elementId:el.id});
  }
  return [{name:'fabric-profile',design,optimize:false}];
}
