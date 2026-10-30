import { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import type { Reply, WorkerResult } from './handlers.js';
import { AtelierError, safeError } from './errors.js';
import { object } from './schema.js';

/** Only Atelier work goes through this worker. Existing execution/approval queues stay independent. */
export class AtelierClient {
  async executionCall(method:string,payload:Record<string,unknown>):Promise<Record<string,unknown>>{
    await this.ready;if(this.failure)throw new AtelierError('STORAGE_UNAVAILABLE',this.failure.message);
    return await this.call('',{executionInternal:{method,payload}}) as unknown as Record<string,unknown>;
  }
  async proposalCall(method:'prepare'|'running'|'complete'|'fail',payload:Record<string,unknown>):Promise<Record<string,unknown>>{
    await this.ready;if(this.failure)throw new AtelierError('STORAGE_UNAVAILABLE',this.failure.message);
    const result=await this.call('',{proposalInternal:{method,payload}});return result as unknown as Record<string,unknown>;
  }
  private worker:Worker;
  private next=0;
  private pending=new Map<number,{resolve:(v:WorkerResult)=>void;reject:(e:unknown)=>void}>();
  private ready:Promise<void>;
  private failure:ReturnType<typeof safeError>|null=null;
  private epoch=randomUUID();private seq=0;
  private owners=new Map<string,{busy:boolean;control:number;chunks:number;at:number}>();
  constructor(root:string,private readonly emit:(event:Record<string,unknown>)=>void) {
    this.worker=new Worker(new URL('./worker.js',import.meta.url),{workerData:{root},resourceLimits:{maxOldGenerationSizeMb:512}});
    this.ready=new Promise(resolve=>{
      this.worker.on('message',(m:WorkerResult & {id?:number;ready?:boolean;error?:ReturnType<typeof safeError>})=>{
        if(m.ready!==undefined){if(!m.ready)this.failure=m.error||safeError(null);resolve();return;}
        const pending=m.id?this.pending.get(m.id):undefined;if(!pending)return;this.pending.delete(m.id!);
        if(m.error)pending.reject(new AtelierError(m.error.code,m.error.message,m.error.currentVersion));else pending.resolve(m);
      });
      const failed=()=>{this.failure=safeError(null);for(const p of this.pending.values())p.reject(new AtelierError('STORAGE_UNAVAILABLE','설계 저장소 worker가 종료되었습니다. 다시 시작하세요.'));this.pending.clear();resolve();};
      this.worker.on('error',failed);this.worker.on('exit',failed);
    });
  }
  private call(owner:string,extra:Record<string,unknown>) {
    const id=++this.next;return new Promise<WorkerResult>((resolve,reject)=>{this.pending.set(id,{resolve,reject});this.worker.postMessage({id,owner,...extra});});
  }
  async handle(owner:string,raw:string,propose?:()=>Promise<Reply>):Promise<Reply> {
    let clientRequestId='';
    try {
      const request:unknown=JSON.parse(raw);if(object(request)&&typeof request.clientRequestId==='string'&&request.clientRequestId.length<=64)clientRequestId=request.clientRequestId;
      const state=this.owners.get(owner)||{busy:false,control:20,chunks:32,at:Date.now()},now=Date.now(),elapsed=(now-state.at)/1000;
      state.control=Math.min(20,state.control+elapsed);state.chunks=Math.min(32,state.chunks+elapsed*32);state.at=now;this.owners.set(owner,state);
      const bucket=object(request)&&['atelier.transfer.chunk','atelier.transfer.read'].includes(String(request.type))?'chunks':'control';
      if(state[bucket]<1)throw new AtelierError('LIMIT_EXCEEDED','설계 요청 속도 한도입니다. 잠시 후 다시 시도하세요.');state[bucket]--;
      if(state.busy||this.pending.size>=8)throw new AtelierError('BUSY','이전 설계 요청의 응답을 기다린 뒤 다시 시도하세요.');
      state.busy=true;
      try {
        await this.ready;
        if(this.failure)return {type:'atelier.response',v:1,clientRequestId,ok:false,error:this.failure};
        if(this.pending.size>=8)throw new AtelierError('BUSY','설계 저장소 요청 한도입니다. 잠시 후 다시 시도하세요.');
        if(propose&&object(request)&&['atelier.ai.propose','atelier.ai.interrupt','atelier.binding.set','atelier.generation.start','atelier.generation.interrupt'].includes(String(request.type)))return await propose();
        const result=await this.call(owner,{raw});
        if(result.changed)this.emit({type:'atelier.project.changed',v:1,serverEpoch:this.epoch,seq:++this.seq,designProjectId:result.changed.id,payload:{version:result.changed.version,revision:result.changed.revision}});
        return result.reply;
      } finally {state.busy=false;}
    } catch(error) {return {type:'atelier.response',v:1,clientRequestId,ok:false,error:safeError(error)};}
  }
  async disconnect(owner:string) {this.owners.delete(owner);await this.ready;if(!this.failure)await this.call(owner,{disconnect:true});}
  async close(){await this.ready;if(!this.failure)await this.call('',{close:true});await this.worker.terminate();}
}
