import { useState } from "react";
import type { IssueDocument } from "../../../server/issues/document";

type Props = { document: IssueDocument; disabled: boolean; onSave: (document: IssueDocument) => Promise<boolean>; onPendingChange: (pending: boolean) => void };
type Edit = { kind: "requirement"; id: string; text: string; isNew?: boolean } | { kind: "issue"; id: string; title: string; description: string; criteria: string; version: string; isNew?: boolean };

export function removeIndependentDraftItem(document: IssueDocument, kind: "requirement" | "issue", id: string): IssueDocument | null {
  const next = structuredClone(document);
  if (kind === "requirement") {
    if (!next.requirements.some(item => item.id === id) || next.issues.some(item => item.requirementIds.includes(id))) return null;
    next.requirements = next.requirements.filter(item => item.id !== id);
  } else {
    if (!next.issues.some(item => item.id === id) || next.issues.some(item => item.dependencyIds.includes(id))) return null;
    next.issues = next.issues.filter(item => item.id !== id);
  }
  return next;
}

export function applyIndependentDraftEdit(document: IssueDocument, edit: Edit): IssueDocument | null {
  const next = structuredClone(document);
  if (edit.isNew && [next.documentId, ...next.sources.map(item => item.id), ...next.categories.map(item => item.id), ...next.requirements.map(item => item.id), ...next.issues.map(item => item.id)].includes(edit.id)) return null;
  if (edit.kind === "requirement") {
    if (edit.isNew) {
      if (!edit.text.trim()) return null;
      next.requirements.push({ id: edit.id, categoryId: null, text: edit.text.trim(), origin: "user" });
      return next;
    }
    const item = next.requirements.find(value => value.id === edit.id); if (!item || !edit.text.trim()) return null;
    item.text = edit.text.trim();
  } else {
    if (edit.isNew) {
      if (!edit.title.trim() || !/^\d+\.\d+\.\d+$/.test(edit.version)) return null;
      const order = next.issues.reduce((max, issue) => Math.max(max, issue.order), -1) + 1;
      if (!Number.isSafeInteger(order)) return null;
      next.issues.push({ id: edit.id, categoryId: null, requirementIds: [], version: edit.version, order, title: edit.title.trim(), description: edit.description.trim(), acceptanceCriteria: edit.criteria.split("\n").map(value => value.trim()).filter(Boolean), dependencyIds: [], status: "ready" });
      return next;
    }
    const item = next.issues.find(value => value.id === edit.id); if (!item || !edit.title.trim() || !/^\d+\.\d+\.\d+$/.test(edit.version)) return null;
    item.title = edit.title.trim(); item.description = edit.description.trim(); item.version = edit.version;
    item.acceptanceCriteria = edit.criteria.split("\n").map(value => value.trim()).filter(Boolean);
  }
  return next;
}

export function DraftIndependentEditor({ document, disabled, onSave, onPendingChange }: Props) {
  const [edit, setEdit] = useState<Edit | null>(null);
  const start = (value: Edit) => { setEdit(value); onPendingChange(true); };
  const cancel = () => { setEdit(null); onPendingChange(false); };
  const valid = edit && (edit.kind === "requirement" ? Boolean(edit.text.trim()) : Boolean(edit.title.trim()) && /^\d+\.\d+\.\d+$/.test(edit.version));
  const save = async () => {
    if (!edit || !valid) return;
    const next = applyIndependentDraftEdit(document, edit);
    if (next && await onSave(next)) cancel();
  };
  const remove = (kind: "requirement" | "issue", id: string) => {
    const next = removeIndependentDraftItem(document, kind, id);
    if (next) void onSave(next);
  };
  return <section aria-label="독립 항목 편집"><h4>요구사항과 이슈 개별 수정</h4>
    <p>연결된 항목을 함께 수정하지 않습니다. 여러 이슈가 공유하는 요구사항을 수정하면 그 요구사항을 참조하는 모든 이슈에서 변경된 내용을 보여줍니다.</p>
    <button type="button" disabled={disabled || edit !== null} onClick={() => start({ kind: "requirement", id: `req_${crypto.randomUUID()}`, text: "", isNew: true })}>요구사항만 추가</button><button type="button" disabled={disabled || edit !== null} onClick={() => start({ kind: "issue", id: `issue_${crypto.randomUUID()}`, title: "", description: "", criteria: "", version: "1.0.0", isNew: true })}>이슈만 추가</button>
    {document.requirements.map(item => <p key={item.id}>{item.text} <button type="button" disabled={disabled || edit !== null} onClick={() => start({ kind: "requirement", id: item.id, text: item.text })}>요구사항 수정</button><button type="button" disabled={disabled || edit !== null || document.issues.some(issue => issue.requirementIds.includes(item.id))} onClick={() => remove("requirement", item.id)}>요구사항 삭제</button>{document.issues.some(issue => issue.requirementIds.includes(item.id)) && <small> 연결을 먼저 해제하세요.</small>}</p>)}
    {document.issues.map(item => <p key={item.id}>{item.title} <button type="button" disabled={disabled || edit !== null} onClick={() => start({ kind: "issue", id: item.id, title: item.title, description: item.description, criteria: item.acceptanceCriteria.join("\n"), version: item.version })}>이슈만 수정</button><button type="button" disabled={disabled || edit !== null || document.issues.some(issue => issue.dependencyIds.includes(item.id))} onClick={() => remove("issue", item.id)}>이슈 삭제</button>{document.issues.some(issue => issue.dependencyIds.includes(item.id)) && <small> 선행 관계를 먼저 해제하세요.</small>}</p>)}
    {edit?.kind === "requirement" && <label>요구사항 내용<textarea maxLength={32768} disabled={disabled} value={edit.text} onChange={event => setEdit({ ...edit, text: event.target.value })} /></label>}
    {edit?.kind === "issue" && <><label>이슈 제목<input maxLength={255} disabled={disabled} value={edit.title} onChange={event => setEdit({ ...edit, title: event.target.value })} /></label><label>이슈 설명<textarea maxLength={32768} disabled={disabled} value={edit.description} onChange={event => setEdit({ ...edit, description: event.target.value })} /></label><label>이슈 버전<input maxLength={50} disabled={disabled} value={edit.version} onChange={event => setEdit({ ...edit, version: event.target.value })} /></label><label>이슈 완료 조건 (한 줄에 하나씩)<textarea maxLength={32768} disabled={disabled} value={edit.criteria} onChange={event => setEdit({ ...edit, criteria: event.target.value })} /></label></>}
    {edit && <><button type="button" disabled={disabled || !valid} onClick={() => void save()}>개별 수정 저장</button><button type="button" disabled={disabled} onClick={cancel}>개별 수정 취소</button></>}
  </section>;
}
