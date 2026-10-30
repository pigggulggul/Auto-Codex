import type { Project } from '../../../shared/atelier/types';

export type Data = Record<string, unknown>;
export const record = (value: unknown): value is Data => !!value && typeof value === 'object' && !Array.isArray(value);
export function data(value: unknown): Data { if (!record(value)) throw new Error('저장소 응답 형식이 올바르지 않습니다.'); return value; }
export class AtelierFailure extends Error {
  constructor(public readonly code: string, message: string, public readonly currentVersion?: number) { super(message); }
}
export interface FileInfo { id: string; name: string; mime: string; ext: string; size: number; sha256: string; exists?: boolean }
export interface Download { transferId: string; name: string; totalBytes: number; sha256: string; chunkBytes: number }
type Pending = { resolve: (result: Data) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
export async function digest(bytes: Uint8Array) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer))].map(v => v.toString(16).padStart(2, '0')).join(''); }
export function fromBase64(value: string) { return Uint8Array.from(atob(value), c => c.charCodeAt(0)); }
export function toBase64(bytes: Uint8Array) { let text = ''; for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(text); }

/** Multiplexed over useBridge's one connection. Mutations are never automatically replayed. */
export class AtelierApi {
  private transport: ((text: string) => void) | null = null;
  private epoch = 0;
  private pending = new Map<string, Pending>();
  private queue: Promise<unknown> = Promise.resolve();
  private downloads: Promise<unknown> = Promise.resolve();
  private listeners = new Set<(event: Data) => void>();
  private control = 18; private chunks = 30; private at = Date.now();
  connect(send: (text: string) => void) { this.transport = send; this.control = 18; this.chunks = 30; this.at = Date.now(); }
  disconnect() {
    this.transport = null; this.epoch++;
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(new AtelierFailure('DISCONNECTED', '로컬 연결이 끊겼습니다. 초안을 유지합니다. 저장 결과는 최신본에서 확인하세요.')); }
    this.pending.clear();
  }
  subscribe(listener: (event: Data) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  receive(message: unknown) {
    if (!record(message) || typeof message.type !== 'string' || !message.type.startsWith('atelier.')) return false;
    if (message.type !== 'atelier.response') { for (const listener of this.listeners) listener(message); return true; }
    if (message.v !== 1 || typeof message.clientRequestId !== 'string') return true;
    const item = this.pending.get(message.clientRequestId); if (!item) return true;
    this.pending.delete(message.clientRequestId); clearTimeout(item.timer);
    if (message.ok === true && record(message.result)) item.resolve(message.result);
    else { const error = record(message.error) ? message.error : {}; item.reject(new AtelierFailure(String(error.code || 'INVALID_RESPONSE'), String(error.message || '저장소 응답을 확인할 수 없습니다.'), typeof error.currentVersion === 'number' ? error.currentVersion : undefined)); }
    return true;
  }
  request(type: string, payload: Data = {}): Promise<Data> {
    const epoch = this.epoch;
    const priority=type==='generation.interrupt';
    const operation = (priority?Promise.resolve():this.queue).then(async () => {
      if (epoch !== this.epoch || !this.transport) throw new AtelierFailure('DISCONNECTED', '로컬 브리지에 연결되어 있지 않습니다. 입력은 보관됩니다.');
      const bucket = ['transfer.chunk', 'transfer.read'].includes(type) ? 'chunks' : 'control';
      for (;;) {
        const now = Date.now(), elapsed = (now - this.at) / 1000; this.at = now;
        this.control = Math.min(18, this.control + elapsed); this.chunks = Math.min(30, this.chunks + elapsed * 30);
        if (this[bucket] >= 1) break;
        await delay(bucket === 'control' ? 100 : 35);
        if (epoch !== this.epoch || !this.transport) throw new AtelierFailure('DISCONNECTED', '연결이 바뀌었습니다. 요청을 자동 재전송하지 않습니다.');
      }
      this[bucket]--;
      const clientRequestId = crypto.randomUUID();
      return new Promise<Data>((resolve, reject) => {
        const timer = setTimeout(() => { this.pending.delete(clientRequestId); reject(new AtelierFailure('OUTCOME_UNKNOWN', '응답 시간이 초과됐습니다. 초안을 유지하며 최신 저장 결과를 확인하세요.')); }, /export|import|project.read|snapshot.read/.test(type) ? 15 * 60000 : 60000);
        this.pending.set(clientRequestId, { resolve, reject, timer });
        try { this.transport!(JSON.stringify({ type: `atelier.${type}`, v: 1, clientRequestId, payload })); }
        catch { clearTimeout(timer); this.pending.delete(clientRequestId); reject(new AtelierFailure('DISCONNECTED', '요청을 보내지 못했습니다. 초안을 유지합니다.')); }
      });
    });
    if(!priority)this.queue = operation.catch(() => {}); return operation;
  }
  /** A request queue alone can interleave several project/file transfers and exhaust both slots. */
  private downloadJob<T>(job:()=>Promise<T>):Promise<T>{
    const epoch=this.epoch;
    const operation=this.downloads.then(()=>{if(epoch!==this.epoch||!this.transport)throw new AtelierFailure('DISCONNECTED','연결이 바뀌었습니다. 파일을 자동 재요청하지 않습니다.');return job();});
    this.downloads=operation.catch(()=>{});return operation;
  }
  async release(descriptor:Download){
    try{await this.request('transfer.abort',{transferId:descriptor.transferId});}
    catch(error){if(!(error instanceof AtelierFailure)||!['TRANSFER_EXPIRED','DISCONNECTED'].includes(error.code))throw error;}
  }
  async bytes(descriptor: Download, maxBytes = 90 * 1024 * 1024): Promise<Uint8Array<ArrayBuffer>> {
    try {
      if (!Number.isSafeInteger(descriptor.totalBytes) || descriptor.totalBytes < 0 || descriptor.totalBytes > maxBytes) throw new AtelierFailure('LIMIT_EXCEEDED', '이 브라우저에서 한 번에 읽을 수 있는 크기를 초과합니다.');
      const output = new Uint8Array(descriptor.totalBytes); let offset = 0;
      for (let index = 0;; index++) {
        const result = await this.request('transfer.read', { transferId: descriptor.transferId, index });
        if (result.index !== index || result.totalBytes !== descriptor.totalBytes || result.sha256 !== descriptor.sha256 || typeof result.dataBase64 !== 'string') throw new Error('다운로드 순서 또는 해시 정보가 다릅니다.');
        const chunk = fromBase64(result.dataBase64); if (chunk.length > descriptor.chunkBytes || offset + chunk.length > output.length) throw new Error('다운로드 총량이 다릅니다.');
        output.set(chunk, offset); offset += chunk.length;
        if (result.last === true) break;
        if (!chunk.length) throw new Error('비어 있는 다운로드 chunk입니다.');
      }
      if (offset !== output.length || await digest(output) !== descriptor.sha256) throw new Error('실제 다운로드 바이트의 해시가 다릅니다.');
      return output;
    } catch (error) { await this.request('transfer.abort', { transferId: descriptor.transferId }).catch(() => {}); throw error; }
  }
  async project(id: string) {
    return this.downloadJob(async()=>{
    const result = await this.request('project.read', { designProjectId: id });
    const bytes = await this.bytes(data(result.download) as unknown as Download);
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!record(value) || value.id !== id || value.schemaVersion !== 1 || !Number.isSafeInteger(value.version) || !record(value.fields) || !record(value.output) || !['features','flows','screens','references','contents','styles','assets','concepts','results','reviews','plans','snapshots'].every(k => Array.isArray(value[k]))) throw new Error('설계 프로젝트 응답을 확인할 수 없습니다.');
    return value as unknown as Project;
    });
  }
  async pages(type: string, payload: Data = {}) {
    const values: unknown[] = []; let cursor: string | undefined;
    do { const result = await this.request(type, { ...payload, limit: 32, ...(cursor ? { cursor } : {}) }); if (!Array.isArray(result.items)) throw new Error('목록 응답이 아닙니다.'); values.push(...result.items); cursor = typeof result.nextCursor === 'string' ? result.nextCursor : undefined; } while (cursor);
    return values;
  }
  async upload(file: File | Blob, name: string, pid?: string, role = 'asset') {
    name=name.slice(0,180);
    if (file.size < 1 || file.size > (pid ? 15 : 90) * 1024 * 1024) throw new AtelierFailure('LIMIT_EXCEEDED', pid ? '파일은 15MiB 이하여야 합니다.' : '백업은 전체 90MiB 이하여야 합니다.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const begin = await this.request('transfer.begin', { direction: 'upload', purpose: pid ? 'file' : 'backup-import', ...(pid ? { designProjectId: pid, fileRole: role } : {}), name, totalBytes: bytes.length, sha256: await digest(bytes) });
    const descriptor = data(begin.transfer); const transferId = String(descriptor.transferId);
    try {
      const size = Number(descriptor.chunkBytes);
      if (!(size > 0 && size <= 256 * 1024)) throw new Error('업로드 chunk 크기를 확인할 수 없습니다.');
      for (let position = 0, index = 0; position < bytes.length; position += size, index++) await this.request('transfer.chunk', { transferId, index, dataBase64: toBase64(bytes.subarray(position, position + size)) });
      return await this.request('transfer.finish', { transferId });
    } catch (error) { await this.request('transfer.abort', { transferId }).catch(() => {}); throw error; }
  }
  async file(pid: string, id: string) { return this.downloadJob(async()=>{const r = await this.request('file.read', { designProjectId: pid, fileId: id }); return { info: data(r.file) as unknown as FileInfo, bytes: await this.bytes(data(r.download) as unknown as Download, 15 * 1024 * 1024) };}); }
  async save(descriptor: Download, mime: string) {
    // Stored ZIP32 can exceed the Blob budget. Chromium can stream it to a user-selected file.
    const picker = (window as unknown as { showSaveFilePicker?: (options: {suggestedName:string}) => Promise<{createWritable:()=>Promise<{write:(b:Uint8Array)=>Promise<void>;close:()=>Promise<void>;abort:()=>Promise<void>}>}> }).showSaveFilePicker;
    if (descriptor.totalBytes > 256 * 1024 * 1024 && picker) {
      const target = await picker({ suggestedName: descriptor.name }), writable = await target.createWritable();
      // Hash verification uses the server's verified spool and per-chunk metadata; full browser digest is bounded.
      let total = 0;
      try { for (let index=0;;index++) { const r=await this.request('transfer.read',{transferId:descriptor.transferId,index}); if(r.index!==index||r.sha256!==descriptor.sha256||r.totalBytes!==descriptor.totalBytes)throw new Error('출력 manifest가 다릅니다.');const chunk=fromBase64(String(r.dataBase64));total+=chunk.length;await writable.write(chunk);if(r.last)break; } if(total!==descriptor.totalBytes)throw new Error('출력 총량이 다릅니다.');await writable.close(); }
      catch(error){await writable.abort();await this.request('transfer.abort',{transferId:descriptor.transferId}).catch(()=>{});throw error;} return;
    }
    const bytes = await this.bytes(descriptor, 256 * 1024 * 1024), url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    const a = document.createElement('a'); a.href = url; a.download = descriptor.name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
}
