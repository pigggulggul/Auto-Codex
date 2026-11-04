import { WebSocketServer } from 'ws';

// Disposable UI-only fixture. It simulates the native confirmation; it is not a security test.
const server = new WebSocketServer({ host: '127.0.0.1', port: 4781 });
server.on('error', () => { console.error('Synthetic preview could not bind to 127.0.0.1:4781.'); process.exitCode = 1; });
server.on('listening', () => console.log('Synthetic issue view preview is ready for 45 seconds.'));
server.on('connection', socket => {
  let selectedSource = false;
  const sourceId = 'source_12345678-1234-4123-8123-123456789abc';
  const sourceText = '합성 예시 자료입니다.\n이 텍스트는 미리보기 화면 검사용입니다.';
  const sources = () => ({ items: selectedSource ? [{ id: sourceId, relativePath: 'docs/합성자료.md', bytes: Buffer.byteLength(sourceText), sha256: 'a'.repeat(64), projectRevision: 2 }] : [], totalBytes: selectedSource ? Buffer.byteLength(sourceText) : 0 });
  socket.send(JSON.stringify({ type: 'bridge.state', snapshot: { connected: true, appServerReady: true, projectPath: 'C:\\Synthetic\\Project', workspaceMode: 'project', projectSelectionGeneration: 1, researchNetworkAccess: false, threadId: null, turnId: null, petState: 'idle', selectedSkill: null, activeRole: 'general', activeModel: null, activeEffort: null, projectTrust: 'untrusted', activeRun: null, activeConversationId: '', conversations: [] } }));
  socket.on('message', raw => {
    let message; try { message = JSON.parse(String(raw)); } catch { return; }
    const base = { type: 'issues.project.result', v: 1, clientRequestId: message.clientRequestId, ok: true, bound: true };
    if (message.type === 'issues.project.status') return socket.send(JSON.stringify({ ...base, action: 'status' }));
    if (message.type === 'issues.view.authorize') return socket.send(JSON.stringify({ ...base, action: 'authorizeView', authorized: true, authorizedForMs: 900000 }));
    if (message.type === 'issues.view.release') return socket.send(JSON.stringify({ ...base, action: 'releaseView', authorized: false }));
    if (message.type === 'issues.document.export') return socket.send(JSON.stringify({ ...base, action: 'export', cleanupWarning: false }));
    if (message.type === 'issues.sources.add') { selectedSource = true; return socket.send(JSON.stringify({ ...base, action: 'sourceAdd', sources: sources() })); }
    if (message.type === 'issues.sources.list') return socket.send(JSON.stringify({ ...base, action: 'sourceList', sources: sources() }));
    if (message.type === 'issues.sources.remove') { selectedSource = false; return socket.send(JSON.stringify({ ...base, action: 'sourceRemove', sources: sources() })); }
    if (message.type === 'issues.sources.read') return socket.send(JSON.stringify({ ...base, action: 'sourceRead', chunk: { sourceId, offset: message.offset, text: sourceText.slice(message.offset), nextOffset: null } }));
    if (message.type === 'issues.analysis.prepare') return socket.send(JSON.stringify({ ...base, action: 'snapshotPrepare', snapshot: { id: 'snapshot_12345678-1234-4123-8123-123456789abc', projectRevision: 2, sources: [{ id: sourceId, relativePath: 'docs/합성자료.md', sha256: 'a'.repeat(64), segmentCount: 1 }], totalSegments: 1, processedSegments: 0, hasInstruction: Boolean(message.instruction.trim()) } }));
    if (message.type === 'issues.analysis.check') return socket.send(JSON.stringify({ ...base, action: 'snapshotCheck', freshness: { snapshotId: message.snapshotId, projectRevision: message.expectedRevision, files: [{ id: sourceId, state: 'unchanged' }] } }));
    if (message.type !== 'issues.view.query') return;
    const q = message.query; let view;
    if (q.kind === 'documents') view = { kind: 'documents', revision: 2, documents: [{ id: 'doc-synthetic', documentRevision: 1, issueCount: 2 }], nextAfterId: null };
    if (q.kind === 'projectIssues') view = q.cursor.afterId ? { kind: 'projectIssues', revision: 2, page: { documentId: 'doc-other', items: [{ id: 'issue-other', title: '다른 문서의 알림 처리', version: '2.0.0', category: '알림', localStatus: 'ready', importedStatus: 'ready', missingCriteria: false, unverifiedDependencies: 0 }], scannedDocuments: 1, nextCursor: null } } : { kind: 'projectIssues', revision: 2, page: { documentId: null, items: [], scannedDocuments: 8, nextCursor: { afterId: 'doc-008', issueOffset: 0 } } };
    if (q.kind === 'issues') { const items = [
      { id: 'issue-login', title: '로그인 성공과 실패 처리', version: '1.2.0', category: '계정 관리', localStatus: 'needs_review', importedStatus: 'completed', missingCriteria: false, unverifiedDependencies: 0 },
      { id: 'issue-history', title: '작업 기록 목록 표시', version: '1.10.0', category: '작업 관리', localStatus: 'needs_review', importedStatus: 'ready', missingCriteria: true, unverifiedDependencies: 1 },
    ]; const f = q.filters || {}, issueCategories = { 'issue-login': 'cat-login', 'issue-history': 'cat-work' }, parent = { 'cat-login': 'cat-account', 'cat-account': null, 'cat-work': null };
      const inCategory = item => { if (f.categoryId === undefined) return true; let current = issueCategories[item.id] || null; if (f.categoryId === null) return current === null; while (current) { if (current === f.categoryId) return true; current = parent[current]; } return false; };
      view = { kind: 'issues', revision: 2, page: { items: items.filter(item => inCategory(item) && (!f.search || `${item.id} ${item.title} ${item.category}`.toLowerCase().includes(f.search.toLowerCase())) && (!f.status || item.localStatus === f.status) && (!f.version || item.version === f.version)), nextOffset: null } }; }
    if (q.kind === 'categories') { const children = q.parentId === null ? [{ id: 'cat-account', title: '계정 관리', hasChildren: true }, { id: 'cat-work', title: '작업 관리', hasChildren: false }] : q.parentId === 'cat-account' ? [{ id: 'cat-login', title: '로그인', hasChildren: false }] : []; view = { kind: 'categories', revision: 2, page: { items: children, nextOffset: null } }; }
    if (q.kind === 'diagnostics') view = { kind: 'diagnostics', revision: 2, report: { documentRevision: 1, issueCount: 2, requirementCount: 2, linkedRequirementCount: 1, totalFindings: 5, findings: { items: [{ code: 'requirement-unlinked', entityId: 'req-other', title: '사용자는 작업 목록을 확인할 수 있어야 합니다.', provenance: { origin: 'source', sourceName: '합성 문서', locator: '작업 절' } }, { code: 'requirement-same-text', entityId: 'req-other', title: '사용자는 작업 목록을 확인할 수 있어야 합니다.', provenance: { origin: 'source', sourceName: '합성 문서', locator: '작업 절' }, relatedEntityId: 'req-first' }, { code: 'issue-missing-criteria', entityId: 'issue-history', title: '작업 기록 목록 표시', provenance: null }, { code: 'issue-unverified-completion', entityId: 'issue-login', title: '로그인 성공과 실패 처리', provenance: null }, { code: 'issue-same-title', entityId: 'issue-history', title: '작업 기록 목록 표시', provenance: null, relatedEntityId: 'issue-login' }], nextOffset: null } } };
    if (q.kind === 'requirementDetail') { const linked = q.requirementId === 'req-first'; view = { kind: 'requirementDetail', revision: 2, requirement: { id: q.requirementId, text: '사용자는 작업 목록을 확인할 수 있어야 합니다.', origin: 'source', sourceName: '합성 문서', locator: linked ? '처음 절' : '작업 절', category: '작업 관리', linkedIssueCount: linked ? 1 : 0 }, page: { items: linked ? [{ id: 'issue-history', title: '작업 기록 목록 표시', version: '1.10.0', category: '작업 관리', localStatus: 'needs_review', importedStatus: 'ready', missingCriteria: true, unverifiedDependencies: 1 }] : [], nextOffset: null } }; }
    if (q.kind === 'detail') view = q.documentId === 'doc-other' ? { kind: 'detail', revision: 2, issue: { id: q.issueId, title: '다른 문서의 알림 처리', version: '2.0.0', category: '알림', localStatus: 'ready', importedStatus: 'ready', missingCriteria: false, unverifiedDependencies: 0, description: '다른 합성 문서의 상세입니다.', criteriaCount: 1, requirementCount: 0, dependencyCount: 0 } } : { kind: 'detail', revision: 2, issue: { id: q.issueId, title: '작업 기록 목록 표시', version: '1.10.0', category: '작업 관리', localStatus: 'needs_review', importedStatus: 'ready', missingCriteria: true, unverifiedDependencies: 1, description: '합성 작업 기록을 표시합니다.', criteriaCount: 0, requirementCount: 0, dependencyCount: 1 } };
    if (q.kind === 'criteria') view = { kind: 'criteria', revision: 2, page: { items: q.documentId === 'doc-other' ? ['합성 알림 조건'] : [], nextOffset: null } };
    if (q.kind === 'dependencies') view = { kind: 'dependencies', revision: 2, page: { items: q.documentId === 'doc-other' ? [] : [{ id: 'issue-login', title: '로그인 성공과 실패 처리', localStatus: 'needs_review', importedStatus: 'completed' }], nextOffset: null } };
    if (q.kind === 'requirements') view = { kind: 'requirements', revision: 2, page: { items: [], nextOffset: null } };
    if (view) socket.send(JSON.stringify({ ...base, action: 'view', view }));
  });
});
setTimeout(() => { for (const client of server.clients) client.close(); server.close(); }, 45_000);
