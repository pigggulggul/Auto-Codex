import {afterEach,expect,it,vi} from 'vitest';
import {mkdir,mkdtemp,readFile,readdir,rm,writeFile,symlink,realpath} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {AtelierHandlers} from './handlers.js';
import {AtelierStore} from './store.js';
import {domain,validateProject} from './validation.js';
import {sha256,crc32} from './resources.js';
import {CHUNK_BYTES,AtelierTransfers} from './transfers.js';

const scratch=path.resolve('.cache');
const roots:string[]=[],services:AtelierHandlers[]=[];
afterEach(async()=>{for(const service of services.splice(0)){await service.disconnect('one');await service.disconnect('two');await service.store.close();}for(const root of roots.splice(0)){expect(path.dirname(await realpath(root))).toBe(await realpath(scratch));await rm(root,{recursive:true,force:true});}});
async function setup(){await mkdir(scratch,{recursive:true});const root=await mkdtemp(path.join(scratch,'atelier-stage3-'));roots.push(root);const service=await AtelierHandlers.open(root);services.push(service);return {root,service};}
async function raw(service:AtelierHandlers,type:string,payload:Record<string,unknown>,owner='one') {return (await service.handle(owner,JSON.stringify({type:'atelier.'+type,v:1,clientRequestId:randomUUID(),payload}))).reply;}
async function call(service:AtelierHandlers,type:string,payload:Record<string,unknown>,owner='one'){const reply=await raw(service,type,payload,owner);if(!reply.ok)throw new Error(JSON.stringify(reply.error));return reply.result;}
async function upload(service:AtelierHandlers,bytes:Buffer,pid?:string,name='notes.md',role='asset',owner='one'){
 const result=await call(service,'transfer.begin',{direction:'upload',purpose:pid?'file':'backup-import',...(pid?{designProjectId:pid,fileRole:role}:{}),name,totalBytes:bytes.length,sha256:sha256(bytes)},owner);
 const id=String((result.transfer as Record<string,unknown>).transferId);
 for(let offset=0,index=0;offset<bytes.length;offset+=CHUNK_BYTES,index++)await call(service,'transfer.chunk',{transferId:id,index,dataBase64:bytes.subarray(offset,offset+CHUNK_BYTES).toString('base64')},owner);
 return call(service,'transfer.finish',{transferId:id},owner);
}
async function download(service:AtelierHandlers,descriptor:Record<string,unknown>){const chunks:Buffer[]=[];for(let index=0;;index++){const r=await call(service,'transfer.read',{transferId:descriptor.transferId,index});chunks.push(Buffer.from(String(r.dataBase64),'base64'));if(r.last)break;}const bytes=Buffer.concat(chunks);expect(sha256(bytes)).toBe(descriptor.sha256);return bytes;}
function sample(){const p=domain.makeSample('photo');for(const d of domain.allDecisions(p)){d.status='confirmed';d.reviewNeeded=false;}p.concepts[0].selected=true;p.intent={choice:'match',reason:'합성 검증',revision:p.revision};return p;}

