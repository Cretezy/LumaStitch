// SPDX-License-Identifier: GPL-3.0-or-later
import { createServer } from 'vite';
import { mkdirSync,writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const server=await createServer({configFile:false,resolve:{alias:{'@':resolve('src')}},server:{watch:null,hmr:false,ws:false}});
try{const {appliqueExample}=await server.ssrLoadModule('/tests/applique/examples.ts');const {appliqueCuttingArchive}=await server.ssrLoadModule('/src/applique/cutting.ts');const {unzipFiles}=await server.ssrLoadModule('/src/library/zip.ts');const d=appliqueExample(true),result=appliqueCuttingArchive(d,d.appliqueCut);mkdirSync('docs/applique/cutting',{recursive:true});writeFileSync('docs/applique/cutting.zip',result.archive);for(const entry of await unzipFiles(result.archive))writeFileSync(`docs/applique/cutting/${entry.name}`,entry.data);}finally{await server.close();}
