import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, unlink, readdir, statfs } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { check, AtelierError } from './errors.js';

const equal = (a: string,b: string) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
/** All callers use server names under this fixed namespace; no browser path input. */
export class AtelierPaths {
  private constructor(public readonly root: string, private readonly workspace: string) {}
  static async open(workspace: string) {
    const base = await realpath(workspace);
    for (const parts of [['.local-data'],['.local-data','atelier']]) {
      const target = path.join(base,...parts);
      try { await mkdir(target,{mode:0o700}); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      const info = await lstat(target); check(info.isDirectory() && !info.isSymbolicLink() && equal(await realpath(target),target),'설계 저장 경로가 안전한 로컬 폴더가 아닙니다.','STORAGE_UNAVAILABLE');
    }
    const paths = new AtelierPaths(path.join(base,'.local-data','atelier'),base);
    await paths.directory('files'); await paths.directory('transfers');
    return paths;
  }
  async verifyRoot() {
    for (const target of [this.workspace,path.join(this.workspace,'.local-data'),this.root]) {
      const info = await lstat(target); check(info.isDirectory() && !info.isSymbolicLink() && equal(await realpath(target),target),'설계 저장 경로가 변경되었습니다.','STORAGE_UNAVAILABLE');
    }
  }
  private parts(relative: string) {
    check(relative.length > 0 && !path.isAbsolute(relative));
    const parts = relative.split(/[\\/]/); check(parts.every(p=>/^[a-zA-Z0-9_.-]+$/.test(p) && p !== '.' && p !== '..'),'저장 경로가 올바르지 않습니다.');
    return parts;
  }
  async directory(relative: string) {
    await this.verifyRoot(); let current = this.root;
    for (const part of this.parts(relative)) {
      current = path.join(current,part);
      try { await mkdir(current,{mode:0o700}); } catch(error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      const info = await lstat(current); check(info.isDirectory() && !info.isSymbolicLink() && equal(await realpath(current),current),'저장 하위 경로가 다른 곳을 가리킵니다.','STORAGE_UNAVAILABLE');
    }
    return current;
  }
  async target(relative: string) {
    const parts = this.parts(relative), name = parts.pop()!;
    await this.verifyRoot(); let current = this.root;
    for (const part of parts) {
      current = path.join(current,part); const info = await lstat(current);
      check(info.isDirectory() && !info.isSymbolicLink() && equal(await realpath(current),current),'저장 하위 경로가 변경되었습니다.','STORAGE_UNAVAILABLE');
    }
    const target = path.join(current,name);
    try {
      const info = await lstat(target); check(info.isFile() && !info.isSymbolicLink() && info.nlink === 1 && equal(await realpath(target),target),'파일 경로가 안전하지 않습니다.','STORAGE_UNAVAILABLE');
    } catch(error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    return target;
  }
  async read(relative: string, limit: number) {
    let handle;
    try {
      const target = await this.target(relative);
      handle = await open(target,constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW));
      await this.target(relative); const info = await handle.stat();
      const named=await lstat(target);check(info.ino===named.ino&&info.dev===named.dev,'파일이 여는 중 변경되었습니다.','STORAGE_UNAVAILABLE');
      check(info.isFile() && info.nlink === 1 && info.size <= limit,'파일 크기 또는 경로가 올바르지 않습니다.','LIMIT_EXCEEDED');
      const buffer = Buffer.alloc(info.size); let offset = 0;
      while (offset < buffer.length) { const {bytesRead} = await handle.read(buffer,offset,buffer.length-offset,offset); check(bytesRead > 0,'파일이 읽는 중 변경되었습니다.','HASH_MISMATCH'); offset += bytesRead; }
      const after = await handle.stat(); check(after.size === info.size && after.mtimeMs === info.mtimeMs,'파일이 읽는 중 변경되었습니다.','HASH_MISMATCH');
      return buffer;
    } catch(error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new AtelierError('FILE_MISSING','실제 파일이 없습니다. 백업에서 복원하거나 다시 등록하세요.'); throw error; }
    finally { await handle?.close(); }
  }
  async exclusive(relative: string) { return open(await this.target(relative),'wx',0o600); }
  async remove(relative: string) {
    // Exact files only. Never recursive-delete a computed directory.
    try { await unlink(await this.target(relative)); } catch(error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  async cleanTransfers() {
    await this.directory('transfers');
    for (const name of await readdir(path.join(this.root,'transfers'))) {
      check(/^up_[a-f0-9-]+\.tmp$/.test(name),'전송 임시 폴더에 알 수 없는 파일이 있습니다.','STORAGE_UNAVAILABLE');
      await this.remove(`transfers/${name}`);
    }
  }
  async reserve(bytes: number) {
    const info = await statfs(this.root); check(info.bavail * info.bsize >= bytes + 16*1024*1024,'저장 공간이 부족합니다.','LIMIT_EXCEEDED');
  }
  async lock() {
    const token=randomUUID();
    for(let attempt=0;attempt<2;attempt++){
      try{const handle=await this.exclusive('owner.lock');try{await handle.writeFile(JSON.stringify({pid:process.pid,token}));await handle.sync();}finally{await handle.close();}return token;}
      catch(error){
        if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
        const raw=await this.read('owner.lock',1024);let owner:{pid:number;token:string};try{owner=JSON.parse(raw.toString());}catch{throw new AtelierError('STORAGE_UNAVAILABLE','저장소 소유 잠금이 손상되었습니다. 기존 파일을 보존합니다.');}
        check(Number.isSafeInteger(owner.pid)&&owner.pid>0&&typeof owner.token==='string','저장소 소유 잠금이 올바르지 않습니다.','STORAGE_UNAVAILABLE');
        let dead=false;try{process.kill(owner.pid,0);}catch(error){dead=(error as NodeJS.ErrnoException).code==='ESRCH';}
        check(dead,'같은 앱 폴더의 설계 저장소를 다른 브리지가 사용 중입니다.','BUSY');
        check((await this.read('owner.lock',1024)).equals(raw),'저장소 소유자가 변경되었습니다.','BUSY');await this.remove('owner.lock');
      }
    }
    throw new AtelierError('BUSY','저장소 소유 잠금을 얻지 못했습니다.');
  }
  async unlock(token:string) {
    const value=JSON.parse((await this.read('owner.lock',1024)).toString());check(value.pid===process.pid&&value.token===token,'저장소 소유자가 변경되었습니다.','STORAGE_UNAVAILABLE');await this.remove('owner.lock');
  }
}
