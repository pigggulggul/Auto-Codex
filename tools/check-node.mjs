import {pathToFileURL} from 'node:url';
import path from 'node:path';
export function supportsNode(version) {
  const [major,minor]=version.replace(/^v/,'').split('.').map(Number);
  return Number.isInteger(major) && (major>22 || major===22 && minor>=13);
}
export async function preflight(version=process.versions.node) {
  if(!supportsNode(version))throw new Error('Auto Codex requires Node.js 22.13.0 or newer (node:sqlite).');
  const {DatabaseSync}=await import('node:sqlite');
  const db=new DatabaseSync(':memory:');try{db.prepare('SELECT 1').get();}finally{db.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  try{await preflight();}catch(error){console.error(error.message);process.exitCode=1;}
}
