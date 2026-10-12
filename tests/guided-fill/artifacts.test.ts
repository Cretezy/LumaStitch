// SPDX-License-Identifier: GPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { buildPlan } from '@/engine/plan';
import { COMMAND_MASK } from '@/engine/types';
import { parseProjectFile } from '@/model/schema';
import { pesFormat } from '@/io/export/pesFormat';
import { readPes } from '@/io/pes/pesReader';
import { MC } from '@/io/pes/machineCommands';

it.each(['parallel','copy','buffer'])('guided-%s published PES matches the project and every rendered needle', (mode)=>{
  const name=`guided-${mode}`, dir=`docs/guided-fill/${name}`;
  const design=parseProjectFile(readFileSync(`${dir}/${name}.lumastitch`,'utf8'));
  const plan=buildPlan(design), bytes=pesFormat.write(plan,design,{version:6});
  expect(bytes).toEqual(new Uint8Array(readFileSync(`${dir}/${name}.pes`)));
  const expected:number[][]=[];
  for(let i=0;i<plan.flags.length;i++) if(!(plan.flags[i]&COMMAND_MASK)) expected.push([Math.round(plan.x[i]*10)||0,Math.round(plan.y[i]*10)||0]);
  expect(readPes(bytes).commands.filter((c)=>c.cmd===MC.STITCH).map((c)=>[c.x,c.y])).toEqual(expected);
});
