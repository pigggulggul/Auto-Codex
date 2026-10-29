export interface SavedDraft { value: Record<string, unknown>; base: string }
export class AtelierDrafts {
  constructor(private readonly storage: Pick<Storage,'getItem'|'setItem'|'removeItem'>,private readonly prefix='auto-codex.atelier.draft.') {}
  get(key:string):SavedDraft|null { try { const value:unknown=JSON.parse(this.storage.getItem(this.prefix+key)||'null');if(value&&typeof value==='object'&&'base'in value&&typeof value.base==='string'&&'value'in value&&value.value&&typeof value.value==='object'&&!Array.isArray(value.value))return value as SavedDraft; } catch { /* Preserve the server editor if local cache is unavailable. */ } return null; }
  put(key:string,value:SavedDraft) { this.storage.setItem(this.prefix+key,JSON.stringify(value)); }
  clear(key:string) { this.storage.removeItem(this.prefix+key); }
}