it('strict envelopes, unknown fields, scope/version mismatch and unsupported AI never mutate storage',async()=>{
 const {service}=await setup();const p=domain.newProject({name:'A'});await service.store.insert(p);
 for(const [type,payload,code]of [
 ['project.update',{designProjectId:p.id,expectedVersion:1,patch:{cwd:'C:/outside'}},'INVALID_MESSAGE'],
 ['entity.mutate',{designProjectId:p.id,expectedVersion:1,kind:'fields',action:'patch',entityId:'user',value:{status:'confirmed'}},'INVALID_MESSAGE'],
 ['project.update',{designProjectId:p.id,expectedVersion:9,patch:{name:'bad'}},'VERSION_CONFLICT'],
 ['ai.propose',{},'INVALID_MESSAGE'],['snapshot.create',{designProjectId:p.id,expectedVersion:1,mode:'final'},'INVALID_SELECTION']
 ] as const){const reply=await raw(service,type,payload);expect(reply).toMatchObject({ok:false,error:{code}});}
 expect((await service.store.get(p.id)).version).toBe(1);
 const reply=(await service.handle('one',JSON.stringify({type:'atelier.project.list',v:2,clientRequestId:randomUUID(),payload:{}}))).reply;expect(reply).toMatchObject({ok:false,error:{code:'UNSUPPORTED_VERSION'}});
 expect((await service.handle('one','[')).reply.ok).toBe(false);
 await call(service,'entity.mutate',{designProjectId:p.id,expectedVersion:1,kind:'screens',action:'add',value:{value:'한 화면',role:'작업'}});
 const screen=(await service.store.get(p.id)).screens[0];
 await call(service,'entity.mutate',{designProjectId:p.id,expectedVersion:2,kind:'flows',action:'add',value:{value:'직접 연결',steps:[screen.id],graph:{entryId:screen.id,terminalIds:[screen.id],transitions:[],branchPolicy:'none',branchReason:'한 화면',recoveryPolicy:'none',recoveryReason:'진단용'}}});
 expect((await service.store.get(p.id)).flows[0].graph).toMatchObject({entryId:screen.id,terminalIds:[screen.id],branchPolicy:'none',version:1,reviewedVersion:0});
});
it('optimistic writes, snapshot immutability, file hashes and project ownership survive restart',async()=>{
 const {root,service}=await setup(),p=sample();domain.makeSnapshot(p);await service.store.insert(p);const original=JSON.stringify(p.snapshots);
 await service.store.mutate(p.id,1,p=>{p.name='new';});
 await expect(service.store.mutate(p.id,1,p=>{p.name='stale';})).rejects.toMatchObject({code:'VERSION_CONFLICT'});
 await expect(service.store.mutate(p.id,2,p=>{p.snapshots=[];})).rejects.toMatchObject({code:'IMMUTABLE_SNAPSHOT'});
 const f=await service.files.add(p.id,'notes.md',Buffer.from('# 실제 바이트'),'asset');const other=domain.newProject({name:'B'});await service.store.insert(other);
 await expect(service.files.read(other.id,f.id)).rejects.toMatchObject({code:'PROJECT_MISMATCH'});
 await writeFile(await service.store.paths.target(service.files.relative(p.id,f)),Buffer.from('tampered'));
 await expect(service.files.read(p.id,f.id)).rejects.toMatchObject({code:'HASH_MISMATCH'});
 await writeFile(await service.store.paths.target(service.files.relative(p.id,f)),Buffer.from('# 실제 바이트'));
 await service.store.close();services.splice(services.indexOf(service),1);
 const next=await AtelierHandlers.open(root);services.push(next);expect((await next.store.get(p.id)).name).toBe('new');expect(JSON.stringify((await next.store.get(p.id)).snapshots)).toBe(original);expect((await next.files.read(p.id,f.id)).bytes.toString()).toBe('# 실제 바이트');
 const db=new DatabaseSync(path.join(root,'.local-data/atelier/atelier.sqlite'));expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(2);db.close();
});
it('all seven original JSON backups import as new projects and preserve frozen legacy snapshots and bytes',async()=>{
 const {service}=await setup();const directory=path.resolve('atelier/atelier/examples');
 for(const name of (await readdir(directory)).filter(f=>f.endsWith('.atelier.json'))){
   const bytes=await readFile(path.join(directory,name)),original=JSON.parse(bytes.toString());
   validateProject(structuredClone(original.project));
   const transfer=await upload(service,bytes);const imported=await call(service,'backup.import',{transferId:transfer.transferId});
   const id=String((imported.project as Record<string,unknown>).id),restored=await service.store.get(id);
   expect(id).not.toBe(original.project.id);expect(JSON.stringify(restored.snapshots)).toBe(JSON.stringify(original.project.snapshots));
   const exported=await call(service,'backup.export',{designProjectId:id,format:'atelier-backup'});const backup=JSON.parse((await download(service,exported.download as Record<string,unknown>)).toString());
   for(const file of original.files)expect(backup.files.find((f:{id:string})=>f.id===file.id).data).toBe(file.data);
 }
});
it('scoped ZIP has exact original bytes, CRC and manifest; unknown snapshot never falls back',async()=>{
 const {service}=await setup(),p=sample();await service.store.insert(p);
 const a=await service.files.add(p.id,'one.md',Buffer.from('# SELECTED'),'asset'),b=await service.files.add(p.id,'two.json',Buffer.from('{"unused":true}'),'content');
 await service.store.mutate(p.id,1,p=>{
   p.assets.push(domain.decision('선택 자료','user','confirmed',{fileId:a.id,scopeMode:'targets',screenIds:[p.screens[0].id]}),domain.decision('다른 자료','user','confirmed',{fileId:b.id,scopeMode:'targets',screenIds:[p.screens[4].id]}));
   p.output.selection={mode:'screens',ids:[p.screens[0].id]};domain.makeSnapshot(p,{draft:true});
 });
 const snapshot=(await service.store.get(p.id)).snapshots[0];
 const response=await call(service,'bundle.export',{designProjectId:p.id,snapshotId:snapshot.id}),bytes=await download(service,response.download as Record<string,unknown>);
 const entries=new Map<string,Buffer>();let offset=0;while(bytes.readUInt32LE(offset)===0x04034b50){const size=bytes.readUInt32LE(offset+18),length=bytes.readUInt16LE(offset+26),name=bytes.toString('utf8',offset+30,offset+30+length),data=bytes.subarray(offset+30+length,offset+30+length+size);expect(crc32(data)).toBe(bytes.readUInt32LE(offset+14));entries.set(name,data);offset+=30+length+size;}
 expect(entries.get(`files/${a.id}${a.ext}`)?.toString()).toBe('# SELECTED');expect(entries.has(`files/${b.id}${b.ext}`)).toBe(false);expect(JSON.parse(entries.get('handoff.json')!.toString()).snapshotId).toBe(snapshot.id);
 expect(await raw(service,'bundle.export',{designProjectId:p.id,snapshotId:'snap_missing'})).toMatchObject({ok:false,error:{code:'NOT_FOUND'}});
});
it('chunk canonical encoding/order/owner/hash/size/expiry and interrupted upload cleanup are enforced',async()=>{
 const {service}=await setup(),p=sample();await service.store.insert(p);
 const begin=()=>call(service,'transfer.begin',{direction:'upload',purpose:'file',designProjectId:p.id,fileRole:'asset',name:'a.md',totalBytes:3,sha256:sha256('abc')});
 const one=String(((await begin()).transfer as Record<string,unknown>).transferId);
 expect(await raw(service,'transfer.chunk',{transferId:one,index:0,dataBase64:'YWJj'},'two')).toMatchObject({ok:false,error:{code:'TRANSFER_EXPIRED'}});
 expect(await raw(service,'transfer.chunk',{transferId:one,index:1,dataBase64:'YWJj'})).toMatchObject({ok:false,error:{code:'TRANSFER_SEQUENCE'}});
 const two=String(((await begin()).transfer as Record<string,unknown>).transferId);
 expect(await raw(service,'transfer.chunk',{transferId:two,index:0,dataBase64:'YQ=A'})).toMatchObject({ok:false,error:{code:'INVALID_MESSAGE'}});
 await service.disconnect('one');expect(await readdir(path.join(service.store.paths.root,'transfers'))).toEqual([]);
 const three=String(((await begin()).transfer as Record<string,unknown>).transferId);
 await call(service,'transfer.chunk',{transferId:three,index:0,dataBase64:'eHl6'});expect(await raw(service,'transfer.finish',{transferId:three})).toMatchObject({ok:false,error:{code:'HASH_MISMATCH'}});
 let time=0;const transfers=new AtelierTransfers(service.files,()=>time);const t=await transfers.begin('one',{purpose:'backup-import',name:'b.json',totalBytes:2,sha256:sha256('{}')});time=60001;await expect(transfers.read('one',t.transferId,0)).rejects.toMatchObject({code:'TRANSFER_EXPIRED'});
 expect(await raw(service,'transfer.begin',{direction:'upload',purpose:'file',designProjectId:p.id,fileRole:'asset',name:'x.md',totalBytes:16*1024*1024,sha256:sha256('x')})).toMatchObject({ok:false,error:{code:'LIMIT_EXCEEDED'}});
});
it('junctions, missing files, corrupt backup and future DB versions fail closed without touching external data',async()=>{
 const {root,service}=await setup(),p=sample();await service.store.insert(p);
 const file=await service.files.add(p.id,'x.md',Buffer.from('safe'),'asset');await rm(await service.store.paths.target(service.files.relative(p.id,file)));await expect(service.files.read(p.id,file.id)).rejects.toMatchObject({code:'FILE_MISSING'});
 const transfer=await upload(service,Buffer.from('{"format":"atelier-handoff","version":1}'));expect(await raw(service,'backup.import',{transferId:transfer.transferId})).toMatchObject({ok:false,error:{code:'INVALID_MESSAGE'}});await service.disconnect('one');
 const temp=await mkdtemp(path.join(scratch,'atelier-stage3-'));roots.push(temp);await mkdir(path.join(temp,'.local-data'));await symlink(service.store.paths.root,path.join(temp,'.local-data','atelier'),'junction');await expect(AtelierStore.open(temp)).rejects.toMatchObject({code:'STORAGE_UNAVAILABLE'});
 await service.store.close();services.splice(services.indexOf(service),1);const dbpath=path.join(root,'.local-data/atelier/atelier.sqlite'),db=new DatabaseSync(dbpath);db.exec('PRAGMA user_version=99');db.close();const before=await readFile(dbpath);await expect(AtelierStore.open(root)).rejects.toMatchObject({code:'UNSUPPORTED_VERSION'});expect(await readFile(dbpath)).toEqual(before);
});
it('pre-commit failures clean orphans; post-commit journal failures preserve bytes and recover on restart',async()=>{
 const {root,service}=await setup(),p=sample();await service.store.insert(p);
 const failRow=vi.spyOn(service.store,'addFile').mockRejectedValueOnce(new Error('synthetic row failure'));
 await expect(service.files.add(p.id,'before.md',Buffer.from('before'),'asset')).rejects.toThrow('synthetic row');failRow.mockRestore();
 expect(await readdir(path.join(service.store.paths.root,'files',p.id))).toEqual([]);
 const failJournal=vi.spyOn(service.store,'clearJournal').mockRejectedValueOnce(new Error('synthetic cleanup failure'));
 await expect(service.files.add(p.id,'after.md',Buffer.from('preserved'),'asset')).rejects.toThrow('synthetic cleanup');failJournal.mockRestore();
 const file=(await service.store.files(p.id))[0];expect((await service.files.read(p.id,file.id)).bytes.toString()).toBe('preserved');
 await service.store.close();services.splice(services.indexOf(service),1);const next=await AtelierHandlers.open(root);services.push(next);expect((await next.files.read(p.id,file.id)).bytes.toString()).toBe('preserved');
});
it('unknown IDs, metadata tampering, corrupt images, traversal and backup references cannot become stored success',async()=>{
 const {service}=await setup(),p=sample();await service.store.insert(p);
 await expect(service.store.paths.read('../history.json',100)).rejects.toMatchObject({code:'INVALID_MESSAGE'});
 await expect(service.files.add(p.id,'bad.png',Buffer.from([137,80,78,71,13,10,26,10,...Array(25).fill(0)]),'reference')).rejects.toMatchObject({code:'INVALID_MESSAGE'});
 const backup={format:'atelier-backup',version:1,project:{...p,assets:[domain.decision('missing','user','confirmed',{fileId:'file_missing'})]},files:[]};
 const uploaded=await upload(service,Buffer.from(JSON.stringify(backup)));expect(await raw(service,'backup.import',{transferId:uploaded.transferId})).toMatchObject({ok:false,error:{code:'FILE_MISSING'}});
 expect((await service.store.list()).length).toBe(1);await service.disconnect('one');
 const good=await service.files.add(p.id,'good.md',Buffer.from('good'),'asset');
 const begin=await call(service,'transfer.begin',{direction:'upload',purpose:'file',designProjectId:p.id,fileRole:'asset',name:'later.md',totalBytes:3,sha256:sha256('abc')});
 expect(await raw(service,'project.delete',{designProjectId:p.id,expectedVersion:1,confirmation:{projectId:p.id}})).toMatchObject({ok:false,error:{code:'BUSY'}});
 await service.disconnect('one');
 await service.store.mutate(p.id,1,p=>{domain.makeSnapshot(p,{draft:true});});
 await expect(service.store.mutate(p.id,2,p=>{p.snapshots[0]= {...p.snapshots[0],text:'changed'};})).rejects.toMatchObject({code:'IMMUTABLE_SNAPSHOT'});
 expect((await service.files.read(p.id,good.id)).bytes.toString()).toBe('good');
 expect(await raw(service,'entity.mutate',{designProjectId:p.id,expectedVersion:2,kind:'references',action:'add',value:{name:'cross-project',fileId:'file_missing'}})).toMatchObject({ok:false,error:{code:'PROJECT_MISMATCH'}});
 expect((await service.store.get(p.id)).version).toBe(2);
});
it('bounded paging binds cursors to owner/version and control frames reject oversized/prototype payloads',async()=>{
 const {service}=await setup(),p=sample();await service.store.insert(p);
 const first=await call(service,'entity.list',{designProjectId:p.id,kind:'fields',limit:1});
 expect(await raw(service,'entity.list',{designProjectId:p.id,kind:'fields',limit:1,cursor:first.nextCursor},'two')).toMatchObject({ok:false,error:{code:'STALE_INPUT'}});
 await service.store.mutate(p.id,1,p=>{p.name='changed';});
 expect(await raw(service,'entity.list',{designProjectId:p.id,kind:'fields',limit:1,cursor:first.nextCursor})).toMatchObject({ok:false,error:{code:'STALE_INPUT'}});
 expect(await raw(service,'project.update',{designProjectId:p.id,expectedVersion:2,patch:{idea:'x'.repeat(256*1024)}})).toMatchObject({ok:false,error:{code:'LIMIT_EXCEEDED'}});
 expect(await raw(service,'toString',{})).toMatchObject({ok:false,error:{code:'CAPABILITY_UNAVAILABLE'}});
 const poison=`{"type":"atelier.project.update","v":1,"clientRequestId":"${randomUUID()}","payload":{"designProjectId":"${p.id}","expectedVersion":2,"patch":{"__proto__":{}}}}`;
 expect((await service.handle('one',poison)).reply).toMatchObject({ok:false,error:{code:'INVALID_MESSAGE'}});
});
it('per-connection/global transfer reservations and consumed chunk indices remain bounded',async()=>{
 const {service}=await setup();const payload={purpose:'backup-import' as const,name:'b.json',totalBytes:2,sha256:sha256('{}')};
 const a=await service.transfers.begin('one',payload),b=await service.transfers.begin('one',payload);
 await expect(service.transfers.begin('one',payload)).rejects.toMatchObject({code:'LIMIT_EXCEEDED'});
 await service.transfers.chunk('one',a.transferId,0,'e30=');await expect(service.transfers.chunk('one',a.transferId,0,'e30=')).rejects.toMatchObject({code:'TRANSFER_SEQUENCE'});
 await service.transfers.abort('one',b.transferId);
 const owners=['one','two','three','four'];for(const owner of owners){await service.transfers.begin(owner,payload);await service.transfers.begin(owner,payload);}
 await expect(service.transfers.begin('five',payload)).rejects.toMatchObject({code:'LIMIT_EXCEEDED'});
 for(const owner of owners)await service.disconnect(owner);
 expect(await readdir(path.join(service.store.paths.root,'transfers'))).toEqual([]);
});
it('concurrent stale writers commit exactly one version and retain Korean character name limits',async()=>{
 const {service}=await setup(),p=domain.newProject({name:'설'.repeat(120)});validateProject(p);await service.store.insert(p);
 let release!:()=>void;const barrier=new Promise<void>(resolve=>{release=resolve;});let arrived=0;
 const change=(name:string)=>service.store.mutate(p.id,1,async p=>{p.name=name;if(++arrived===2)release();await barrier;});
 const results=await Promise.allSettled([change('first'),change('second')]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
 expect(results.find(r=>r.status==='rejected')).toMatchObject({status:'rejected',reason:{code:'VERSION_CONFLICT',currentVersion:2}});expect((await service.store.get(p.id)).version).toBe(2);
 expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
});
it('a second storage worker cannot clean a live owner transfer or open the same data directory',async()=>{
 const {root,service}=await setup();const p=sample();await service.store.insert(p);
 const transfer=await service.transfers.begin('one',{purpose:'backup-import',name:'backup.json',totalBytes:2,sha256:sha256('{}')});
 await expect(AtelierStore.open(root)).rejects.toMatchObject({code:'BUSY'});
 expect(await readdir(path.join(service.store.paths.root,'transfers'))).toEqual([transfer.transferId+'.tmp']);
 expect((await service.store.get(p.id)).name).toBe(p.name);
});
