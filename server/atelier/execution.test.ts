import {it,expect} from 'vitest';
import {mkdtemp,mkdir,rm,realpath,readFile,writeFile,symlink,readdir,rename} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {AtelierHandlers} from './handlers.js';
import {domain,canonical} from './validation.js';
import {sha256} from './resources.js';
import {InputStaging} from './staging.js';
import {generationStartRule} from './execution.js';
import {AtelierExecutionRuntime} from './execution-runtime.js';
import type {AtelierClient} from './client.js';

async function fixture(){
  const parent=await realpath('.cache'),root=await mkdtemp(path.join(parent,'atelier-generation-'));const service=await AtelierHandlers.open(root);
  const workspace=path.join(root,'workspace');await mkdir(workspace);
  const p=domain.makeSample('photo');for(const d of domain.allDecisions(p)){d.status='confirmed';d.reviewNeeded=false;}p.intent={choice:'match',revision:p.revision};
  domain.makeSnapshot(p);await service.store.insert(p);
  const context={workspacePath:workspace,conversationId:randomUUID(),model:'fixture'};
  const {binding}=await service.execution.bind({designProjectId:p.id,expectedVersion:p.version,conversationId:context.conversationId},context);
  const request={designProjectId:p.id,expectedVersion:p.version,snapshotId:p.snapshots[0].id,bindingId:binding.id,purpose:'create',executionMode:'solo',skillMode:'manual',idempotencyKey:randomUUID()};
  return {root,service,p,workspace,context,binding,request,async close(){await service.store.close();expect(path.dirname(await realpath(root))).toBe(parent);await rm(root,{recursive:true,force:true});}};
}
it('stages only snapshot-owned bytes and durable InputManifest without changing frozen input or source files',async()=>{
  const t=await fixture();try{
    const included=await t.service.files.add(t.p.id,'source.txt',Buffer.from('selected input'),'asset');
    const omitted=await t.service.files.add(t.p.id,'private.txt',Buffer.from('not selected'),'asset');
    const p=await t.service.store.mutate(t.p.id,1,p=>{p.assets.push(domain.decision('selected asset','user','confirmed',{fileId:included.id}));p.intent={choice:'match',revision:p.revision};domain.makeSnapshot(p);});
    const snap=p.snapshots.at(-1)!,frozen=canonical(snap);const request={...t.request,expectedVersion:p.version,snapshotId:snap.id};
    const {generation:g,prompt}=await t.service.execution.prepare(request,t.context);
    expect(g.input.files.map(f=>f.id)).toEqual([included.id]);expect(g.input.files.some(f=>f.id===omitted.id)).toBe(false);
    expect(g.input.snapshotHash).toBe(sha256(frozen));expect(g.input.networkAccess).toBe(false);expect(g.runtime).toEqual({tasks:[]});
    const staged=JSON.parse(await readFile(path.join(t.workspace,g.stagingPath,'input-manifest.json'),'utf8'));expect(staged).toEqual(g.input);
    expect(await readFile(path.join(t.workspace,g.input.files[0].relativePath),'utf8')).toBe('selected input');
    expect((await t.service.files.read(t.p.id,included.id)).bytes.toString()).toBe('selected input');
    expect(canonical((await t.service.store.get(t.p.id)).snapshots.at(-1))).toBe(frozen);expect(prompt).toContain(snap.text);
    await t.service.execution.verify(t.p.id,g.id);
    await writeFile(path.join(t.workspace,g.stagingPath,'prompt.md'),'changed staged prompt');
    await expect(t.service.execution.verify(t.p.id,g.id)).rejects.toMatchObject({code:'HASH_MISMATCH'});
    const again=await t.service.execution.prepare(request,t.context);expect(again.reused).toBe(true);expect(again.generation.id).toBe(g.id);
    await expect(t.service.execution.prepare({...request,executionMode:'team'},t.context)).rejects.toMatchObject({code:'IDEMPOTENCY_CONFLICT'});
  }finally{await t.close();}
});
it('history failure never dispatches a turn; uncertain termination retains the shared admission lock',async()=>{
 const t=await fixture();try{
  const storage={executionCall:async(method:string,b:Record<string,unknown>)=>method==='lookup'?{generation:(await t.service.store.generations(String(b.projectId))).find(g=>g.idempotencyKey===b.key)}:method==='prepare'?t.service.execution.prepare(b.request as Record<string,unknown>,t.context):method==='verify'?t.service.execution.verify(String(b.projectId),String(b.id)):t.service.execution.update(String(b.projectId),String(b.id),b.patch as Parameters<typeof t.service.execution.update>[2])} as unknown as AtelierClient;
  let dispatched=false,stopCalled=false;const runtime=new AtelierExecutionRuntime(storage,{busy:()=>false,context:async()=>t.context,start:async()=>{await runtime.beforeDispatch(['message-user','message-assistant']);dispatched=true;},interrupt:async()=>{},stop:async()=>{stopCalled=true;throw new Error('termination uncertain');},flush:async()=>{throw new Error('history unavailable');},emit:()=>{}});
  const raw=(payload:Record<string,unknown>)=>JSON.stringify({type:'atelier.generation.start',v:1,clientRequestId:randomUUID(),payload});
  const reply=await runtime.request(raw(t.request));expect(reply.ok).toBe(false);expect(dispatched).toBe(false);expect(stopCalled).toBe(true);expect(runtime.busy).toBe(true);
  const second=await runtime.request(raw({...t.request,idempotencyKey:randomUUID()}));expect(second.ok).toBe(false);if(!second.ok)expect(second.error.code).toBe('BUSY');
  expect((await t.service.store.generations(t.p.id))[0].state).toBe('interrupted');
 }finally{await t.close();}
});
it('rejects draft, foreign snapshot/binding/conversation, stale version, browser permissions and corrupted bytes',async()=>{
  const t=await fixture();try{
    for(const patch of [{snapshotId:'snap_foreign'},{bindingId:'bind_foreign'},{expectedVersion:999},{purpose:'revise'}])await expect(t.service.execution.prepare({...t.request,...patch},t.context)).rejects.toHaveProperty('code');
    await expect(t.service.execution.prepare(t.request,{...t.context,conversationId:randomUUID()})).rejects.toMatchObject({code:'WORKSPACE_INVALID'});
    expect(()=>generationStartRule({...t.request,sandboxPolicy:{type:'dangerFullAccess'}})).toThrow();
    await t.service.store.mutate(t.p.id,1,p=>{domain.baseline(p,'diagnostic only');});
    const p=await t.service.store.get(t.p.id);await expect(t.service.execution.prepare({...t.request,expectedVersion:p.version,snapshotId:p.snapshots.at(-1)!.id},t.context)).rejects.toMatchObject({code:'INVALID_SELECTION'});
    const f=await t.service.files.add(t.p.id,'input.txt',Buffer.from('selected'),'asset');const next=await t.service.store.mutate(t.p.id,p.version,p=>{p.assets.push(domain.decision('asset','user','confirmed',{fileId:f.id}));domain.makeSnapshot(p);});
    await writeFile(await t.service.store.paths.target(t.service.files.relative(t.p.id,f)),Buffer.from('tampered'));
    await expect(t.service.execution.prepare({...t.request,expectedVersion:next.version,snapshotId:next.snapshots.at(-1)!.id},t.context)).rejects.toMatchObject({code:'HASH_MISMATCH'});
    expect((await t.service.store.generations(t.p.id))[0].state).toBe('failed');
  }finally{await t.close();}
});
it('staging refuses junction escape, existing generation, disappearing workspace and overwrites',async()=>{
  const t=await fixture();try{
    const outside=path.join(t.root,'elsewhere');await mkdir(outside);await symlink(outside,path.join(t.workspace,'.auto-codex'),'junction');
    await expect(t.service.execution.prepare(t.request,t.context)).rejects.toMatchObject({code:'WORKSPACE_INVALID'});
    expect(await readdir(outside)).toEqual([]);
    const safe=path.join(t.root,'safe');await mkdir(safe);const stage=new InputStaging(safe,'gen_'+randomUUID());await stage.create(1);await stage.write('prompt.md',Buffer.from('first'));
    await expect(stage.write('prompt.md',Buffer.from('second'))).rejects.toHaveProperty('code','EEXIST');
    await expect(stage.create(1)).rejects.toHaveProperty('code','EEXIST');
    await rename(safe,safe+'-moved');await expect(stage.verify()).rejects.toHaveProperty('code','ENOENT');
  }finally{await t.close();}
});
it('restart preserves IDs/idempotency and marks dispatch interrupted without replaying or restoring permissions',async()=>{
  const t=await fixture();let reopened:AtelierHandlers|undefined;try{
    const g=(await t.service.execution.prepare(t.request,t.context)).generation;
    await t.service.execution.update(t.p.id,g.id,{state:'dispatching',messageIds:['synthetic-user','synthetic-assistant'],runtime:{threadId:'actual-fixture-thread',tasks:[]}});
    await t.service.store.close();reopened=await AtelierHandlers.open(t.root);
    const stored=await reopened.store.generation(t.p.id,g.id);expect(stored.state).toBe('interrupted');expect(stored.error?.code).toBe('RUNTIME_OUTCOME_UNKNOWN');expect(stored.runtime.threadId).toBe('actual-fixture-thread');
    expect((await reopened.execution.prepare(t.request,t.context)).generation.id).toBe(g.id);
    const terminal=await reopened.execution.update(t.p.id,g.id,{state:'running'});expect(terminal.generation.state).toBe('interrupted');
    expect(await reopened.store.binding(t.p.id)).toEqual(t.binding);
  }finally{if(reopened){await reopened.store.close();expect(path.dirname(await realpath(t.root))).toBe(await realpath('.cache'));await rm(t.root,{recursive:true,force:true});}else await t.close();}
});
it('v2 migration has a consistent pre-migration backup and leaves design and legacy history untouched',async()=>{
  const t=await fixture();let reopened:AtelierHandlers|undefined;try{
    const original=canonical(await t.service.store.get(t.p.id));await t.service.store.close();
    const db=new DatabaseSync(path.join(t.root,'.local-data/atelier/atelier.sqlite'));db.exec('DROP TABLE generations; DROP TABLE bindings; PRAGMA user_version=2');db.close();
    reopened=await AtelierHandlers.open(t.root);expect(canonical(await reopened.store.get(t.p.id))).toBe(original);
    const backups=(await readdir(reopened.store.paths.root)).filter(n=>n.startsWith('atelier-v2-backup-'));expect(backups).toHaveLength(1);
    const saved=new DatabaseSync(path.join(reopened.store.paths.root,backups[0]),{readOnly:true});try{expect(saved.prepare('PRAGMA user_version').get()?.user_version).toBe(2);expect(JSON.parse(String(saved.prepare('SELECT json FROM projects').get()?.json)).id).toBe(t.p.id);}finally{saved.close();}
  }finally{if(reopened){await reopened.store.close();expect(path.dirname(await realpath(t.root))).toBe(await realpath('.cache'));await rm(t.root,{recursive:true,force:true});}else await t.close();}
});
