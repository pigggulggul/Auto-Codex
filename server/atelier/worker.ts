import { parentPort, workerData } from 'node:worker_threads';
import { AtelierHandlers } from './handlers.js';
import { safeError } from './errors.js';
import type {DesignProposal,ProposalFailure} from '../../shared/atelier/proposals.js';

const port=parentPort!;
let service:AtelierHandlers | undefined;
try { service=await AtelierHandlers.open(String(workerData.root));port.postMessage({ready:true}); }
catch(error) {port.postMessage({ready:false,error:safeError(error)});}
let queue=Promise.resolve();
port.on('message',(message:{id:number;owner:string;raw?:string;disconnect?:boolean;close?:boolean;proposalInternal?:{method:string;payload:Record<string,unknown>}})=>{
  queue=queue.then(async()=>{
    if(message.close){await service?.store.close();port.postMessage({id:message.id,closed:true});return;}
    if(message.disconnect){await service?.disconnect(message.owner);port.postMessage({id:message.id});return;}
    if(message.proposalInternal&&service){
      const {method,payload:b}=message.proposalInternal;const pid=String(b.designProjectId),id=String(b.proposalId);
      const result=method==='prepare'?await service.proposals.prepare(b):method==='running'?{proposal:await service.proposals.running(pid,id,b.source as DesignProposal['source'])}:method==='complete'?{proposal:await service.proposals.complete(pid,id,String(b.text))}:method==='fail'?{proposal:await service.proposals.fail(pid,id,b.code as ProposalFailure)}:undefined;
      if(!result)throw new Error('Unknown internal proposal method');port.postMessage({id:message.id,...result});return;
    }
    if(service)port.postMessage({id:message.id,...await service.handle(message.owner,message.raw!)});
  }).catch((error)=>{port.postMessage({id:message.id,error:safeError(error)});});
});
setInterval(()=>{queue=queue.then(()=>service?.transfers.sweep()).catch(()=>{});},10000).unref();
