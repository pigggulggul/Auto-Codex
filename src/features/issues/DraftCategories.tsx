import { useState } from "react";
import type { IssueDocument } from "../../../server/issues/document";

type Props = { document: IssueDocument; disabled: boolean; onSave: (document: IssueDocument) => Promise<boolean>; onPendingChange: (pending: boolean) => void };

export function setDraftRequirementLink(document: IssueDocument, issueId: string, requirementId: string, checked: boolean): IssueDocument | null {
  const next = structuredClone(document), issue = next.issues.find(item => item.id === issueId);
  if (!issue || !next.requirements.some(item => item.id === requirementId)) return null;
  issue.requirementIds = checked ? [...new Set([...issue.requirementIds, requirementId])] : issue.requirementIds.filter(id => id !== requirementId);
  return next;
}

export function removeDraftCategory(document: IssueDocument, categoryId: string): IssueDocument | null {
  if (!document.categories.some(item => item.id === categoryId) || document.categories.some(item => item.parentId === categoryId) || document.requirements.some(item => item.categoryId === categoryId) || document.issues.some(item => item.categoryId === categoryId)) return null;
  const next = structuredClone(document);
  next.categories = next.categories.filter(item => item.id !== categoryId);
  return next;
}

export function updateDraftCategory(document: IssueDocument, categoryId: string, title: string, parentId: string | null): IssueDocument | null {
  const next = structuredClone(document), item = next.categories.find(category => category.id === categoryId), name = title.trim();
  if (!item || !name || name.length > 255) return null;
  let ancestor = parentId;
  const visited = new Set<string>();
  while (ancestor !== null) {
    if (ancestor === categoryId || visited.has(ancestor)) return null;
    visited.add(ancestor);
    const parent = next.categories.find(category => category.id === ancestor);
    if (!parent) return null;
    ancestor = parent.parentId;
  }
  item.title = name; item.parentId = parentId;
  return next;
}

/** Changes are submitted as a new draft revision; the bridge validates the whole document. */
export function DraftCategories({ document, disabled, onSave, onPendingChange }: Props) {
  const [title, setTitle] = useState("");
  const [parent, setParent] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [editingParent, setEditingParent] = useState("");
  const categories = document.categories;
  const add = async () => {
    const name = title.trim();
    if (!name || parent && !categories.some(item => item.id === parent)) return;
    const next = structuredClone(document);
    next.categories.push({ id: `category_${crypto.randomUUID()}`, parentId: parent || null, title: name, order: next.categories.length });
    if (await onSave(next)) { setTitle(""); onPendingChange(editingId !== null); }
  };
  const assign = (kind: "requirements" | "issues", id: string, categoryId: string) => {
    if (categoryId && !categories.some(item => item.id === categoryId)) return;
    const next = structuredClone(document), item = next[kind].find(value => value.id === id);
    if (!item) return;
    item.categoryId = categoryId || null;
    void onSave(next);
  };
  const setLink = (issueId: string, requirementId: string, checked: boolean) => {
    const next = setDraftRequirementLink(document, issueId, requirementId, checked);
    if (next) void onSave(next);
  };
  const rename = async () => {
    const next = editingId && updateDraftCategory(document, editingId, editingTitle, editingParent || null);
    if (!next) return;
    if (await onSave(next)) { setEditingId(null); setEditingTitle(""); onPendingChange(Boolean(title.trim())); }
  };
  const remove = async (id: string) => {
    const next = removeDraftCategory(document, id);
    if (next && await onSave(next) && parent === id) setParent("");
  };
  return <section aria-label="초안 분류"><h4>초안 분류</h4>
    <p>분류를 추가하고 요구사항과 이슈에 각각 지정합니다. 변경을 저장하면 이전 연결 검토가 무효화됩니다.</p>
    <label>새 분류 이름<input maxLength={255} value={title} disabled={disabled || editingId !== null} onChange={event => { setTitle(event.target.value); onPendingChange(Boolean(event.target.value.trim()) || editingId !== null); }} /></label>
    <label>상위 분류<select value={parent} disabled={disabled} onChange={event => setParent(event.target.value)}><option value="">최상위</option>{categories.map(category => <option key={category.id} value={category.id}>{category.title} ({category.id})</option>)}</select></label>
    <button type="button" disabled={disabled || editingId !== null || !title.trim()} onClick={() => void add()}>분류 추가</button>
    {categories.length ? <ul>{categories.map(category => {
      const used = categories.some(item => item.parentId === category.id) || document.requirements.some(item => item.categoryId === category.id) || document.issues.some(item => item.categoryId === category.id);
      return <li key={category.id}>{category.title} · {category.id}{category.parentId && <> · 상위: {categories.find(item => item.id === category.parentId)?.title ?? category.parentId}</>}
        {editingId === category.id ? <><label>분류 이름 수정<input maxLength={255} disabled={disabled} value={editingTitle} onChange={event => setEditingTitle(event.target.value)} /></label><label>상위 분류 수정<select disabled={disabled} value={editingParent} onChange={event => setEditingParent(event.target.value)}><option value="">최상위</option>{categories.filter(candidate => updateDraftCategory(document, category.id, category.title, candidate.id)).map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.title} ({candidate.id})</option>)}</select></label><button type="button" disabled={disabled || !editingTitle.trim()} onClick={() => void rename()}>분류 저장</button><button type="button" disabled={disabled} onClick={() => { setEditingId(null); setEditingTitle(""); onPendingChange(Boolean(title.trim())); }}>수정 취소</button></> : <button type="button" disabled={disabled || editingId !== null || Boolean(title.trim())} onClick={() => { setEditingId(category.id); setEditingTitle(category.title); setEditingParent(category.parentId ?? ""); onPendingChange(true); }}>분류 수정</button>}
        <button type="button" disabled={disabled || editingId !== null || Boolean(title.trim()) || used} onClick={() => void remove(category.id)}>분류 삭제</button>{used && <small> 하위 분류나 연결된 항목을 먼저 이동하세요.</small>}
      </li>;
    })}</ul> : <p>추가된 분류가 없습니다.</p>}
    {document.requirements.map(requirement => <label key={requirement.id}>요구사항 분류: {requirement.text}<select disabled={disabled} value={requirement.categoryId ?? ""} onChange={event => assign("requirements", requirement.id, event.target.value)}><option value="">미분류</option>{categories.map(category => <option key={category.id} value={category.id}>{category.title} ({category.id})</option>)}</select></label>)}
    {document.issues.map(issue => <label key={issue.id}>이슈 분류: {issue.title}<select disabled={disabled} value={issue.categoryId ?? ""} onChange={event => assign("issues", issue.id, event.target.value)}><option value="">미분류</option>{categories.map(category => <option key={category.id} value={category.id}>{category.title} ({category.id})</option>)}</select></label>)}
    {document.issues.map(issue => <fieldset className="issues-requirement-links" key={issue.id}><legend>요구사항 연결: {issue.title}</legend>{document.requirements.map(requirement => <label key={requirement.id}><input type="checkbox" disabled={disabled} checked={issue.requirementIds.includes(requirement.id)} onChange={event => setLink(issue.id, requirement.id, event.target.checked)} />{requirement.text}</label>)}</fieldset>)}
  </section>;
}
