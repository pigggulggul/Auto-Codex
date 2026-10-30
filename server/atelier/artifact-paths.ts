import {constants} from 'node:fs';
import {lstat,open,realpath} from 'node:fs/promises';
import path from 'node:path';
import {check} from './errors.js';
import {FILE_LIMIT,sha256} from './resources.js';

const equal=(a:string,b:string)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
const privatePart=/^(?:node_modules|\.git|\.local-data|\.auto-codex|\.codex|\.agents|\.aws|\.ssh|\.env(?:\..*)?|credentials(?:\..*)?|secrets?(?:\..*)?|auth\.json)$/i;
export function artifactRelative(workspace:string,input:string){
  check(input.length>0&&input.length<=2048&&!input.includes('\0'),'산출물 경로가 올바르지 않습니다.','WORKSPACE_INVALID');
  check(!input.split(/[\\/]/).includes('..'),'경로 탈출을 거부했습니다.','WORKSPACE_INVALID');
  const target=path.resolve(workspace,input),relative=path.relative(workspace,target);
  check(relative&&!path.isAbsolute(relative)&&!relative.startsWith('..'+path.sep),'workspace 밖 산출물입니다.','WORKSPACE_INVALID');
  const parts=relative.split(path.sep);
  check(parts.every(p=>p&&p!=='.'&&!privatePart.test(p)&&(!p.startsWith('.')||p==='.cache')&&!/[<>:"|?*]/.test(p)),'내부·비밀 경로는 산출물로 열지 않습니다.','WORKSPACE_INVALID');
  check(!/\.(?:pem|key|p12|pfx|kdbx)$/i.test(relative),'비밀 파일은 산출물로 열지 않습니다.','WORKSPACE_INVALID');
  return parts.join('/');
}
export async function verifyArtifactWorkspace(workspace:string){
  let actual:string;try{actual=await realpath(workspace);}catch{check(false,'workspace가 사라졌습니다.','WORKSPACE_INVALID');}
  check(equal(actual,workspace),'workspace 실제 대상이 변경되었습니다.','WORKSPACE_INVALID');
  check((await lstat(workspace)).isDirectory(),'workspace가 폴더가 아닙니다.','WORKSPACE_INVALID');
}
export async function artifactTarget(workspace:string,relative:string){
  await verifyArtifactWorkspace(workspace);
  let current=workspace;
  for(const part of artifactRelative(workspace,relative).split('/')){
    current=path.join(current,part);const info=await lstat(current);
    check(!info.isSymbolicLink()&&equal(await realpath(current),current),'연결·junction 산출물은 열지 않습니다.','WORKSPACE_INVALID');
  }
  return current;
}
export async function readArtifact(workspace:string,relative:string,limit=FILE_LIMIT){
  const target=await artifactTarget(workspace,relative),h=await open(target,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
  try{
    const before=await h.stat(),named=await lstat(target);check(before.isFile()&&before.nlink===1&&before.size<=limit,'산출물은 단일 일반 파일이며 크기 한도 이하여야 합니다.','LIMIT_EXCEEDED');
    check(before.ino===named.ino&&before.dev===named.dev,'산출물 대상이 열기 중 변경되었습니다.','WORKSPACE_INVALID');
    const buffer=Buffer.alloc(before.size+1);let size=0;
    while(size<buffer.length){const r=await h.read(buffer,size,buffer.length-size,size);if(!r.bytesRead)break;size+=r.bytesRead;}
    const after=await h.stat();await artifactTarget(workspace,relative);const namedAfter=await lstat(target);
    check(size===before.size&&after.size===before.size&&after.mtimeMs===before.mtimeMs&&after.ctimeMs===before.ctimeMs&&after.ino===namedAfter.ino&&after.dev===namedAfter.dev&&after.nlink===1,'수집 중 산출물이 변경되었습니다.','HASH_MISMATCH');
    const bytes=buffer.subarray(0,size);
    check(!/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}/.test(bytes.toString('utf8')),'비밀 형태의 내용을 발견해 산출물 열람을 거부했습니다.','WORKSPACE_INVALID');
    return {bytes,hash:sha256(bytes),mtimeMs:after.mtimeMs};
  }finally{await h.close();}
}
