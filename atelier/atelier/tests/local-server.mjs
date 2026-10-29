import {spawn} from 'node:child_process';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
export async function testServer(port){
 await mkdir(path.join(root,'test-results'),{recursive:true});const dir=await mkdtemp(path.join(root,'test-results','extension-'));
 const base=`http://127.0.0.1:${port}`;let child;
 async function stopChild(){if(child&&child.exitCode===null){const exited=new Promise(r=>child.once('exit',r));child.kill();await exited;}}
 async function start(){child=spawn(process.execPath,['server.mjs'],{cwd:root,windowsHide:true,env:{...process.env,ATELIER_DATA:dir,PORT:String(port)},stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',c=>log+=c);child.stderr.on('data',c=>log+=c);for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok)return;}catch{}if(child.exitCode!==null)break;await delay(40);}await stopChild();throw new Error(log||'Local server startup failed');}
 await start();
 return {base,dir,async api(url,method='GET',data){const r=await fetch(base+'/api'+url,{method,headers:data?{'Content-Type':'application/json'}:{},...(data?{body:JSON.stringify(data)}:{})});return {status:r.status,body:await r.json()};},async restart(){await stopChild();await start();},async stop(){await stopChild();await rm(dir,{recursive:true,force:true});}};
}
