import { randomUUID, createHash } from 'node:crypto';
import type { FileHandle } from 'node:fs/promises';
import { check, AtelierError } from './errors.js';
import { base64 } from './schema.js';
import { AtelierFiles } from './files.js';
import { BACKUP_LIMIT, FILE_LIMIT, sha256 } from './resources.js';

export const CHUNK_BYTES = 256*1024;
export const TRANSFER_LIMITS = {chunkBytes:CHUNK_BYTES,fileBytes:FILE_LIMIT,backupBytes:BACKUP_LIMIT,perConnection:2,global:8,idleMs:60000,totalMs:15*60000,chunkRate:32,highWater:1024*1024,lowWater:256*1024} as const;
export interface Transfer {
  id:string; owner:string; direction:'upload'|'download'; purpose:'file'|'backup-import'|'export';
  pid?:string; role?:string; name:string; total:number; hash:string; relative:string;
  index:number; received:number; created:number; touched:number; finished:boolean; busy:boolean;
}
export class AtelierTransfers {
  private readonly items = new Map<string,Transfer>();
  constructor(public readonly files: AtelierFiles, private readonly now = Date.now) {}
  private async slot(owner: string,bytes: number) {
    await this.sweep();
    check(this.items.size < 8 && [...this.items.values()].filter(t=>t.owner===owner).length < 2,'동시 전송 한도를 초과했습니다.','LIMIT_EXCEEDED');
    const reserved = [...this.items.values()].reduce((sum,t)=>sum+t.total,0);
    await this.files.store.paths.reserve(reserved+bytes);
  }
  async begin(owner: string,payload: {purpose:'file'|'backup-import';designProjectId?:string;fileRole?:string;name:string;totalBytes:number;sha256:string}) {
    check(payload.totalBytes > 0 && payload.totalBytes <= (payload.purpose==='file'?FILE_LIMIT:BACKUP_LIMIT),'전송 크기 한도를 초과했습니다.','LIMIT_EXCEEDED');
    if (payload.purpose==='file') { check(payload.designProjectId && payload.fileRole,'파일 전송 대상과 역할이 필요합니다.'); await this.files.store.get(payload.designProjectId); }
    else check(!payload.designProjectId && !payload.fileRole,'백업 전송에는 프로젝트·파일 역할을 지정하지 않습니다.');
    await this.slot(owner,payload.totalBytes);
    const id = 'up_'+randomUUID(),relative = `transfers/${id}.tmp`,handle = await this.files.store.paths.exclusive(relative); await handle.close();
    const now = this.now(); const item:Transfer = {id,owner,direction:'upload',purpose:payload.purpose,pid:payload.designProjectId,role:payload.fileRole,name:payload.name,total:payload.totalBytes,hash:payload.sha256,relative,index:0,received:0,created:now,touched:now,finished:false,busy:false};
    this.items.set(id,item); return this.summary(item);
  }
  summary(t: Transfer) { return {transferId:t.id,direction:t.direction,purpose:t.purpose,name:t.name,totalBytes:t.total,sha256:t.hash,chunkBytes:CHUNK_BYTES,nextIndex:t.index,receivedBytes:t.received,expiresAt:new Date(Math.min(t.created+TRANSFER_LIMITS.totalMs,t.touched+TRANSFER_LIMITS.idleMs)).toISOString()}; }
  async owned(owner: string,id: string) {
    const t = this.items.get(id); check(t && t.owner===owner,'전송이 없거나 이 연결의 소유가 아닙니다.','TRANSFER_EXPIRED');
    if (this.now()-t.touched>=TRANSFER_LIMITS.idleMs || this.now()-t.created>=TRANSFER_LIMITS.totalMs) { await this.abort(owner,id); throw new AtelierError('TRANSFER_EXPIRED','전송이 만료되었습니다. 다시 시작하세요.'); }
    check(!t.busy,'이 전송의 응답을 기다린 뒤 다음 요청을 보내세요.','BUSY'); return t;
  }
  async chunk(owner: string,id: string,index: number,data: string) {
    const t = await this.owned(owner,id); check(t.direction==='upload' && !t.finished,'업로드 전송이 아닙니다.');
    try {
      check(index===t.index,'중복되거나 순서가 다른 chunk입니다.','TRANSFER_SEQUENCE');
      const bytes = base64(data); check(bytes.length > 0 && bytes.length <= CHUNK_BYTES && t.received+bytes.length<=t.total,'chunk 크기 또는 총량이 다릅니다.','LIMIT_EXCEEDED');
      t.busy = true;
      // Open only after path verification; never accept a caller path.
      const {open} = await import('node:fs/promises'); const out = await open(await this.files.store.paths.target(t.relative),'r+');
      try { await this.files.store.paths.target(t.relative); let offset = 0; while(offset<bytes.length) { const written = await out.write(bytes,offset,bytes.length-offset,t.received+offset); check(written.bytesWritten>0,'파일 기록에 실패했습니다.','STORAGE_UNAVAILABLE'); offset+=written.bytesWritten; } await out.sync(); } finally { await out.close(); }
      t.received += bytes.length; t.index++; t.touched = this.now(); return this.summary(t);
    } catch(error) { t.busy=false; await this.abort(owner,id); throw error; }
    finally { t.busy=false; }
  }
  async finish(owner: string,id: string) {
    const t = await this.owned(owner,id); check(t.direction==='upload' && !t.finished,'이미 완료되었거나 업로드가 아닙니다.');
    try {
      check(t.received===t.total,'전송 총량이 다릅니다.','TRANSFER_SEQUENCE');
      const bytes = await this.files.store.paths.read(t.relative,t.purpose==='file'?FILE_LIMIT:BACKUP_LIMIT);
      check(sha256(bytes)===t.hash,'전송 해시가 다릅니다.','HASH_MISMATCH');
      if (t.purpose==='file') { const file = await this.files.moveFromTransfer(t.relative,t.pid!,t.name,t.role!); this.items.delete(id); return {kind:'file' as const,file}; }
      t.finished=true; t.touched=this.now(); return {kind:'restore' as const,transferId:t.id};
    } catch(error) { await this.abort(owner,id); throw error; }
  }
  async committedBackup(owner: string,id: string) {
    const t = await this.owned(owner,id); check(t.direction==='upload' && t.purpose==='backup-import' && t.finished,'완료된 백업 가져오기 전송이 필요합니다.');
    return this.files.store.paths.read(t.relative,BACKUP_LIMIT);
  }
  async download(owner: string,pid: string | undefined,name: string,write: (handle: FileHandle)=>Promise<void>,expectedBytes: number) {
    await this.slot(owner,expectedBytes);
    const id='up_'+randomUUID(),relative=`transfers/${id}.tmp`,handle=await this.files.store.paths.exclusive(relative);
    try {
      await write(handle); await handle.sync(); const info = await handle.stat(); check(info.size<=expectedBytes,'출력 크기가 예약 범위를 초과했습니다.','LIMIT_EXCEEDED');
      await handle.close();
      const {open} = await import('node:fs/promises'), input = await open(await this.files.store.paths.target(relative),'r');
      const hash = createHash('sha256'); try { const buffer=Buffer.alloc(CHUNK_BYTES); let position=0; while(position<info.size) { const {bytesRead}=await input.read(buffer,0,buffer.length,position); check(bytesRead>0); hash.update(buffer.subarray(0,bytesRead)); position+=bytesRead; } } finally { await input.close(); }
      const now=this.now(),t:Transfer={id,relative,owner,pid,name,total:info.size,hash:hash.digest('hex'),direction:'download',purpose:'export',index:0,received:0,created:now,touched:now,finished:true,busy:false}; this.items.set(id,t); return this.summary(t);
    } catch(error) { await handle.close().catch(()=>{}); await this.files.store.paths.remove(relative); throw error; }
  }
  async read(owner: string,id: string,index: number) {
    const t=await this.owned(owner,id); check(t.direction==='download','다운로드 전송이 아닙니다.');
    try {
      check(index===t.index,'다운로드 chunk 순서가 다릅니다.','TRANSFER_SEQUENCE');
      const {open}=await import('node:fs/promises'), handle=await open(await this.files.store.paths.target(t.relative),'r');
      const buffer=Buffer.alloc(Math.min(CHUNK_BYTES,t.total-t.received));
      try { const {bytesRead}=await handle.read(buffer,0,buffer.length,t.received); check(bytesRead===buffer.length,'출력 파일이 변경되었습니다.','HASH_MISMATCH'); } finally { await handle.close(); }
      t.received+=buffer.length; t.index++; t.touched=this.now(); const last=t.received===t.total;
      const result={transferId:id,index,dataBase64:buffer.toString('base64'),last,totalBytes:t.total,sha256:t.hash};
      if(last) await this.abort(owner,id); return result;
    } catch(error) { await this.abort(owner,id); throw error; }
  }
  async abort(owner: string,id: string) { const t=this.items.get(id); check(t && t.owner===owner,'전송이 없습니다.','TRANSFER_EXPIRED'); await this.files.store.paths.remove(t.relative); this.items.delete(id); return {aborted:true}; }
  async disconnect(owner: string) { for(const t of [...this.items.values()]) if(t.owner===owner) await this.abort(owner,t.id); }
  async sweep() { for(const t of [...this.items.values()]) if(this.now()-t.touched>=TRANSFER_LIMITS.idleMs || this.now()-t.created>=TRANSFER_LIMITS.totalMs) await this.abort(t.owner,t.id); }
  hasProject(pid: string) { return [...this.items.values()].some(t=>t.pid===pid); }
}
