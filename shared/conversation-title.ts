export const CONVERSATION_TITLE_LIMIT=80;
export function savedConversationTitle(value:unknown):string {
  if(typeof value!=='string'||value.length>CONVERSATION_TITLE_LIMIT||/[\u0000-\u001f\u007f]/.test(value)||!value.trim())throw new Error('대화 이름은 공백이 아닌 1~80자로 입력하세요.');
  return value.trim();
}
/** Local excerpt only; no AI summary or additional model request. */
export function titleFromPrompt(prompt:string):string {
  const line=prompt.split(/\r?\n/).map(s=>s.trim().replace(/^(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/,'')).find(s=>s&&!/^```/.test(s))||'새 대화';
  const text=line.replace(/[\u0000-\u001f\u007f]/g,'').replace(/\s+/g,' ').trim();
  return text.length>48?text.slice(0,48)+'…':text||'새 대화';
}
