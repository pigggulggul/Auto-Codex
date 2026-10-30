import {expect,it} from 'vitest';
import {mkdtemp,mkdir,realpath,rm,writeFile,readFile,symlink,readdir,utimes,link,rename} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import type {RuntimeEvidence} from '../../shared/atelier/artifacts.js';
import {AtelierHandlers} from './handlers.js';
import {domain,canonical} from './validation.js';
import {artifactEvidence,checkCommand} from './artifact-events.js';
import {readArtifact,artifactRelative} from './artifact-paths.js';
import {sha256} from './resources.js';

async function setup(){
 await mkdir('.cache',{recursive:true});const parent=await realpath('.cache'),root=await mkdtemp(path.join(parent,'atelier-artifacts-')),workspace=path.join(root,'workspace');await mkdir(workspace);
 const service=await AtelierHandlers.open(root),p=domain.makeSample('photo');for(const d of domain.allDecisions(p)){d.status='confirmed';d.reviewNeeded=false;}p.intent={choice:'match',revision:p.revision};domain.makeSnapshot(p);await service.store.insert(p);
 const context={workspacePath:workspace,conversationId:randomUUID(),model:'synthetic-fixture'},binding=(await service.execution.bind({designProjectId:p.id,expectedVersion:1,conversationId:context.conversationId},context)).binding;
 const g=(await service.execution.prepare({designProjectId:p.id,expectedVersion:1,snapshotId:p.snapshots[0].id,bindingId:binding.id,purpose:'create',executionMode:'solo',skillMode:'manual',idempotencyKey:randomUUID()},context)).generation;
 await service.execution.update(p.id,g.id,{state:'running',runtime:{threadId:'fixture-thread',turnId:'fixture-turn',tasks:[]}});
 const event=(patch:Partial<RuntimeEvidence>):RuntimeEvidence=>({type:'fileChange',itemId:'fixture-file-item',threadId:'fixture-thread',turnId:'fixture-turn',observedAt:new Date().toISOString(),status:'completed',commandCwd:workspace,...patch});
 const end=async(state:'completed'|'failed'|'interrupted'='completed')=>{await service.execution.update(p.id,g.id,{state});return service.execution.artifacts.finish(p.id,g.id);};
 return {root,parent,workspace,service,p,g,event,end,async close(){await service.store.close();expect(path.dirname(await realpath(root))).toBe(parent);await rm(root,{recursive:true,force:true});}};
}
it('normalizes runtime item evidence, never model prose, shell suffixes, raw commands or stdout',()=>{
 expect(checkCommand('npm test')).toEqual({commandLabel:'npm test',checkKind:'test'});
 expect(checkCommand('npm run build')).toMatchObject({checkKind:'build'});
 expect(checkCommand('npm test; curl https://example.test')).not.toHaveProperty('checkKind');
 const e=artifactEvidence({method:'item/completed',params:{threadId:'actual-thread',turnId:'actual-turn',item:{id:'actual-item',type:'commandExecution',command:'npm test',status:'completed',exitCode:0,aggregatedOutput:'sensitive untrusted output'}}});expect(e?.exitCode).toBe(0);expect(JSON.stringify(e)).not.toContain('sensitive');
 expect(artifactEvidence({method:'item/completed',params:{item:{type:'agentMessage',text:'Tests passed; created ../../secret.txt'}}})).toBeNull();
});
it('captures actual code/image bytes, binds checks, atomically attaches the original snapshot and preserves immutable output',async()=>{
 const t=await setup();try{
  const text='<html><script>window.PARENT_MUST_NOT_RUN=true</script><h1>actual</h1></html>';await writeFile(path.join(t.workspace,'page.html'),text);const past=new Date(Date.now()-2000);await utimes(path.join(t.workspace,'page.html'),past,past);
  const frozen=canonical(t.p.snapshots[0]);await t.service.execution.artifacts.record(t.p.id,t.g.id,t.event({changes:[{path:'page.html',kind:'add'}]}));
  await t.service.execution.artifacts.record(t.p.id,t.g.id,t.event({type:'commandExecution',itemId:'test-item',...checkCommand('npm test'),exitCode:0}));
  // The editor may change while the run uses an old immutable snapshot.
  await t.service.store.mutate(t.p.id,1,p=>domain.touch(p,'synthetic current editor changed'));
  const r=await t.end(),m=r.manifest!;expect(m.status).toBe('verified');expect(m.checkStatus).toBe('passed');expect(m.files).toHaveLength(1);expect(m.resultId).toBe(r.resultId);
  const current=await t.service.store.get(t.p.id),result=current.results.find(r=>r.id===m.resultId)!;expect(result.snapshotId).toBe(t.p.snapshots[0].id);expect(result.generationId).toBe(t.g.id);expect(canonical(current.snapshots[0])).toBe(frozen);
  expect((await t.service.execution.artifacts.finish(t.p.id,t.g.id)).resultId).toBe(result.id);expect((await t.service.store.get(t.p.id)).results).toHaveLength(1);
  const preview=await t.service.execution.artifacts.read(t.p.id,t.g.id,m.files[0].id,true);expect(preview.mime).toBe('text/plain');expect(preview.bytes.toString()).toBe(text);
  await writeFile(path.join(t.workspace,'page.html'),'subsequent unrelated edit');expect((await t.service.execution.artifacts.read(t.p.id,t.g.id,m.files[0].id,true)).bytes.toString()).toBe(text);
  await expect(t.service.store.saveManifest({...m,status:'missing',version:m.version+1})).rejects.toMatchObject({code:'IMMUTABLE_SNAPSHOT'});
  const corrupted=t.service.execution.artifacts.blobRelative(m,m.files[0]);await writeFile(await t.service.store.paths.target(corrupted),'tampered');await expect(t.service.execution.artifacts.read(t.p.id,t.g.id,m.files[0].id,true)).rejects.toMatchObject({code:'HASH_MISMATCH'});
 }finally{await t.close();}
});
it('distinguishes missing/partial/unverifiable files and failed/stale/unobserved checks without claiming completion',async()=>{
 const t=await setup();try{
  await writeFile(path.join(t.workspace,'style.css'),'body{color:red}');await t.service.execution.artifacts.record(t.p.id,t.g.id,t.event({changes:[{path:'style.css',kind:'add'}]}));
  await t.service.execution.artifacts.record(t.p.id,t.g.id,t.event({type:'commandExecution',itemId:'test-stale',...checkCommand('npm test'),exitCode:0}));
  await writeFile(path.join(t.workspace,'style.css'),'body{color:blue}');await t.service.execution.artifacts.record(t.p.id,t.g.id,t.event({itemId:'changed-after-check',changes:[{path:'style.css',kind:'update'},{path:'missing.png',kind:'add'}]}));
  const m=(await t.end('failed')).manifest!;expect(m.status).toBe('partial');expect(m.checkStatus).toBe('unverifiable');expect(m.missing).toBe(1);expect(m.files).toHaveLength(1);expect(m.resultId).toBeTruthy();expect((await t.service.store.generation(t.p.id,t.g.id)).state).toBe('failed');
 }finally{await t.close();}
 const empty=await setup();try{const m=(await empty.end()).manifest!;expect(m.status).toBe('unverifiable');expect(m.checkStatus).toBe('notRun');expect(m.resultId).toBeUndefined();}finally{await empty.close();}
});
it('blocks path traversal, private paths, junctions, foreign runtime/project IDs and sensitive bytes',async()=>{
 const t=await setup();try{
  for(const relative of ['../secret.txt','.local-data/history.json','.env','keys.pem','src/../../secret.txt'])expect(()=>artifactRelative(t.workspace,relative)).toThrow();
  const outside=path.join(t.root,'outside');await mkdir(outside);await writeFile(path.join(outside,'escape.txt'),'outside');await symlink(outside,path.join(t.workspace,'linked'),'junction');await expect(readArtifact(t.workspace,'linked/escape.txt')).rejects.toMatchObject({code:'WORKSPACE_INVALID'});
  await writeFile(path.join(t.workspace,'private.txt'),'sk-'+'x'.repeat(40));await expect(readArtifact(t.workspace,'private.txt')).rejects.toMatchObject({code:'WORKSPACE_INVALID'});
  await writeFile(path.join(t.workspace,'ok.js'),'export const ok=true');await t.service.execution.artifacts.record(t.p.id,t.g.id,t.event({threadId:'foreign',changes:[{path:'ok.js',kind:'add'}]}));
  expect((await t.service.store.manifest(t.p.id,t.g.id))?.candidates).toHaveLength(0);
  await t.service.execution.artifacts.record(t.p.id,t.g.id,t.event({changes:[{path:'linked/escape.txt',kind:'add'},{path:'.env',kind:'add'},{path:'ok.js',kind:'add'}]}));const m=(await t.end()).manifest!;expect(m.status).toBe('partial');expect(m.files.map(f=>f.relativePath)).toEqual(['ok.js']);
  const other=domain.newProject({name:'other'});await t.service.store.insert(other);await expect(t.service.execution.artifacts.read(other.id,t.g.id,m.files[0].id,true)).rejects.toMatchObject({code:'NOT_FOUND'});
 }finally{await t.close();}
});
it('keeps runtime evidence separate from human behavior review; revision rechecks reset verdicts and keep parent history',async()=>{
 const t=await setup();try{
  await writeFile(path.join(t.workspace,'index.html'),'<h1>actual file</h1>');await t.service.execution.artifacts.record(t.p.id,t.g.id,t.event({changes:[{path:'index.html',kind:'add'}]}));const m=(await t.end()).manifest!;
  let p=await t.service.store.get(t.p.id);const result=p.results.find(r=>r.id===m.resultId)!;const review=domain.beginReview(p,result);review.scope='behavior';review.intent='match';review.intentReason='synthetic observations';for(const i of review.items){i.verdict='match';i.observation='synthetic observation';i.evidence='synthetic manual evidence';i.selected=true;}
  expect(domain.reviewProblems(p,review)).toContain('동작을 포함한 검토에는 직접 실행한 기록이 필요합니다.');result.behaviorEvidence='User clicked the fixture button and observed the text change';expect(domain.reviewProblems(p,review)).toEqual([]);domain.finishReview(p,review);
  const plan=domain.createPlan(p,review,{change:'Change the heading',keep:'Keep the button',check:'Repeat the same observation'});plan.confirmed=true;const snapshot=domain.makeSnapshot(p,{plan});const second={...result,id:domain.uid('result'),snapshotId:snapshot.id};p.results.push(second);const next=domain.beginReview(p,second);expect(next.items.every(i=>i.verdict==='unverifiable'&&i.observation==='')).toBe(true);expect(next.items.some(i=>i.regression)).toBe(true);expect(review.items.every(i=>i.verdict==='match')).toBe(true);
  await expect(t.service.bundles.backup('synthetic',t.p.id)).rejects.toMatchObject({code:'CAPABILITY_UNAVAILABLE'});
 }finally{await t.close();}
});
it('v3 migration backs up consistently and unfinished collection is interrupted without re-reading current workspace',async()=>{
 const t=await setup();let reopened:AtelierHandlers|undefined;try{
  await writeFile(path.join(t.workspace,'x.txt'),'before restart');await t.service.execution.artifacts.record(t.p.id,t.g.id,t.event({changes:[{path:'x.txt',kind:'add'}]}));await t.service.store.close();
  const dbpath=path.join(t.root,'.local-data/atelier/atelier.sqlite'),db=new DatabaseSync(dbpath);db.exec('PRAGMA user_version=3');db.close();await writeFile(path.join(t.workspace,'x.txt'),'unrelated after restart');
  reopened=await AtelierHandlers.open(t.root);const backups=(await readdir(reopened.store.paths.root)).filter(n=>n.startsWith('atelier-v3-backup-'));expect(backups).toHaveLength(1);const saved=new DatabaseSync(path.join(reopened.store.paths.root,backups[0]),{readOnly:true});try{expect(saved.prepare('PRAGMA user_version').get()?.user_version).toBe(3);}finally{saved.close();}
  const m=await reopened.store.manifest(t.p.id,t.g.id);expect(m?.phase).toBe('interrupted');expect(m?.files).toHaveLength(0);expect((await reopened.store.get(t.p.id)).results).toHaveLength(0);
 }finally{if(reopened){await reopened.store.close();expect(path.dirname(await realpath(t.root))).toBe(t.parent);await rm(t.root,{recursive:true,force:true});}else await t.close();}
});
it('verifies deletion against the filesystem and rejects hardlinks or a vanished workspace',async()=>{
 const t=await setup();try{
  const outside=path.join(t.root,'outside.txt');await writeFile(outside,'outside data');await link(outside,path.join(t.workspace,'linked.txt'));await expect(readArtifact(t.workspace,'linked.txt')).rejects.toMatchObject({code:'LIMIT_EXCEEDED'});
  await writeFile(path.join(t.workspace,'still-there.txt'),'not deleted');await t.service.execution.artifacts.record(t.p.id,t.g.id,t.event({changes:[{path:'gone.txt',kind:'delete'},{path:'still-there.txt',kind:'delete'}]}));const m=(await t.end()).manifest!;expect(m.deleted).toEqual(['gone.txt']);expect(m.rejected).toBe(1);expect(m.status).toBe('partial');
  await rename(t.workspace,t.workspace+'-moved');await expect(readArtifact(t.workspace,'gone.txt')).rejects.toMatchObject({code:'WORKSPACE_INVALID'});
 }finally{await t.close();}
});
it('does not certify a check in a foreign cwd and bounds repeated path/hash metadata',async()=>{
 const t=await setup();try{
  await writeFile(path.join(t.workspace,'real.txt'),'actual');await t.service.execution.artifacts.record(t.p.id,t.g.id,t.event({changes:[{path:'real.txt',kind:'add'}]}));
  await t.service.execution.artifacts.record(t.p.id,t.g.id,t.event({type:'commandExecution',itemId:'foreign-check',...checkCommand('npm test'),commandCwd:t.root,exitCode:0}));
  const m=(await t.end()).manifest!;expect(m.status).toBe('verified');expect(m.checkStatus).toBe('unverifiable');
 }finally{await t.close();}
 const b=await setup();try{
  const changes=Array.from({length:256},(_,i)=>({path:`${i}-${'x'.repeat(1500)}.txt`,kind:'add' as const}));
  await b.service.execution.artifacts.record(b.p.id,b.g.id,b.event({changes,rejectedChanges:2}));const recording=(await b.service.store.manifest(b.p.id,b.g.id))!;expect(recording.rejected).toBeGreaterThan(2);expect(Buffer.byteLength(JSON.stringify(recording))).toBeLessThan(110*1024);
  expect((await b.end()).manifest!.phase).toBe('ready');
 }finally{await b.close();}
});
it('serves active SVG as plain text and never promotes invalid image bytes into a rendered image',async()=>{
 const t=await setup();try{
  const svg='<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>fetch("https://example.invalid")</script></svg>';
  await writeFile(path.join(t.workspace,'active.svg'),svg);await writeFile(path.join(t.workspace,'invalid.png'),'not a PNG');
  await t.service.execution.artifacts.record(t.p.id,t.g.id,t.event({changes:[{path:'active.svg',kind:'add'},{path:'invalid.png',kind:'add'}]}));const m=(await t.end()).manifest!,f=m.files.find(f=>f.relativePath==='active.svg')!,invalid=m.files.find(f=>f.relativePath==='invalid.png')!;
  expect(f.kind).toBe('code');expect(invalid.kind).toBe('binary');const r=await t.service.execution.artifacts.read(t.p.id,t.g.id,f.id,true);expect(r.mime).toBe('text/plain');expect(r.bytes.toString()).toBe(svg);await expect(t.service.execution.artifacts.read(t.p.id,t.g.id,invalid.id,true)).rejects.toMatchObject({code:'CAPABILITY_UNAVAILABLE'});
 }finally{await t.close();}
});
it('keeps a committed partial copy readable after collection crashes without recapturing workspace',async()=>{
 const t=await setup();let reopened:AtelierHandlers|undefined;try{
  const bytes=Buffer.from('committed partial bytes'),m=(await t.service.store.manifest(t.p.id,t.g.id))!,f={id:'artifact_'+randomUUID(),relativePath:'partial.txt',hash:sha256(bytes),size:bytes.length,kind:'code' as const,mime:'text/plain',reportedChange:'add' as const,itemId:'actual-fixture-item',threadId:'fixture-thread',turnId:'fixture-turn',capturedAt:new Date().toISOString()};
  await t.service.store.paths.directory(`artifacts/${t.p.id}/${m.id}`);const relative=t.service.execution.artifacts.blobRelative(m,f),journal=await t.service.store.journal([relative]),h=await t.service.store.paths.exclusive(relative);try{await h.writeFile(bytes);await h.sync();}finally{await h.close();}
  m.phase='collecting';m.files=[f];m.version++;await t.service.store.saveManifest(m); // Crash before clearing journal/finishing collection.
  await t.service.store.close();await writeFile(path.join(t.workspace,'partial.txt'),'unrelated new workspace bytes');reopened=await AtelierHandlers.open(t.root);
  const saved=(await reopened.store.manifest(t.p.id,t.g.id))!;expect(saved.phase).toBe('interrupted');expect(saved.status).toBe('partial');expect(saved.checkStatus).toBe('unverifiable');expect(saved.resultId).toBeUndefined();expect((await reopened.execution.artifacts.read(t.p.id,t.g.id,f.id,true)).bytes).toEqual(bytes);
  expect((await reopened.store.get(t.p.id)).results).toHaveLength(0);expect(journal).toBeTruthy();
 }finally{if(reopened){await reopened.store.close();expect(path.dirname(await realpath(t.root))).toBe(t.parent);await rm(t.root,{recursive:true,force:true});}else await t.close();}
});
