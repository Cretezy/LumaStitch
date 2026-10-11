// SPDX-License-Identifier: GPL-3.0-or-later
import { preview } from 'vite';
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
const server=await preview({preview:{port:4186,strictPort:true,host:'127.0.0.1'}}),browser=await chromium.launch();
try{const page=await browser.newPage({viewport:{width:1440,height:1000},colorScheme:'light'});await page.goto('http://127.0.0.1:4186/?testHooks');await page.waitForFunction(()=>window.__lumastitch);await page.evaluate(async(project)=>{await window.__lumastitch.actions.handleFile(new File([project],'patches.lumastitch'));},readFileSync('docs/applique/after/after.lumastitch','utf8'));await page.getByRole('menuitem',{name:'File',exact:true}).click();await page.getByRole('menuitem',{name:'Appliqué cutting export…'}).click();await page.getByRole('button',{name:'Prepare cutting package'}).click();await page.getByRole('img',{name:'Numbered appliqué cutting layout'}).waitFor();await page.screenshot({path:'docs/applique/dialog.png'});}finally{await browser.close();await new Promise((resolve)=>server.httpServer.close(resolve));}
