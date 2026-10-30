import {expect,it} from 'vitest';
import {savedConversationTitle,titleFromPrompt} from './conversation-title.js';
it('uses the first meaningful request line without inventing an AI summary',()=>{
 expect(titleFromPrompt('\n```text\n# 사진 저장 오류 수정\n긴 추가 설명')).toBe('사진 저장 오류 수정');
 expect(titleFromPrompt('1. 로그인 화면 개선')).toBe('로그인 화면 개선');
 expect(titleFromPrompt('x'.repeat(200))).toHaveLength(49);expect(titleFromPrompt('')).toBe('새 대화');
});
it('keeps user titles as text and rejects empty, oversized or control-character names',()=>{
 expect(savedConversationTitle('  직접 정한 이름  ')).toBe('직접 정한 이름');expect(savedConversationTitle('<script>text</script>')).toContain('<script>');
 for(const value of ['', '   ','x'.repeat(81),'a\0b',null,42])expect(()=>savedConversationTitle(value)).toThrow();
});
