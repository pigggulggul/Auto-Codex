// Real local storage/UI QA. Isolated scratch only, no live Codex/model/user history.
import {cp,mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
await mkdir(path.join(root,'.cache'),{recursive:true});const scratch=await mkdtemp(path.join(root,'.cache','atelier-manual-ui-'));
await cp(path.join(root,'build-server'),path.join(scratch,'build-server'),{recursive:true});await cp(path.join(root,'dist'),path.join(scratch,'dist'),{recursive:true});
await writeFile(path.join(root,'.cache','atelier-manual-ui-path.txt'),scratch);
const synthetic=process.argv.includes('--proposal-fixture');const port=synthetic?'4879':'4878';if(synthetic)await cp(path.join(root,'tools/fixtures/proposal-app-server.mjs'),path.join(scratch,'app-server'));
const child=spawn(process.execPath,[path.join(scratch,'build-server/server/index.js'),'--serve'],{cwd:scratch,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,AUTO_CODEX_PORT:port,CODEX_BIN:synthetic?process.execPath:path.join(scratch,'missing-cli')}});
child.stdout.pipe(process.stdout);child.stderr.pipe(process.stderr);console.log('ISOLATED MANUAL UI: http://127.0.0.1:'+port+' · '+scratch);
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill());await once(child,'exit');
