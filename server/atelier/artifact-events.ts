import type {ProtocolNotification} from '../codex-app-server.js';
import type {RuntimeEvidence} from '../../shared/atelier/artifacts.js';
import {object} from './schema.js';

/** Known verification commands only; arbitrary shell text/output is never stored as a check. */
export function checkCommand(command:unknown):Pick<RuntimeEvidence,'commandLabel'|'checkKind'> {
  if(typeof command!=='string'||command.length>8192)return {commandLabel:'로컬 명령 (원문·출력 미보관)'};
  let text=command.trim();
  const wrapped=/^(?:"[^"\r\n]*[\\/]powershell\.exe"|powershell(?:\.exe)?|pwsh(?:\.exe)?)\s+(?:-NoProfile\s+)?-Command\s+(["'])([^"'\r\n]+)\1$/i.exec(text);
  if(wrapped)text=wrapped[2].trim();
  const match=/^(?:npm(?:\.cmd)?)\s+(test|run\s+(typecheck|build|test))\s*$/.exec(text);
  if(!match)return {commandLabel:'로컬 명령 (원문·출력 미보관)'};
  return {commandLabel:text.replace(/^npm\.cmd/,'npm'),checkKind:(match[2]||'test') as 'typecheck'|'build'|'test'};
}
export function artifactEvidence(n:ProtocolNotification,taskId?:string):RuntimeEvidence|null {
  if(!['item/started','item/completed'].includes(n.method)||!object(n.params?.item))return null;
  const p=n.params!,item=p.item as Record<string,unknown>;
  if(!['fileChange','commandExecution'].includes(String(item.type)))return null;
  if(![item.id,p.threadId,p.turnId].every(v=>typeof v==='string'&&v.length>0&&v.length<=200))return null;
  const status=n.method==='item/started'?'inProgress':String(item.status);
  if(!['inProgress','completed','failed','declined'].includes(status))return null;
  const base:RuntimeEvidence={itemId:String(item.id),threadId:String(p.threadId),turnId:String(p.turnId),...(taskId?{taskId}:{}),observedAt:new Date().toISOString(),type:item.type as RuntimeEvidence['type'],status:status as RuntimeEvidence['status']};
  if(item.type==='commandExecution')return {...base,...checkCommand(item.command),...(typeof item.cwd==='string'&&item.cwd.length<=2048?{commandCwd:item.cwd}:{}),...(Number.isSafeInteger(item.exitCode)?{exitCode:Number(item.exitCode)}:{}),...(typeof item.durationMs==='number'&&item.durationMs>=0?{durationMs:Math.min(item.durationMs,86400000)}:{})};
  if(n.method!=='item/completed'||!Array.isArray(item.changes))return null;
  const changes:NonNullable<RuntimeEvidence['changes']>=[];
  for(const c of item.changes.slice(0,256))if(object(c)&&typeof c.path==='string'&&c.path.length<=2048){
    const kind=object(c.kind)?c.kind.type:c.kind;
    if(!['add','update','delete'].includes(String(kind)))continue;
    changes.push({path:c.path,kind:kind as 'add'|'update'|'delete'});
    if(object(c.kind)&&typeof c.kind.move_path==='string'&&c.kind.move_path.length<=2048)changes.push({path:c.kind.move_path,kind:'update'});
  }
  return {...base,changes:changes.slice(0,256),rejectedChanges:Math.max(0,item.changes.length-256)+Math.max(0,changes.length-256)};
}
