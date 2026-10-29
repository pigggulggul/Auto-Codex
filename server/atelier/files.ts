import { rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { Project } from '../../shared/atelier/types.js';
import { AtelierStore, type FileRecord } from './store.js';
import { check } from './errors.js';
import { FILE_LIMIT, detectImage, detectResource, sha256 } from './resources.js';
import { domain } from './validation.js';

export class AtelierFiles {
  constructor(public readonly store: AtelierStore) {}
  relative(pid: string,f: FileRecord) { return `files/${pid}/${f.id}${f.ext}`; }
  async read(pid: string, id: string) {
    const record = await this.store.file(pid,id), bytes = await this.store.paths.read(this.relative(pid,record),FILE_LIMIT);
    check(bytes.length === record.size && sha256(bytes) === record.sha256,'파일 바이트 또는 해시가 다릅니다.','HASH_MISMATCH');
    const format = detectResource(bytes,record.name); check(format && format.ext === record.ext && format.mime === record.mime,'파일 형식이 변경되었습니다.','HASH_MISMATCH');
    return {record,bytes};
  }
  record(bytes: Buffer,name: string,id = 'file_'+randomUUID(),imageOnly = false): FileRecord {
    check(bytes.length > 0 && bytes.length <= FILE_LIMIT,'파일은 1byte~15MiB여야 합니다.','LIMIT_EXCEEDED');
    const fmt = imageOnly ? detectImage(bytes) : detectResource(bytes,name);
    check(fmt,'지원하지 않거나 손상된 파일 형식입니다.');
    return {id,name,mime:fmt.mime,ext:fmt.ext,sha256:sha256(bytes),size:bytes.length};
  }
  async stage(pid: string,record: FileRecord,bytes: Buffer) {
    await this.store.paths.directory(`files/${pid}`);
    const relative = this.relative(pid,record);
    const handle = await this.store.paths.exclusive(relative);
    try { await this.store.paths.target(relative); await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  }
  async add(pid: string,name: string,bytes: Buffer,role: string) {
    await this.store.get(pid);
    const record = this.record(bytes,name,undefined,!['asset','content'].includes(role));
    const relative = this.relative(pid,record), operation = await this.store.journal([relative]);
    let committed=false;
    try { await this.stage(pid,record,bytes); await this.store.addFile(pid,record); committed=true; await this.store.clearJournal(operation); return record; }
    catch(error) { if(!committed){await this.store.paths.remove(relative); await this.store.clearJournal(operation);} throw error; }
  }
  async validate(p: Project) {
    for(const d of domain.allDecisions(p))if(d.fontAssetId){const asset=p.assets.find(a=>a.id===d.fontAssetId);check(asset?.fileId,'실제 서체 파일을 연결하세요.');const file=await this.store.file(p.id,asset.fileId);check(file.mime.startsWith('font/'),'서체 연결에는 실제 서체 파일만 사용할 수 있습니다.');}
    const ids = new Set([...domain.fileIds(p),...p.snapshots.flatMap(s=>s.referenceFileIds)]);
    const images = new Set([...p.references.flatMap(r=>[r.fileId,...r.regions.flatMap(a=>[a.fileId,a.cropId])]),...p.results.map(r=>r.fileId)].filter((id):id is string=>!!id));
    // Images in frozen inputs must remain images too.
    for (const snap of p.snapshots) for (const ref of snap.input.references) for (const id of [ref.fileId,...ref.regions.flatMap(a=>[a.fileId,a.cropId])]) if (id) images.add(id);
    for (const id of ids) { const {bytes} = await this.read(p.id,id); if (images.has(id)) check(detectImage(bytes),'원본·크롭·결과는 이미지여야 합니다.'); }
  }
  async moveFromTransfer(relative: string,pid: string,name: string,role: string) {
    const bytes = await this.store.paths.read(relative,FILE_LIMIT);
    const record = this.record(bytes,name,undefined,!['asset','content'].includes(role));
    await this.store.paths.directory(`files/${pid}`);
    const target = this.relative(pid,record), operation = await this.store.journal([target]);
    let committed=false;
    try {
      // Destination uses a fresh UUID; never rename over a browser-selected name.
      await rename(await this.store.paths.target(relative),await this.store.paths.target(target));
      await this.store.paths.target(target); await this.store.addFile(pid,record); committed=true; await this.store.clearJournal(operation); return record;
    } catch(error) { if(!committed){await this.store.paths.remove(target); await this.store.clearJournal(operation);} throw error; }
  }
}
