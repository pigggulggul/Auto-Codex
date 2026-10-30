// Offline UI acceptance fixture. No installed Codex, user archive, network service or model is used.
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {cp,mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');await mkdir(path.join(root,'.cache'),{recursive:true});const scratch=await mkdtemp(path.join(root,'.cache','stage8-offline-'));
await cp(path.join(root,'build-server'),path.join(scratch,'build-server'),{recursive:true});await cp(path.join(root,'dist'),path.join(scratch,'dist'),{recursive:true});
const child=spawn(process.execPath,[path.join(scratch,'build-server/server/index.js'),'--serve'],{cwd:scratch,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,AUTO_CODEX_PORT:'4889',CODEX_BIN:path.join(scratch,'deliberately-missing-cli')}});child.stdout.pipe(process.stdout);child.stderr.resume();for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill());await writeFile(path.join(root,'.cache/stage8-offline-ui.json'),JSON.stringify({scratch,url:'http://127.0.0.1:4889'}));await once(child,'exit');
