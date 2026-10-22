// Upload immutable source maps, then commit the complete template manifest last.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
const root=path.resolve('output/strahd');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
if(manifest.id!=='curse-of-strahd'||manifest.scenes.length!==36)throw new Error('Build the complete Strahd module first');
const remote=process.argv.includes('--remote');
const bucket=process.env.R2_REFERENCE_BUCKET||'dnd-dm-tool-reference-data';
const prefix=`${bucket}/room-templates/curse-of-strahd/`;
async function put(key,file,type){
 for(let attempt=0;attempt<3;attempt++){
  const result=await new Promise(resolve=>{let output='';const p=spawn(process.execPath,['node_modules/wrangler/bin/wrangler.js','r2','object','put',prefix+key,'--file',file,'--content-type',type,remote?'--remote':'--local'],{stdio:['ignore','pipe','pipe']});p.stdout.on('data',d=>output+=d);p.stderr.on('data',d=>output+=d);p.on('error',e=>resolve({code:1,output:e.message}));p.on('exit',code=>resolve({code,output}));});
  if(result.code===0)return;
  if(attempt===2)throw new Error(`${key}: ${result.output}`);
 }
}
let next=0,done=0;
await Promise.all(Array.from({length:4},async()=>{while(next<manifest.scenes.length){const s=manifest.scenes[next++];await put('assets/'+s.map.assetId,path.join(root,'assets',s.map.assetId),'image/png');console.log(`${++done}/36 uploaded ${s.key}`);}}));
await put('manifest.json',path.join(root,'manifest.json'),'application/json');
console.log(`Published complete Strahd template (${remote?'remote':'local'})`);
