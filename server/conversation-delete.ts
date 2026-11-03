import type {ConversationArchive, ConversationRecord} from './conversation-store.js';

/** Prepare a new archive without mutating live history; the caller commits it only after saving. */
export function planConversationDeletion(records: ConversationRecord[], activeId: string, targetId: string, createReplacement: () => ConversationRecord): ConversationArchive {
  if (!records.some(record => record.id === targetId)) throw new Error('삭제할 대화를 찾을 수 없습니다.');
  if (!records.some(record => record.id === activeId)) throw new Error('현재 대화를 찾을 수 없습니다.');
  const remaining = records.filter(record => record.id !== targetId);
  if (activeId !== targetId) return {version:1, activeConversationId:activeId, conversations:remaining};
  const replacement = createReplacement();
  return {version:1, activeConversationId:replacement.id, conversations:[...remaining,replacement]};
}

/** Publish the new state only once its durable archive replacement succeeds. */
export async function commitConversationDeletion(archive: ConversationArchive, save: (archive:ConversationArchive)=>Promise<void>, commit:()=>void):Promise<void> {
  await save(archive);
  commit();
}
