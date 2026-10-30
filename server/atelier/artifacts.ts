import {randomUUID} from 'node:crypto';
import path from 'node:path';
import type {ArtifactManifest,ArtifactFile,RuntimeEvidence,ExecutionRecord} from '../../shared/atelier/artifacts.js';
import type {DesignGeneration} from '../../shared/atelier/execution.js';
import {AtelierStore} from './store.js';
import {artifactRelative,artifactTarget,readArtifact,verifyArtifactWorkspace} from './artifact-paths.js';
import {check} from './errors.js';
import {detectImage,sha256} from './resources.js';
import {domain} from './validation.js';

const active=(g:DesignGeneration)=>['preparing','dispatching','running','waitingApproval'].includes(g.state);
const codeExtensions=new Set(['.html','.htm','.css','.js','.mjs','.cjs','.ts','.tsx','.jsx','.json','.md','.txt','.svg','.xml','.yaml','.yml','.csv','.sql','.py','.ps1','.sh','.vue','.svelte','.toml']);
const warning=(m:ArtifactManifest,text:string)=>{if(!m.limitations.includes(text)&&m.limitations.length<24)m.limitations.push(text);};
const sameRuntime=(g:DesignGeneration,e:{threadId:string;turnId:string},strict=false)=>g.runtime.runId?g.runtime.tasks.some(t=>t.threadId===e.threadId&&(t.turnId===e.turnId||!strict&&!t.turnId)):g.runtime.threadId===e.threadId&&(g.runtime.turnId===e.turnId||!strict&&!g.runtime.turnId);
const metadataBytes=(m:ArtifactManifest)=>Buffer.byteLength(JSON.stringify({candidates:m.candidates,commands:m.commands}));

