// SPDX-License-Identifier: GPL-3.0-or-later
import { preview } from 'vite';
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
const server=await preview({preview:{port:4184,strictPort:true,host:'127.0.0.1'}}),browser=await chromium.launch();
try{
  const page=await browser.newPage({viewport:{width:1440,height:1200},colorScheme:'light'});
  await page.goto('http://127.0.0.1:4184/?testHooks');await page.waitForFunction(()=>window.__lumastitch);
  await page.evaluate(async project=>{await window.__lumastitch.actions.handleFile(new File([project],'ribbon.lumastitch'));},readFileSync('docs/hooping-placements/source-ribbon/source-ribbon.lumastitch','utf8'));
  await page.getByRole('menuitem',{name:'File',exact:true}).click();await page.getByRole('menuitem',{name:'Multi-hooping export…'}).click();
  await page.getByRole('button',{name:'Calculate hoopings'}).click();await page.getByRole('img',{name:'Numbered hooping layout with shared registration marks'}).waitFor();
  await page.waitForTimeout(250);await page.screenshot({path:'docs/hooping-placements/dialog.png'});
  for(const name of ['before','after']) {
    const svg=readFileSync(`docs/hooping-placements/${name}-layout.svg`,'utf8');
    await page.setContent(`<style>body{margin:0;background:#fffdf6}svg{width:800px;height:800px}</style>${svg}`);
    await page.locator('svg').screenshot({path:`docs/hooping-placements/${name}-layout.png`});
  }
}finally{await browser.close();await new Promise(resolve=>server.httpServer.close(resolve));}
