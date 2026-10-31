// Upload the Tych Maps composites, then commit the complete template manifest last.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
const moduleId='waterdeep-dragon-heist', total=21;
const root=path.resolve('output/waterdeep');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
const maps=JSON.parse(fs.readFileSync('shared/waterdeep/maps.json','utf8'));
if(manifest.id!==moduleId||manifest.scenes.length!==total)throw new Error(`Build the complete ${moduleId} module first`);
// The deployment presets and grid table are keyed to these exact images.
manifest.scenes.forEach((s,i)=>{if(JSON.stringify({name:s.name,...s.map})!==JSON.stringify(maps[i]))throw new Error(`${s.key} does not match shared/waterdeep/maps.json`);});
const remote=process.argv.includes('--remote');
const bucket=process.env.R2_REFERENCE_BUCKET||'dnd-dm-tool-reference-data';
const prefix=`${bucket}/room-templates/${moduleId}/`;
async function put(key,file,type){
 for(let attempt=0;attempt<3;attempt++){
  const result=await new Promise(resolve=>{let output='';const p=spawn(process.execPath,['node_modules/wrangler/bin/wrangler.js','r2','object','put',prefix+key,'--file',file,'--content-type',type,remote?'--remote':'--local'],{stdio:['ignore','pipe','pipe']});p.stdout.on('data',d=>output+=d);p.stderr.on('data',d=>output+=d);p.on('error',e=>resolve({code:1,output:e.message}));p.on('exit',code=>resolve({code,output}));});
  if(result.code===0)return;
  if(attempt===2)throw new Error(`${key}: ${result.output}`);
 }
}
let next=0,done=0;
// Local R2 is one SQLite file that parallel wrangler processes lock.
await Promise.all(Array.from({length:remote?4:1},async()=>{while(next<manifest.scenes.length){const s=manifest.scenes[next++];await put('assets/'+s.map.assetId,path.join(root,'assets',s.map.assetId),s.map.contentType);console.log(`${++done}/${total} uploaded ${s.key}`);}}));
await put('manifest.json',path.join(root,'manifest.json'),'application/json');
console.log(`Published complete ${moduleId} template (${remote?'remote':'local'})`);
