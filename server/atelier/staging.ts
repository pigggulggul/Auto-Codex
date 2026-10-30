import {constants} from 'node:fs';
import {lstat,mkdir,open,realpath,statfs} from 'node:fs/promises';
import path from 'node:path';
import {check} from './errors.js';
import {sha256} from './resources.js';

const equal=(a:string,b:string)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
/** Server names only. Recheck each ancestor before every file open; reject links/junctions. */
export class InputStaging {
  constructor(readonly workspace:string,readonly generationId:string){}
  get relative(){return `.auto-codex/atelier-inputs/${this.generationId}`;}
  async verify(){
    check(equal(await realpath(this.workspace),this.workspace)&&(await lstat(this.workspace)).isDirectory(),'Workspace changed.','WORKSPACE_INVALID');
    let current=this.workspace;
    for(const part of this.relative.split('/')){
      current=path.join(current,part);const info=await lstat(current);
      check(info.isDirectory()&&!info.isSymbolicLink()&&equal(await realpath(current),current),'Staging path escaped workspace.','WORKSPACE_INVALID');
    }
    return current;
  }
  async create(size:number){
    check(/^gen_[a-z0-9-]+$/.test(this.generationId));
    check(equal(await realpath(this.workspace),this.workspace)&&(await lstat(this.workspace)).isDirectory(),'Workspace is unavailable.','WORKSPACE_INVALID');
    const free=await statfs(this.workspace);check(free.bavail*free.bsize>=size+16*1024*1024,'Staging disk budget is insufficient.','LIMIT_EXCEEDED');
    let current=this.workspace;
    for(const [i,part] of this.relative.split('/').entries()){
      current=path.join(current,part);
      try{await mkdir(current,{mode:0o700});}catch(e){if(i===2||(e as NodeJS.ErrnoException).code!=='EEXIST')throw e;}
      const info=await lstat(current);check(info.isDirectory()&&!info.isSymbolicLink()&&equal(await realpath(current),current),'Unsafe staging directory.','WORKSPACE_INVALID');
    }
  }
  async write(name:string,bytes:Buffer){
    check(/^[a-zA-Z0-9_.-]+$/.test(name)&&name!=='.'&&name!=='..');
    const target=path.join(await this.verify(),name);
    const h=await open(target,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|(constants.O_NOFOLLOW||0),0o600);
    try{await this.verify();await h.writeFile(bytes);await h.sync();}finally{await h.close();}
    const read=await open(target,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
    try{await this.verify();check((await read.stat()).isFile()&&sha256(await read.readFile())===sha256(bytes),'Staged bytes changed.','HASH_MISMATCH');}finally{await read.close();}
  }
  async verifyFile(name:string,hash:string,size:number){
    check(/^[a-zA-Z0-9_.-]+$/.test(name)&&name!=='.'&&name!=='..');
    const target=path.join(await this.verify(),name),info=await lstat(target);
    check(info.isFile()&&!info.isSymbolicLink()&&info.size===size,'Staged input changed.','HASH_MISMATCH');
    const h=await open(target,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
    try{await this.verify();check(sha256(await h.readFile())===hash,'Staged input hash changed.','HASH_MISMATCH');}finally{await h.close();}
  }
}
