import type { DatabaseSync } from 'node:sqlite';
import { AtelierPaths } from './paths.js';
import { AtelierError, check } from './errors.js';
import { validateProject, canonical, domain } from './validation.js';
import type { Project } from '../../shared/atelier/types.js';
import { randomUUID } from 'node:crypto';
import { sha256 } from './resources.js';
import type {DesignProposal} from '../../shared/atelier/proposals.js';

export interface FileRecord { id:string; name:string; mime:string; ext:string; sha256:string; size:number }
export class AtelierStore {
  private constructor(public readonly paths: AtelierPaths, private readonly db: DatabaseSync,private readonly lockToken:string) {}
  static async open(root: string) {
    const paths = await AtelierPaths.open(root);
    const lockToken=await paths.lock();let db:DatabaseSync|undefined;
    try {
      for (const name of ['atelier.sqlite','atelier.sqlite-wal','atelier.sqlite-shm','atelier.sqlite-journal']) await paths.target(name);
      const {DatabaseSync} = await import('node:sqlite');
      db = new DatabaseSync(await paths.target('atelier.sqlite'));
      const version = Number(db.prepare('PRAGMA user_version').get()?.user_version);
      check(version <= 2,'더 높은 버전의 설계 저장소입니다. 기존 DB는 변경하지 않습니다.','UNSUPPORTED_VERSION');
      if (!version) {
        check(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().length === 0,'알 수 없는 기존 설계 DB입니다. 기존 파일을 보존합니다.','UNSUPPORTED_VERSION');
        db.exec(`BEGIN; CREATE TABLE projects(id TEXT PRIMARY KEY,version INTEGER NOT NULL,revision INTEGER NOT NULL,json TEXT NOT NULL);
          CREATE TABLE revisions(project_id TEXT NOT NULL,version INTEGER NOT NULL,json TEXT NOT NULL,PRIMARY KEY(project_id,version),FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE);
          CREATE TABLE files(project_id TEXT NOT NULL,id TEXT NOT NULL,name TEXT NOT NULL,mime TEXT NOT NULL,ext TEXT NOT NULL,sha256 TEXT NOT NULL,size INTEGER NOT NULL,PRIMARY KEY(project_id,id),FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE);
          CREATE TABLE snapshots(project_id TEXT NOT NULL,id TEXT NOT NULL,json TEXT NOT NULL,hash TEXT NOT NULL,PRIMARY KEY(project_id,id),FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE);
          CREATE TABLE operations(id TEXT PRIMARY KEY,json TEXT NOT NULL);
          CREATE TABLE settings(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL,json TEXT NOT NULL);
          INSERT INTO settings VALUES(1,1,'{}'); PRAGMA user_version=1; COMMIT;`);
      }
      if(version===1){
        // SQLite creates a consistent copy including WAL pages. Existing projects/files remain in place.
        const backup=await paths.target('atelier-v1-backup-'+randomUUID()+'.sqlite');
        db.prepare('VACUUM INTO ?').run(backup);
      }
      db.exec(`BEGIN; CREATE TABLE IF NOT EXISTS proposals(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,operation_key TEXT NOT NULL,json TEXT NOT NULL,UNIQUE(project_id,operation_key),FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE); PRAGMA user_version=2; COMMIT;`);
      db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
      const store = new AtelierStore(paths,db,lockToken);
      await store.recover(); await store.recoverProposals(); await paths.cleanTransfers();
      return store;
    } catch(error) { db?.close();await paths.unlock(lockToken);throw error; }
  }
  async close() { this.db.close();await this.paths.unlock(this.lockToken); }
  private async safe() { await this.paths.verifyRoot(); for (const f of ['atelier.sqlite','atelier.sqlite-wal','atelier.sqlite-shm','atelier.sqlite-journal']) await this.paths.target(f); }
  async get(id: string): Promise<Project> {
    await this.safe(); const row = this.db.prepare('SELECT json FROM projects WHERE id=?').get(id);
    check(row,'설계 프로젝트가 없습니다.','NOT_FOUND');
    const project=validateProject(JSON.parse(String(row.json)));
    for(const snapshot of project.snapshots){const saved=this.db.prepare('SELECT json,hash FROM snapshots WHERE project_id=? AND id=?').get(id,snapshot.id);check(saved&&saved.json===canonical(snapshot)&&saved.hash===sha256(String(saved.json)),'고정 스냅샷의 저장 내용 또는 해시가 다릅니다.','IMMUTABLE_SNAPSHOT');}
    return project;
  }
  async list() {
    await this.safe(); return this.db.prepare('SELECT id,version,revision,json FROM projects ORDER BY id').all().map(row=>{
      const p = JSON.parse(String(row.json)) as Project; return {id:p.id,name:p.name,version:p.version,revision:p.revision,entry:p.entry,type:p.type,updatedAt:p.updatedAt,progress:{tab:p.progress.tab},count:p.snapshots.length};
    });
  }
  async insert(project: Project, files: FileRecord[] = []) {
    await this.safe(); validateProject(project);
    this.db.exec('BEGIN IMMEDIATE');
    try { this.db.prepare('INSERT INTO projects VALUES(?,?,?,?)').run(project.id,project.version,project.revision,JSON.stringify(project)); for (const file of files) this.addFileRow(project.id,file); this.saveSnapshots(project); this.db.exec('COMMIT'); }
    catch(error) { this.db.exec('ROLLBACK'); throw error; }
  }
  private saveSnapshots(p: Project) {
    for (const snapshot of p.snapshots) {
      const serialized = canonical(snapshot), old = this.db.prepare('SELECT json FROM snapshots WHERE project_id=? AND id=?').get(p.id,snapshot.id);
      if (old) check(String(old.json) === serialized,'기존 스냅샷은 변경할 수 없습니다.','IMMUTABLE_SNAPSHOT');
      else this.db.prepare('INSERT INTO snapshots VALUES(?,?,?,?)').run(p.id,snapshot.id,serialized,sha256(serialized));
    }
    const count = Number(this.db.prepare('SELECT count(*) n FROM snapshots WHERE project_id=?').get(p.id)?.n);
    check(count === p.snapshots.length,'기존 스냅샷을 제거할 수 없습니다.','IMMUTABLE_SNAPSHOT');
  }
  async mutate(id: string, expectedVersion: number, mutation: (p: Project)=>void | Promise<void>, proposal?:DesignProposal) {
    const p = await this.get(id), original = JSON.stringify(p);
    if (p.version !== expectedVersion) throw new AtelierError('VERSION_CONFLICT','다른 창에서 먼저 저장했습니다. 현재 입력을 보존하고 최신 버전을 다시 여세요.',p.version);
    await mutation(p); validateProject(p); await this.safe();
    p.version++; p.updatedAt = new Date().toISOString();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const changed = this.db.prepare('UPDATE projects SET version=?,revision=?,json=? WHERE id=? AND version=?').run(p.version,p.revision,JSON.stringify(p),id,expectedVersion);
      if(changed.changes!==1){const current=this.db.prepare('SELECT version FROM projects WHERE id=?').get(id);throw new AtelierError('VERSION_CONFLICT','다른 창에서 먼저 저장했습니다.',current?Number(current.version):undefined);}
      this.db.prepare('INSERT INTO revisions VALUES(?,?,?)').run(id,expectedVersion,original);
      this.saveSnapshots(p); if(proposal)this.writeProposal(proposal); this.db.exec('COMMIT');
    } catch(error) { this.db.exec('ROLLBACK'); throw error; }
    return p;
  }
  async files(pid: string): Promise<FileRecord[]> {
    await this.safe();check(this.db.prepare('SELECT id FROM projects WHERE id=?').get(pid),'설계 프로젝트가 없습니다.','NOT_FOUND');return this.db.prepare('SELECT id,name,mime,ext,sha256,size FROM files WHERE project_id=? ORDER BY id').all(pid) as unknown as FileRecord[];
  }
  async file(pid: string,id: string) {
    await this.safe();const file=this.db.prepare('SELECT id,name,mime,ext,sha256,size FROM files WHERE project_id=? AND id=?').get(pid,id);check(file,'이 프로젝트의 파일이 아닙니다.','PROJECT_MISMATCH');return file as unknown as FileRecord;
  }
  private addFileRow(pid: string,f: FileRecord) { this.db.prepare('INSERT INTO files VALUES(?,?,?,?,?,?,?)').run(pid,f.id,f.name,f.mime,f.ext,f.sha256,f.size); }
  async addFile(pid: string,f: FileRecord) { await this.get(pid); await this.safe(); this.addFileRow(pid,f); }
  async journal(paths: string[]) { await this.safe(); const id = 'op_'+randomUUID(); this.db.prepare('INSERT INTO operations VALUES(?,?)').run(id,JSON.stringify(paths)); return id; }
  async clearJournal(id: string) { await this.safe(); this.db.prepare('DELETE FROM operations WHERE id=?').run(id); }
  private async recover() {
    for (const row of this.db.prepare('SELECT id,json FROM operations').all()) {
      const paths: unknown = JSON.parse(String(row.json)); check(Array.isArray(paths) && paths.every(p=>typeof p==='string' && /^files\/p_[a-z0-9-]+\/file_[a-z0-9-]+\.[a-z0-9]+$/i.test(p)),'파일 복구 journal이 올바르지 않습니다.','STORAGE_UNAVAILABLE');
      for (const item of paths as string[]) {
        const match = /^files\/(p_[a-z0-9-]+)\/(file_[a-z0-9-]+)\.[a-z0-9]+$/i.exec(item)!;
        if (!this.db.prepare('SELECT id FROM files WHERE project_id=? AND id=?').get(match[1],match[2])) await this.paths.remove(item);
      }
      await this.clearJournal(String(row.id));
    }
  }
  private writeProposal(p:DesignProposal){check(Buffer.byteLength(canonical(p))<=200*1024,'제안 기록 크기 한도입니다.','LIMIT_EXCEEDED');this.db.prepare('INSERT INTO proposals VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json').run(p.id,p.projectId,p.idempotencyKey,JSON.stringify(p));}
  async saveProposal(p:DesignProposal){await this.safe();await this.get(p.projectId);this.writeProposal(p);return p;}
  async proposals(pid:string):Promise<DesignProposal[]>{await this.get(pid);return this.db.prepare('SELECT json FROM proposals WHERE project_id=? ORDER BY rowid DESC').all(pid).map(r=>JSON.parse(String(r.json)) as DesignProposal);}
  async proposal(pid:string,id:string){const p=(await this.proposals(pid)).find(p=>p.id===id);check(p,'Proposal does not belong to this project.','PROJECT_MISMATCH');return p;}
  private async recoverProposals(){for(const row of this.db.prepare('SELECT json FROM proposals').all()){const p=JSON.parse(String(row.json)) as DesignProposal;if(p.state==='preparing'||p.state==='running'){p.state='interrupted';p.error={code:'INTERRUPTED',message:'Bridge restarted; previous model outcome is unknown. No automatic retry.'};p.version++;p.updatedAt=new Date().toISOString();this.writeProposal(p);}}}
  async settings() { await this.safe(); const row = this.db.prepare('SELECT version,json FROM settings WHERE id=1').get()!; return {version:Number(row.version),value:JSON.parse(String(row.json)) as Record<string,unknown>}; }
  async updateSettings(expected: number,patch: Record<string,unknown>) {
    const old = await this.settings(); if (expected !== old.version) throw new AtelierError('VERSION_CONFLICT','다른 창에서 설정을 먼저 저장했습니다.',old.version);
    const value = {...old.value,...patch}; check(this.db.prepare('UPDATE settings SET version=?,json=? WHERE id=1 AND version=?').run(expected+1,JSON.stringify(value),expected).changes===1,'설정 버전이 변경되었습니다.','VERSION_CONFLICT'); return {version:expected+1,value};
  }
  async delete(id: string, expected: number) {
    const p = await this.get(id); if (p.version !== expected) throw new AtelierError('VERSION_CONFLICT','프로젝트 버전이 변경되었습니다.',p.version);
    // Keep exact orphan-file paths in the journal, then remove only these validated files.
    const files = await this.files(id), operation = await this.journal(files.map(f=>`files/${id}/${f.id}${f.ext}`));
    this.db.prepare('DELETE FROM projects WHERE id=? AND version=?').run(id,expected);
    for (const f of files) await this.paths.remove(`files/${id}/${f.id}${f.ext}`);
    await this.clearJournal(operation);
  }
}
