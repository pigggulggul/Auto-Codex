import {readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const files=['server.mjs'];
for(const folder of ['public','src','scripts'])for(const entry of await readdir(path.join(root,folder)))if(/\.(mjs|js)$/.test(entry))files.push(path.join(folder,entry));
for(const file of files){const result=spawnSync(process.execPath,['--check',file],{cwd:root,encoding:'utf8',windowsHide:true});if(result.status!==0){process.stderr.write(result.stderr||'문법 검사 실패: '+file);process.exit(result.status||1);}}
console.log(`문법 검사 통과: ${files.length}개 실행 모듈`);
