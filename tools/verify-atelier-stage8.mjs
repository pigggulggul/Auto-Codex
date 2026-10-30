// Build first. Local synthetic regression suite; no live model, installs, deployment or user data access.
import {spawn} from 'node:child_process';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),stamp=new Date().toISOString().replace(/[:.]/g,'-'),logs=path.join(root,'.cache','stage8-'+stamp);await mkdir(logs,{recursive:true});
const scripts=['verify-conversation-restart.mjs','verify-atelier-domain.mjs','verify-atelier-assets.mjs','verify-pixel-assets.mjs','verify-atelier-storage.mjs','verify-atelier-proposals.mjs','verify-atelier-generation.mjs','verify-atelier-artifacts.mjs'];
async function run(script){const args=script==='verify-atelier-domain.mjs'?['--manifest','docs/atelier/STAGE8_SOURCE_MANIFEST.json']:[];const start=Date.now(),child=spawn(process.execPath,[path.join(root,'tools',script),...args],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',d=>output+=String(d));child.stderr.on('data',d=>output+=String(d));const exitCode=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});await writeFile(path.join(logs,script+'.log'),output);const result={command:'node tools/'+script+(args.length?' '+args.join(' '):''),exitCode,elapsedMs:Date.now()-start,logSha256:createHash('sha256').update(output).digest('hex')};console.log(JSON.stringify(result));return result;}
const results=[]; // Distinct ports; two fixtures at once keeps local resource pressure bounded.
for(let i=0;i<scripts.length;i+=2)results.push(...await Promise.all(scripts.slice(i,i+2).map(run)));
const sources=['src/App.tsx','src/components/ConversationPicker.tsx','src/components/layout/AtelierPages.tsx','server/index.ts','server/client-message.ts','server/conversation-store.ts','shared/conversation-title.ts','server/atelier/artifacts.ts'];
const sourceHashes={};for(const file of sources)sourceHashes[file]=createHash('sha256').update(await readFile(path.join(root,file))).digest('hex');
const evidence={recordedAt:new Date().toISOString(),node:process.version,synthetic:true,liveModel:false,ok:results.every(r=>r.exitCode===0),results,sourceHashes};await writeFile(path.join(root,'docs/atelier/STAGE8_REGRESSION_EVIDENCE.json'),JSON.stringify(evidence,null,2)+'\n');if(!evidence.ok)process.exitCode=1;
