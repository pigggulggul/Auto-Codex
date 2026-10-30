import type {ClientMessage,ReasoningEffort,ServerMessage} from '../../shared/protocol.js';
import type {DesignGeneration} from '../../shared/atelier/execution.js';
import type {AtelierClient} from './client.js';
import type {Reply} from './handlers.js';
import {check,safeError} from './errors.js';
import {executionRules} from './execution.js';
import {canonical} from './validation.js';
import {sha256} from './resources.js';
import * as s from './schema.js';
import type {ProtocolNotification} from '../codex-app-server.js';
import {artifactEvidence} from './artifact-events.js';
import type {ArtifactManifest} from '../../shared/atelier/artifacts.js';

type Start=Extract<ClientMessage,{type:'turn.start'}>;
type Context={workspacePath:string;conversationId:string;model:string;effort?:ReasoningEffort;skillPath?:string};
/** Admission covers validation, staging, history flush, dispatch and terminal persistence. */
export class AtelierExecutionRuntime {
  private reserved=false;private active:DesignGeneration|null=null;private cancelled=false;
  private updates=Promise.resolve();private approvals=new Set<string>();private dispatchDone=false;private terminal=false;
  private soloAwaiting=false;private identityFailed=false;private earlyNotifications:ProtocolNotification[]=[];private earlyBytes=0;
  get busy(){return this.reserved;}
  ownsProject(id:unknown){return this.active?.projectId===id;}
  constructor(private storage:AtelierClient,private options:{busy:()=>boolean;context:(request:s.Obj)=>Promise<Context>;start:(message:Start)=>Promise<void>;interrupt:()=>Promise<void>;stop:()=>Promise<void>;flush:()=>Promise<void>;emit:(e:Record<string,unknown>)=>void}){}
  private emit(g:DesignGeneration){this.options.emit({type:'atelier.generation.state',v:1,designProjectId:g.projectId,payload:{generationId:g.id,snapshotId:g.snapshotId,conversationId:g.conversationId,version:g.version,state:g.state,runtime:g.runtime}});}
  private update(patch:Partial<Pick<DesignGeneration,'state'|'runtime'|'messageIds'|'error'>>){
    const a=this.active;if(!a)return;
    // Capture the payload now; later runtime events may mutate their source arrays.
    const fixed=structuredClone(patch);Object.assign(a,structuredClone(fixed));
    this.updates=this.updates.then(async()=>{const result=await this.storage.executionCall('update',{projectId:a.projectId,id:a.id,patch:fixed});const saved=result.generation as unknown as DesignGeneration;if(this.active?.id===a.id){this.active.version=saved.version;this.emit(saved);}});
    void this.updates.catch(()=>{/* Callers await this same rejected chain; admission remains reserved. */});
  }
  async request(raw:string):Promise<Reply>{
    let clientRequestId='';
    try{
      check(Buffer.byteLength(raw)<=256*1024);const r=s.obj(JSON.parse(raw));if(typeof r.clientRequestId==='string')clientRequestId=r.clientRequestId;
      s.shape({type:s.one(['atelier.binding.set','atelier.generation.start','atelier.generation.interrupt']),v:s.one([1]),clientRequestId:s.uuid,payload:s.json})(r);
      const type=String(r.type).slice(8),b=s.obj(r.payload);executionRules[type](b);
      const reply=(result:Record<string,unknown>):Reply=>({type:'atelier.response',v:1,clientRequestId,ok:true,result});
      if(type==='generation.interrupt'){
        check(this.active&&this.active.id===b.generationId&&this.active.projectId===b.designProjectId,'현재 실행 중인 이 제작이 아닙니다.','NOT_FOUND');await this.interrupt();return reply({kind:'interruptRequested'});
      }
      if(type==='generation.start'){
        const {expectedVersion:_,...intent}=b;
        const old=(await this.storage.executionCall('lookup',{projectId:b.designProjectId,key:b.idempotencyKey})).generation as DesignGeneration|undefined;
        if(old){check(old.requestHash===sha256(canonical(intent)),'실행 키에 다른 입력을 사용할 수 없습니다.','IDEMPOTENCY_CONFLICT');return reply({kind:'generation',generation:old,reused:true});}
      }
      check(!this.reserved&&!this.options.busy(),'다른 Codex 실행이 진행 중입니다.','BUSY');this.reserved=true;this.cancelled=false;this.dispatchDone=false;this.terminal=false;
      try{
        const context=await this.options.context(b);
        if(type==='binding.set')return reply({kind:'binding',...await this.storage.executionCall('bind',{request:b,context:{workspacePath:context.workspacePath,conversationId:context.conversationId}})});
        check(!this.cancelled,'준비 중 중단되었습니다.','RUNTIME_UNAVAILABLE');
        const prepared=await this.storage.executionCall('prepare',{request:b,context});const g=prepared.generation as unknown as DesignGeneration;
        if(prepared.reused)return reply({kind:'generation',generation:g,reused:true});
        this.active=g;this.emit(g);this.updates=Promise.resolve();this.approvals.clear();
        if(this.cancelled){this.update({state:'interrupted'});await this.updates;await this.collect();this.active=null;return reply({kind:'generation',generation:{...g,state:'interrupted'}});}
        try{
          // Same entry point, role router, scheduler, approval and conversation format as ordinary work.
          await this.options.start({type:'turn.start',prompt:String(prepared.prompt),skillMode:b.skillMode as Start['skillMode'],executionMode:b.executionMode as Start['executionMode'],model:context.model,...(context.effort?{effort:context.effort}:{}),...(b.skillPath?{skillPath:String(b.skillPath)}:{})});
          this.dispatchDone=true;await this.updates;
          if(this.cancelled&&!this.terminal)await this.options.interrupt();
          if(this.terminal)await this.release();
          return reply({kind:'generation',generation:this.active||g});
        }catch{
          // Lost dispatch responses are ambiguous. Terminate the exclusively admitted child before releasing.
          this.update({state:'interrupted',error:{code:'RUNTIME_OUTCOME_UNKNOWN',message:'실행 시작/저장 실패. 결과가 불명확하여 자동 재전송하지 않습니다.'}});
          try{await this.options.stop();}finally{await this.updates;}
          await this.options.flush();await this.collect();this.active=null;
          return reply({kind:'generation',generation:{...g,state:'interrupted'}});
        }
      }finally{if(!this.active)this.reserved=false;}
    }catch(error){return {type:'atelier.response',v:1,clientRequestId,ok:false,error:safeError(error)};}
  }
  /** Called after the existing user/reply placeholders exist, before any runtime dispatch. */
  async beforeDispatch(messageIds:string[]){if(!this.active)return;check(!this.cancelled,'제작 준비가 중단되었습니다.','RUNTIME_UNAVAILABLE');await this.storage.executionCall('verify',{projectId:this.active.projectId,id:this.active.id});await this.options.flush();check(!this.cancelled,'제작 준비가 중단되었습니다.','RUNTIME_UNAVAILABLE');this.update({state:'dispatching',messageIds});await this.updates;}
  async soloThread(threadId:string){if(!this.active)return;this.soloAwaiting=true;this.identityFailed=false;this.earlyNotifications=[];this.earlyBytes=0;this.update({runtime:{...this.active.runtime,threadId}});await this.updates;}
  async soloTurn(turnId:string){
    if(!this.active)return [];
    check(!this.identityFailed,'시작 응답 전 이벤트 한도 초과로 실행을 중단했습니다.','RUNTIME_UNAVAILABLE');
    this.update({runtime:{...this.active.runtime,turnId}});await this.updates;
    const buffered=this.earlyNotifications;this.earlyNotifications=[];this.earlyBytes=0;this.soloAwaiting=false;return buffered;
  }
  bufferNotification(n:ProtocolNotification){
    if(!this.active||!this.soloAwaiting||n.params?.threadId!==this.active.runtime.threadId)return false;
    if(this.identityFailed)return true;
    this.earlyBytes+=Buffer.byteLength(JSON.stringify(n));
    if(this.earlyNotifications.length>=512||this.earlyBytes>512*1024){
      // An unbounded pre-response stream cannot establish a trusted turn identity.
      this.earlyNotifications=[];this.identityFailed=true;void this.options.stop().catch(()=>{/* Keep admission if termination cannot be confirmed. */});return true;
    }
    this.earlyNotifications.push(n);return true;
  }
  evidence(n:ProtocolNotification,taskId?:string){
    const a=this.active;if(!a||this.terminal)return;
    const evidence=artifactEvidence(n,taskId);if(!evidence)return;
    this.updates=this.updates.then(async()=>{await this.storage.executionCall('artifact.record',{projectId:a.projectId,id:a.id,evidence});});
    void this.updates.catch(()=>{/* Terminal persistence detects failure and retains admission. */});
  }
  private async collect(){
    const a=this.active;if(!a)return;
    const result=await this.storage.executionCall('artifact.finish',{projectId:a.projectId,id:a.id});
    const m=result.manifest as ArtifactManifest|null;
    if(m)this.options.emit({type:'atelier.artifact.state',v:1,designProjectId:a.projectId,payload:{generationId:a.id,snapshotId:m.snapshotId,manifestId:m.id,version:m.version,status:m.status,checkStatus:m.checkStatus,resultId:result.resultId||m.resultId}});
    if(result.project)this.options.emit({type:'atelier.project.changed',v:1,designProjectId:a.projectId,payload:result.project});
  }
  observe(message:ServerMessage){
    const a=this.active;if(!a||this.terminal)return;
    if(message.type==='run.state'&&message.run){
      const run=message.run;if(a.runtime.runId&&a.runtime.runId!==run.id)return;
      const runtime={runId:run.id,tasks:run.tasks.map(t=>({taskId:t.id,agentId:t.agentId,...(t.threadId?{threadId:t.threadId}:{}),...(t.turnId?{turnId:t.turnId}:{})}))};
      const state=this.approvals.size?'waitingApproval':'running';if(canonical(a.runtime)!==canonical(runtime)||a.state!==state)this.update({runtime,state});
      if(['completed','failed','interrupted'].includes(run.status))this.finish(run.status as 'completed'|'failed'|'interrupted');
    }
    if(message.type==='turn.state'&&!message.runId&&a.input.executionMode==='solo'&&message.turnId){
      if(a.runtime.turnId&&a.runtime.turnId!==message.turnId)return;
      const runtime={...a.runtime,turnId:message.turnId};const state=this.approvals.size?'waitingApproval':'running';if(canonical(a.runtime)!==canonical(runtime)||a.state!==state)this.update({runtime,state});
      if(message.status!=='inProgress')this.finish(message.status==='completed'?'completed':message.status==='interrupted'?'interrupted':'failed');
    }
    if(message.type==='approval.request'){
      const p=message.approval;
      if(p.runId?a.runtime.runId===p.runId:a.runtime.threadId===p.threadId&&(!a.runtime.turnId||a.runtime.turnId===p.turnId)){this.approvals.add(p.approvalId);this.update({state:'waitingApproval'});}
    }
    if(message.type==='approval.resolved'&&this.approvals.delete(message.approvalId))this.update({state:this.approvals.size?'waitingApproval':'running'});
  }
  private finish(state:'completed'|'failed'|'interrupted'){if(this.terminal)return;this.terminal=true;this.update({state,...(state==='failed'?{error:{code:'RUNTIME_FAILED',message:'App Server 작업이 실패했습니다. 실제 오류는 연결된 대화·활동 기록에서 확인하세요.'}}:state==='interrupted'?{error:{code:'INTERRUPTED',message:'실행이 중단되었습니다. 자동 재실행하지 않습니다.'}}:{})});if(this.dispatchDone)void this.release().catch(()=>{/* storage failure keeps admission */});}
  private async release(){
    // Defer past the normalized event handler so conversation completion is persisted too.
    await new Promise<void>(resolve=>setImmediate(resolve));await this.options.flush();await this.updates;await this.collect();this.active=null;this.reserved=false;
  }
  async interrupt(){this.cancelled=true;if(this.active&&this.dispatchDone)await this.options.interrupt();}
  exited(){if(this.active)this.finish('failed');}
  accepts(threadId:unknown,turnId:unknown){const a=this.active;if(!a)return true;if(typeof threadId!=='string')return false;const r=a.runtime;if(a.input.executionMode==='team')return r.tasks.some(t=>t.threadId===threadId&&(!turnId||!t.turnId||t.turnId===turnId));return r.threadId===threadId&&(!turnId||!r.turnId||r.turnId===turnId);}
}
