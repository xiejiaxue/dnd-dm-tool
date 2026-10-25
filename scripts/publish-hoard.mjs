// Upload immutable source maps, then commit the complete template manifest last.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
const root=path.resolve('output/hoard');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
if(manifest.id!=='hoard-of-the-dragon-queen'||manifest.scenes.length!==13)throw new Error('Build the complete Hoard module first: python3 scripts/build-hoard.py /path/to/龙后的宝山');
const remote=process.argv.includes('--remote');
const bucket=process.env.R2_REFERENCE_BUCKET||'dnd-dm-tool-reference-data';
const prefix=`${bucket}/room-templates/hoard-of-the-dragon-queen/`;
async function put(key,file,type){
 for(let attempt=0;attempt<3;attempt++){
  const result=await new Promise(resolve=>{let output='';const p=spawn(process.execPath,['node_modules/wrangler/bin/wrangler.js','r2','object','put',prefix+key,'--file',file,'--content-type',type,remote?'--remote':'--local'],{stdio:['ignore','pipe','pipe']});p.stdout.on('data',d=>output+=d);p.stderr.on('data',d=>output+=d);p.on('error',e=>resolve({code:1,output:e.message}));p.on('exit',code=>resolve({code,output}));});
  if(result.code===0)return;
  if(attempt===2)throw new Error(`${key}: ${result.output}`);
 }
}
let done=0;
for(const s of manifest.scenes){await put('assets/'+s.map.assetId,path.join(root,'assets',s.map.assetId),'image/jpeg');console.log(`${++done}/13 uploaded ${s.key}`);}
await put('manifest.json',path.join(root,'manifest.json'),'application/json');
console.log(`Published complete Hoard template (${remote?'remote':'local'})`);