export class AtelierArtifacts {
  constructor(private store:AtelierStore){}
  blobRelative(m:ArtifactManifest,f:Pick<ArtifactFile,'id'>){return `artifacts/${m.projectId}/${m.id}/${f.id}.bin`;}
  async begin(g:DesignGeneration){
    const existing=await this.store.manifest(g.projectId,g.id);if(existing)return existing;
    const m:ArtifactManifest={contractVersion:1,id:'manifest_'+randomUUID(),projectId:g.projectId,generationId:g.id,snapshotId:g.snapshotId,version:1,phase:'recording',status:'pending',checkStatus:'notRun',sequence:0,candidates:[],commands:[],files:[],rejected:0,missing:0,limitations:['파일 변경 item에 나타난 경로만 수집합니다. 명령·외부 도구가 별도로 만든 미관측 파일은 자동 확인하지 않습니다.','명령 원문·stdout/stderr는 비밀 보호를 위해 보관하지 않습니다. 검사 종류와 실제 종료 코드만 기록합니다.'],createdAt:new Date().toISOString()};
    await this.store.saveManifest(m);return m;
  }
  private async save(m:ArtifactManifest){m.version++;await this.store.saveManifest(m);return m;}
  async record(pid:string,gid:string,e:RuntimeEvidence){
    const g=await this.store.generation(pid,gid),m=await this.store.manifest(pid,gid);
    if(!m||m.phase!=='recording'||!sameRuntime(g,e))return {recorded:false};
    m.sequence++;
    if(e.rejectedChanges){m.rejected+=e.rejectedChanges;warning(m,'파일 변경 이벤트의 경로 한도를 초과한 근거를 제외했습니다.');}
    if(e.type==='fileChange'&&e.status!=='declined')for(const change of e.changes||[]){
      let relative:string;try{relative=artifactRelative(g.input.workspacePath,change.path);}catch{m.rejected++;warning(m,'내부·비밀·workspace 외 경로는 수집하지 않았습니다.');continue;}
      const previous=m.candidates.findIndex(c=>c.relativePath===relative);
      if(previous<0&&m.candidates.length>=256){m.rejected++;warning(m,'산출물 경로 256개 한도를 초과한 항목이 있습니다.');continue;}
      const candidate={relativePath:relative,reportedChange:change.kind,itemId:e.itemId,threadId:e.threadId,turnId:e.turnId,sequence:m.sequence,sourceStatus:e.status};
      const before=m.candidates.slice();if(previous>=0)m.candidates[previous]=candidate;else m.candidates.push(candidate);
      if(metadataBytes(m)>80*1024){m.candidates=before;m.rejected++;warning(m,'산출물 근거 메타데이터 한도를 초과한 항목을 제외했습니다.');}
    }
    if(e.type==='commandExecution'){
      const previous=m.commands.findIndex(c=>c.itemId===e.itemId&&c.threadId===e.threadId&&c.turnId===e.turnId);
      if(previous>=0&&m.commands[previous].status!=='inProgress')return {recorded:false};
      if(previous<0&&m.commands.length>=64){warning(m,'명령 기록 64개 한도를 초과했습니다.');await this.save(m);return {recorded:false};}
      const record:ExecutionRecord={itemId:e.itemId,threadId:e.threadId,turnId:e.turnId,...(e.taskId?{taskId:e.taskId}:{}),label:e.commandLabel||'로컬 명령 (원문·출력 미보관)',status:e.status,...(e.checkKind?{checkKind:e.checkKind}:{}),...(e.exitCode!==undefined?{exitCode:e.exitCode}:{}),...(e.durationMs!==undefined?{durationMs:e.durationMs}:{}),observedAt:e.observedAt,sequence:m.sequence,artifactHashes:{},bindingValid:false,outputRetained:false};
      if(e.checkKind&&e.status==='completed'&&e.exitCode===0){
        const normalize=(v:string)=>process.platform==='win32'?v.toLowerCase():v;
        let bytes=0,valid=m.candidates.length>0&&!!e.commandCwd&&path.isAbsolute(e.commandCwd)&&normalize(path.resolve(e.commandCwd))===normalize(g.input.workspacePath);
        try{await verifyArtifactWorkspace(g.input.workspacePath);}catch{valid=false;}
        for(const candidate of m.candidates){
          if(candidate.reportedChange==='delete'){valid=false;continue;}
          const remaining=512*1024*1024-(m.checkpointBytes||0);if(remaining<=0){valid=false;warning(m,'검사 hash 확인의 실행별 512MiB 읽기 한도에 도달했습니다.');break;}
          try{const file=await readArtifact(g.input.workspacePath,candidate.relativePath,Math.min(15*1024*1024,remaining));m.checkpointBytes=(m.checkpointBytes||0)+file.bytes.length;bytes+=file.bytes.length;if(bytes>90*1024*1024||file.mtimeMs>Date.parse(e.observedAt)){valid=false;break;}record.artifactHashes[candidate.relativePath]=file.hash;}catch{valid=false;}
        }
        record.bindingValid=valid;
      }
      if(previous>=0)m.commands[previous]=record;else m.commands.push(record);
      if(metadataBytes(m)>110*1024){record.artifactHashes={};record.bindingValid=false;warning(m,'명령 hash 메타데이터 한도를 초과해 검사 통과를 확인하지 않습니다.');}
      if(metadataBytes(m)>110*1024){m.commands=m.commands.filter(c=>c!==record);m.rejected++;warning(m,'명령 메타데이터 한도를 초과한 근거를 제외했습니다.');}
    }
    await this.save(m);return {recorded:true};
  }
  async finish(pid:string,gid:string){
    const g=await this.store.generation(pid,gid);check(!active(g),'실행 종료 전에는 산출물을 확정하지 않습니다.','BUSY');
    const m=await this.store.manifest(pid,gid);if(!m)return {manifest:null};
    if(m.phase==='ready'){const attached=await this.attach(pid,gid);return {...attached,manifest:await this.store.manifest(pid,gid)};}
    if(m.phase==='interrupted')return {manifest:m};
    m.phase='collecting';await this.save(m);
    await this.store.paths.directory(`artifacts/${pid}/${m.id}`);
    let total=0;
    for(const candidate of m.candidates){
      if(!sameRuntime(g,candidate,true)){m.rejected++;warning(m,'최종 runtime ID와 일치하지 않는 파일 근거를 제외했습니다.');continue;}
      if(candidate.reportedChange==='delete'){
        try{await artifactTarget(g.input.workspacePath,candidate.relativePath);m.rejected++;warning(m,'삭제로 보고됐지만 파일이 남아 있어 삭제 완료로 표시하지 않습니다.');}
        catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT'&&Buffer.byteLength(JSON.stringify(m))+Buffer.byteLength(candidate.relativePath)<200*1024){m.deleted??=[];m.deleted.push(candidate.relativePath);}else{m.rejected++;warning(m,'삭제 경로의 실제 상태·메타데이터 한도를 검증할 수 없습니다.');}}
        continue;
      }
      try{
        const captured=await readArtifact(g.input.workspacePath,candidate.relativePath);total+=captured.bytes.length;
        check(total<=90*1024*1024,'산출물 총량 한도입니다.','LIMIT_EXCEEDED');
        const image=detectImage(captured.bytes),ext=path.extname(candidate.relativePath).toLowerCase();
        const code=!image&&codeExtensions.has(ext)&&!captured.bytes.includes(0);
        if(code)new TextDecoder('utf-8',{fatal:true}).decode(captured.bytes);
        const file:ArtifactFile={id:'artifact_'+randomUUID(),relativePath:candidate.relativePath,hash:captured.hash,size:captured.bytes.length,kind:image?'image':code?'code':'binary',mime:image?.mime||'text/plain',reportedChange:candidate.reportedChange,itemId:candidate.itemId,threadId:candidate.threadId,turnId:candidate.turnId,capturedAt:new Date().toISOString()};
        check(Buffer.byteLength(JSON.stringify({...m,files:[...m.files,file]}))<=200*1024,'산출물 파일 메타데이터 한도입니다.','LIMIT_EXCEEDED');
        await this.store.paths.reserve(captured.bytes.length);
        const relative=this.blobRelative(m,file),operation=await this.store.journal([relative]);
        const h=await this.store.paths.exclusive(relative);try{await h.writeFile(captured.bytes);await h.sync();}finally{await h.close();}
        const copied=await this.store.paths.read(relative,15*1024*1024);check(sha256(copied)===file.hash,'산출물 사본 해시가 다릅니다.','HASH_MISMATCH');
        m.files.push(file);await this.save(m);await this.store.clearJournal(operation);
      }catch(error){
        if((error as NodeJS.ErrnoException).code==='ENOENT'){m.missing++;warning(m,'실행 기록에 있지만 실제 파일이 없는 경로가 있습니다.');}
        else{m.rejected++;warning(m,'경로·형식·크기·해시·비밀 검사를 통과하지 못한 파일이 있습니다.');}
      }
    }
    m.commands=m.commands.filter(c=>sameRuntime(g,c,true));
    const latest=new Map<string,ExecutionRecord>();for(const c of m.commands)if(c.checkKind)latest.set(c.checkKind,c);
    m.checkStatus=!latest.size?'notRun':[...latest.values()].some(c=>c.status==='failed'||c.exitCode!==undefined&&c.exitCode!==0)?'failed':!m.rejected&&!m.missing&&[...latest.values()].every(c=>c.status==='completed'&&c.exitCode===0&&c.bindingValid&&m.files.length>0&&m.files.every(f=>c.artifactHashes[f.relativePath]===f.hash&&!m.candidates.some(p=>p.relativePath===f.relativePath&&p.sequence>c.sequence)))?'passed':'unverifiable';
    m.status=m.files.length||m.deleted?.length?(m.rejected||m.missing||g.state!=='completed'||m.candidates.some(c=>c.sourceStatus!=='completed')?'partial':'verified'):m.missing&&!m.rejected?'missing':'unverifiable';
    if(!m.files.length)warning(m,'확인한 실제 파일이 없습니다. 실행 종료나 모델의 파일 목록을 파일 생성 증거로 사용하지 않습니다.');
    if(m.checkStatus==='unverifiable')warning(m,'검사 종료 코드가 있어도 현재 산출물 hash와 검사 시점의 연결이 확인되지 않으면 통과로 표시하지 않습니다.');
    m.phase='ready';m.capturedAt=new Date().toISOString();await this.save(m);
    g.artifactStatus=m.status;g.version++;g.updatedAt=new Date().toISOString();await this.store.saveGeneration(g);
    const attached=await this.attach(pid,gid);return {...attached,manifest:await this.store.manifest(pid,gid)};
  }
  async attach(pid:string,gid:string,expectedVersion?:number){
    const m=await this.store.manifest(pid,gid);check(m&&m.phase==='ready','확정된 산출물 기록이 없습니다.','NOT_FOUND');
    if(m.resultId)return {resultId:m.resultId};
    if(!m.files.length&&!m.deleted?.length&&!m.commands.some(c=>c.status!=='inProgress'))return {};
    const g=await this.store.generation(pid,gid),p=await this.store.get(pid);check(g.snapshotId===m.snapshotId&&p.snapshots.some(s=>s.id===m.snapshotId),'원본 스냅샷 연결이 다릅니다.','PROJECT_MISMATCH');
    const resultId=domain.uid('result');m.resultId=resultId;m.version++;
    const changed=await this.store.mutate(pid,expectedVersion??p.version,p=>{
      p.results.push({id:resultId,number:p.results.length+1,snapshotId:m.snapshotId,fileId:null,source:'Codex App Server 실제 기록',environment:'검증된 로컬 workspace',screen:`제작 ${gid}`,execution:`실행 ${g.state}; 실제 파일 ${m.files.length}; 명령 기록 ${m.commands.length}; 산출물 ${m.status}; 검사 ${m.checkStatus}. 사용자 동작 검토와 별도입니다.`,generationId:gid,artifactManifestId:m.id,executionSource:'runtime',behaviorEvidence:'',note:m.limitations.join('\n')});
    },undefined,m);
    return {resultId,project:{id:changed.id,version:changed.version,revision:changed.revision}};
  }
  async read(pid:string,gid:string,artifactId:string,preview:boolean){
    const m=await this.store.manifest(pid,gid);check(m&&(m.phase==='ready'||m.phase==='interrupted'),'산출물이 아직 수집되지 않았습니다.','NOT_FOUND');
    const f=m.files.find(f=>f.id===artifactId);check(f,'이 실행의 산출물이 아닙니다.','PROJECT_MISMATCH');
    const bytes=await this.store.paths.read(this.blobRelative(m,f),15*1024*1024);check(bytes.length===f.size&&sha256(bytes)===f.hash,'보관한 산출물의 해시가 다릅니다.','HASH_MISMATCH');
    const image=f.kind==='image'?detectImage(bytes):null;check(f.kind!=='image'||image?.mime===f.mime,'보관 이미지가 손상되었습니다.','HASH_MISMATCH');
    check(!preview||f.kind!=='binary','바이너리는 코드 미리보기를 제공하지 않습니다.','CAPABILITY_UNAVAILABLE');
    const limited=preview&&f.kind==='code'?bytes.subarray(0,256*1024):bytes;
    return {file:f,bytes:limited,truncated:limited.length<bytes.length,mime:f.kind==='image'?f.mime:'text/plain'};
  }
}
