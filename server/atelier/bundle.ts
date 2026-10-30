import type { FileHandle } from 'node:fs/promises';
import type { Project } from '../../shared/atelier/types.js';
import { AtelierStore, type FileRecord } from './store.js';
import { AtelierFiles } from './files.js';
import { AtelierTransfers } from './transfers.js';
import { check } from './errors.js';
import { BACKUP_LIMIT, crc32, sha256 } from './resources.js';
import { canonical, domain, validateProject } from './validation.js';
import { base64, obj, array, json, id, hash, text, shape, optional, integer } from './schema.js';
import { randomUUID } from 'node:crypto';
import { editable } from '../../shared/atelier/value.js';

async function write(handle: FileHandle,bytes: Buffer | string) { const data=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes); let offset=0; while(offset<data.length) { const result=await handle.write(data,offset,data.length-offset); check(result.bytesWritten>0,'파일 기록에 실패했습니다.','STORAGE_UNAVAILABLE'); offset+=result.bytesWritten; } }
export class AtelierBundles {
  constructor(private readonly store: AtelierStore,private readonly files: AtelierFiles,private readonly transfers: AtelierTransfers) {}
  async backup(owner: string,pid: string) {
    const p=await this.store.get(pid); await this.files.validate(p);
    check(!p.results.some(r=>r.generationId),'자동 코드 결과는 legacy JSON 백업으로 표현할 수 없습니다. bridge 종료 후 .local-data/atelier 전체와 별도 history를 보관하세요.','CAPABILITY_UNAVAILABLE');
    const records=await this.store.files(pid),header=JSON.stringify({format:'atelier-backup',version:1,exportedAt:new Date().toISOString(),project:p});
    const expected=Buffer.byteLength(header)-1+Buffer.byteLength(',"files":[')+records.reduce((n,f,i)=>n+Math.ceil(f.size/3)*4+Buffer.byteLength(JSON.stringify({...f,data:''}))+(i?1:0),0)+2;
    check(expected<=BACKUP_LIMIT,'백업 JSON 전체가 90MiB 한도를 초과합니다.','LIMIT_EXCEEDED');
    return this.transfers.download(owner,pid,p.name+'.atelier.json',async handle=>{
      await write(handle,header.slice(0,-1)+',"files":[');
      for(const [i,f] of records.entries()) { const {bytes}=await this.files.read(pid,f.id); if(i)await write(handle,','); await write(handle,JSON.stringify({...f,data:bytes.toString('base64')})); }
      await write(handle,']}');
    },expected);
  }
  async import(owner: string,transferId: string) {
    const bytes=await this.transfers.committedBackup(owner,transferId);
    let input:unknown; try { input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)); } catch { check(false,'백업 JSON을 읽을 수 없습니다.'); }
    const b=obj(input); shape({format:v=>check(v==='atelier-backup','복원용 Atelier 백업이 아닙니다.'),version:v=>check(v===1,'지원하지 않는 백업 버전입니다.','UNSUPPORTED_VERSION'),exportedAt:optional(text(64)),project:json,files:array(json,10000)})(b);
    const p=validateProject(b.project),records:FileRecord[]=[],data=new Map<string,Buffer>();
    check(!p.results.some(r=>r.generationId||r.artifactManifestId||r.executionSource),'실행 ID를 포함한 legacy 백업은 복원하지 않습니다.','UNSUPPORTED_VERSION');
    for(const value of b.files as unknown[]) {
      shape({id,name:v=>{check(typeof v==='string'&&v.length>0&&v.length<=180,'파일 이름 길이가 올바르지 않습니다.');},mime:optional(text(120)),ext:optional(text(12)),sha256:hash,size:optional(integer(1,15*1024*1024)),data:text(BACKUP_LIMIT),project_id:optional(id)})(value);
      const f=obj(value); check(!data.has(String(f.id)),'백업 파일 ID가 중복되었습니다.');
      if(f.project_id!==undefined)check(f.project_id===p.id,'백업 파일 소유 프로젝트가 다릅니다.','PROJECT_MISMATCH');
      const buffer=base64(f.data); check(sha256(buffer)===f.sha256,'손상된 백업 파일 해시입니다.','HASH_MISMATCH');
      const record=this.files.record(buffer,String(f.name),String(f.id));
      if(f.size!==undefined)check(f.size===record.size,'백업 파일 크기가 다릅니다.','HASH_MISMATCH');
      if(f.mime!==undefined)check(f.mime===record.mime,'백업 MIME이 실제 바이트와 다릅니다.');
      if(f.ext!==undefined)check(f.ext===record.ext,'백업 확장자가 실제 바이트와 다릅니다.');
      records.push(record); data.set(record.id,buffer);
    }
    for(const fid of [...domain.fileIds(p),...p.snapshots.flatMap(s=>s.referenceFileIds)])check(data.has(fid),'백업에 참조 파일이 없습니다.','FILE_MISSING');
    // Check image roles without writing anything, including historical snapshot inputs.
    const {detectImage}=await import('./resources.js');
    for(const view of [p,...p.snapshots.map(s=>s.input)]) {
      for(const fid of [...view.references.flatMap(r=>[r.fileId,...r.regions.flatMap(a=>[a.fileId,a.cropId])]),...view.results.map(r=>r.fileId)].filter((x):x is string=>!!x)) check(detectImage(data.get(fid)!), '원본·크롭·결과 이미지가 손상되었습니다.');
    }
    const oldId=p.id; p.id='p_'+randomUUID(); p.name=(p.name+' · 복원').slice(0,120); p.version=1; p.updatedAt=new Date().toISOString();
    p.restoredFrom={id:oldId,at:p.updatedAt};
    // Legacy manual handoff is inert history, not a runtime binding or permission.
    await this.store.paths.reserve(records.reduce((sum,f)=>sum+f.size,0));
    const paths=records.map(f=>this.files.relative(p.id,f)), operation=await this.store.journal(paths);
    let committed=false;
    try {
      for(const f of records)await this.files.stage(p.id,f,data.get(f.id)!);
      // Verify all referenced bytes before the single project/file metadata transaction.
      await this.store.insert(p,records); committed=true; await this.store.clearJournal(operation);
    } catch(error) { if(!committed){for(const file of paths)await this.store.paths.remove(file); await this.store.clearJournal(operation);} throw error; }
    await this.transfers.abort(owner,transferId);
    return {id:p.id,name:p.name,version:p.version,revision:p.revision};
  }
  async bundle(owner: string,pid: string,snapshotId: string) {
    const p=await this.store.get(pid),snap=p.snapshots.find(s=>s.id===snapshotId);
    check(snap,'지정한 스냅샷이 없습니다.','NOT_FOUND');
    const records:FileRecord[]=[],available=await this.store.files(pid);
    for(const fid of snap.referenceFileIds){const record=available.find(f=>f.id===fid);check(record,'스냅샷의 첨부 파일이 없습니다.','FILE_MISSING');records.push(record);}
    check(records.reduce((sum,f)=>sum+f.size,0)<0xffffffff,'선택 파일 총량이 ZIP32 한도를 초과합니다.','LIMIT_EXCEEDED');
    const manifest=records.map(f=>({...f,archivePath:`files/${f.id}${f.ext}`}));
    const entries:Array<{name:string;data?:Buffer;file?:FileRecord}>= [
      {name:'prompt.md',data:Buffer.from(snap.text)},
      {name:'decisions.json',data:Buffer.from(JSON.stringify({template:snap.templateVersion,decisions:snap.decisions,sections:snap.sections},null,2))},
      ...records.map(file=>({name:`files/${file.id}${file.ext}`,file})),
      {name:'attachments.txt',data:Buffer.from('실제로 포함된 파일\n'+(records.map(f=>`${f.id}: ${f.name} [sha256 ${f.sha256}]`).join('\n')||'없음')+'\n전체 복원은 별도의 JSON 백업을 사용하세요.')},
      {name:'handoff.json',data:Buffer.from(JSON.stringify({format:'atelier-handoff',version:1,projectId:p.id,snapshotId:snap.id,selection:snap.selection||{mode:'all',ids:[]},files:manifest,input:domain.currentInput(editable<Project>(snap.input))},null,2))}
    ];
    const expected=entries.reduce((n,e)=>n+30+46+Buffer.byteLength(e.name)*2+(e.file?.size||e.data!.length),22);
    check(entries.length<=65535 && expected<0xffffffff,'ZIP32의 파일 개수·크기 한도를 초과합니다.','LIMIT_EXCEEDED');
    return this.transfers.download(owner,pid,p.name+'-자료묶음.zip',async handle=>{
      let offset=0;const central:Buffer[]=[];
      for(const entry of entries){
        const name=Buffer.from(entry.name),data=entry.file?(await this.files.read(pid,entry.file.id)).bytes:entry.data!,crc=crc32(data);
        const h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50);h.writeUInt16LE(20,4);h.writeUInt16LE(0x800,6);h.writeUInt32LE(crc,14);h.writeUInt32LE(data.length,18);h.writeUInt32LE(data.length,22);h.writeUInt16LE(name.length,26);
        await write(handle,h);await write(handle,name);await write(handle,data);
        const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(0x800,8);c.writeUInt32LE(crc,16);c.writeUInt32LE(data.length,20);c.writeUInt32LE(data.length,24);c.writeUInt16LE(name.length,28);c.writeUInt32LE(offset,42);central.push(c,name);offset+=h.length+name.length+data.length;
      }
      const cd=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(cd.length,12);end.writeUInt32LE(offset,16);await write(handle,cd);await write(handle,end);
    },expected);
  }
  async projectRead(owner: string,pid: string,snapshotId?: string) {
    const p=await this.store.get(pid); const item=snapshotId?p.snapshots.find(s=>s.id===snapshotId):p;
    check(item,'지정한 스냅샷이 없습니다.','NOT_FOUND');
    const bytes=Buffer.from(canonical(item));
    return {hash:sha256(bytes),download:await this.transfers.download(owner,pid,snapshotId?'snapshot.json':'project.json',h=>write(h,bytes),bytes.length)};
  }
}
