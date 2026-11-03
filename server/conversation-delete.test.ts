import {mkdtemp} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {describe,expect,it} from 'vitest';
import {commitConversationDeletion,planConversationDeletion} from './conversation-delete.js';
import {ConversationStore,type ConversationRecord} from './conversation-store.js';

function record(id:string):ConversationRecord {return {id,title:id,createdAt:'2026-01-01',updatedAt:'2026-01-01',preview:'',messageCount:0,projectPath:null,workspaceMode:'research',threadId:null,assistantText:'',taskOutputs:{},activities:[],activeRun:null,contextSummary:'',messages:[]};}
describe('local conversation deletion',()=>{
  it('removes only the chosen record and replaces an active conversation',async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),'auto-codex-delete-'));
    const store=new ConversationStore(root), records=[record('active'),record('other')];
    await store.save({version:1,activeConversationId:'active',conversations:records});
    const next=planConversationDeletion(records,'active','active',()=>record('replacement'));
    expect(records.map(r=>r.id)).toEqual(['active','other']);
    await store.save(next);
    const restored=await new ConversationStore(root).load();
    expect(restored?.activeConversationId).toBe('replacement');
    expect(restored?.conversations.map(r=>r.id)).toEqual(['other','replacement']);
    const withoutOther=planConversationDeletion(restored!.conversations,'replacement','other',()=>{throw new Error('unnecessary replacement');});
    expect(withoutOther.activeConversationId).toBe('replacement');
    expect(withoutOther.conversations.map(r=>r.id)).toEqual(['replacement']);
  });
  it('rejects stale targets and leaves the original archive untouched if saving fails',async()=>{
    const records=[record('active'),record('other')];
    expect(()=>planConversationDeletion(records,'active','missing',()=>record('new'))).toThrow();
    const next=planConversationDeletion(records,'active','other',()=>record('new'));
    let committed=false;
    await expect(commitConversationDeletion(next,async()=>{throw new Error('storage unavailable');},()=>{committed=true;})).rejects.toThrow('storage unavailable');
    expect(committed).toBe(false);
    await commitConversationDeletion(next,async()=>{},()=>{committed=true;});
    expect(committed).toBe(true);
    expect(next.conversations.map(r=>r.id)).toEqual(['active']);
    expect(records.map(r=>r.id)).toEqual(['active','other']);
  });
});
