# 기능 보존 매핑 — 0단계

[기준선 결과](STAGE0_BASELINE.md)와 함께 읽는다. 아래 경로는 **현재 구현**, 새 진입점은 **통합 목표**다. `src/components/`의 컴포넌트는 이후 공통 셸로 옮겨도 기능과 상태 소유자를 유지한다. 표의 테스트는 커버하는 범위만 입증하며 브라우저 조작 전체 통과를 뜻하지 않는다.

경로 기준은 저장소 루트다. 실행 결과는 [기계 판독 기록](STAGE0_EVIDENCE.json), 데이터/메시지의 목표 계약은 [CONTRACTS.md](CONTRACTS.md)를 따른다.

## 1. Auto-Codex: 일반 작업·실행·승인 보존

| ID / 기능 | 실제 UI·상태 소유자 | 실제 메시지·브리지 경로 | 현재 검증 근거 / 남은 확인 | 새 진입점 |
|---|---|---|---|---|
| A01 폴더 선택·경로 | ProjectPanel.tsx, useBridge.snapshot.projectPath | project.pick/select → pickAndSelectProject/selectProject/validateProject, folder-picker.ts | client-message.test.ts의 입력, 재시작 fixture의 소실 경로 거부. 실제 OS 폴더창 미검증 | 공통 작업실 설정 |
| A02 프로젝트 신뢰 | ProjectPanel.tsx, snapshot.projectTrust | project.trust → trustCurrentProject → project-trust.ts | project-trust.test.ts의 신규/기존 설정 보존. 실제 사용자 config는 미접근 | 공통 작업실 설정 |
| A03 폴더 없는 조사·네트워크 | ProjectPanel.tsx, snapshot.workspaceMode/researchNetworkAccess | workspace.mode/network → setWorkspaceMode/setResearchNetworkAccess → readOnly sandbox | client-message.test.ts; 기본 network=false는 합성 재시작 검사. 실제 외부 조사 미실행 | 일반 Codex 작업 |
| A04 새 대화·대화 선택 | ConversationPicker.tsx, useBridge.conversations/messages | conversation.new/select → newConversation/selectConversation → ConversationStore | conversation-store.test.ts, verify-conversation-restart.mjs의 프로젝트·이력 복원 | 공통 대화 탐색 |
| A05 Solo thread 재개·Team 기록 | useBridge.snapshot/thread, ResultView.tsx | ensureThread → thread/resume 또는 thread/start; history archive v1 | 재시작 fixture의 durable resume·Team interrupted·승인 미복원 | 대화·결과 |
| A06 모델·추론 강도 | ModelPicker.tsx, App.tsx 선택/localStorage | models.refresh → model/list; turn.start.model/effort → startTurn 검증 | client-message.test.ts의 model/effort 입력. 실제 모델 목록·지원 강도 미검증 | 공통 실행 설정 |
| A07 Manual/Auto·스킬 목록 | SkillPicker.tsx, App.tsx skillMode/skillPath | skills.refresh → skills/list; turn.start.skillMode/skillPath → routeSkill/assignTaskSkills | skill-router.test.ts의 별칭·비활성 제외·일반 에이전트 fallback·쓰기 부정어 | 공통 실행 설정 |
| A08 Team/Solo 시작 | App.tsx 실행 컨트롤, bridge activeRun/turnId | turn.start → startTurn → startTeamRun 또는 ensureThread/turn/start | client-message.test.ts; 실제 Codex turn은 미실행 | 일반 작업·디자인 제작 |
| A09 계획 검증·역할 | TaskBoard.tsx/PixelOffice.tsx, RunSnapshot | Coordinator outputSchema → parseTaskPlan/validateTaskPlan/fallbackTaskPlan | task-planner.test.ts의 의존성·예약 ID·QA/보고 추가·안전 fallback | 실행 상세·픽셀 |
| A10 읽기 병렬·쓰기 독점 | 브리지 orchestration.ts | dispatchTeamTasks → selectStartableTaskIds(activeRun,3) | orchestration.test.ts의 read 병렬·writer와 다른 active task 비중첩 | 동일 스케줄러 유지 |
| A11 실패·차단·최종 보고 | RunSnapshot/TaskNode, TaskBoard·ResultView | transitionTask → run.state; runAfterFailure 보고 | orchestration.test.ts의 불법 전이·실패 의존성·settled report, task-planner.test.ts | 실행 상세·결과 |
| A12 중단 | App.tsx 중단 버튼, useBridge.interruptTurn | turn.interrupt → interruptTurn → turn/interrupt, pending 취소 | orchestration.test.ts interruption, 재시작 fixture interrupted. 실제 UI 중단 미검증 | 전역 실행 바 |
| A13 승인·거부·세션 승인 | 전역 ApprovalDialog.tsx, useBridge.approvals; pendingApprovals는 서버 메모리 | approval.request/resolved; approval.resolve → resolveApproval → approvalResponse | approval-response.test.ts의 정확한 권한 집합·거부·legacy; 재시작 fixture 만료 ID 거부. 실제 focus trap 미검증 | 어느 화면에서나 전역 모달 |
| A14 실제 이벤트·상관 | ActivityTimeline.tsx/OperationsPanel.tsx, RuntimeRegistry | item/turn → mapNotification → activity.event, assistant.text, run.state | activity-mapper.test.ts, runtime-registry.test.ts의 교차 turn/thread 귀속·재바인딩 거부 | 활동 센터·실행 상세 |
| A15 픽셀 월드·이동 | PixelOffice.tsx, world/pixelWorld.ts | bridge 상태/역할/이벤트 → 월드 매핑 | pixelWorld.test.ts의 동선·충돌·런타임 상태, spriteRendering.test.ts의 방향·동작 축소 | 실행 관찰 → 픽셀 화면 |
| A16 캐릭터·펫 선택 | App.tsx, WorldCharacter.tsx, lib/worldCharacters.ts·petCatalog.ts | 로컬 할당; 실제 역할/선택 스킬은 서버 snapshot | OperationsPanel.test.ts의 동일 캐릭터, pixel-assets.test.ts의 실제 아트. 선택 유지 UI 왕복 미검증 | 픽셀 화면·설정 |
| A17 결과 읽기·복사 | ResultView.tsx/ResultText.tsx/MarkdownText.tsx | conversation.state, assistant.text, run.state | ResultView.test.tsx의 과거 응답·중단 안내, MarkdownText.test.tsx의 비활성 HTML·실행 URL 거부·원격 이미지 비로딩. 실제 복사·Esc·초점 미검증 | 대화·결과 |
| A18 오늘/7일 토큰 | useBridge.tokenEntries, lib/tokenUsage.ts; 서버 parseTokenUsage | token.usage | server/token-usage.test.ts, src/lib/tokenUsage.test.ts의 중복 교체·일/7일 집계 | 공통 상단·실행 상세 |
| A19 연결·오류 | App.tsx 배너, useBridge 재연결·lastError | bridge.state/error, codex-app-server.ts | codex-app-server.test.ts의 Windows shim, 재시작 fixture. 실제 CLI 오류 화면·자동 재연결 UI 미검증 | 공통 상단·오류 안내 |
| A20 대화 저장 보호 | server/conversation-store.ts | .local-data/history.json v1, 직렬화 원자 교체 | conversation-store.test.ts의 동시 저장·손상 보존·junction 거부·스키마. 허용된 로컬 테스트 권한에서 통과 | 기존 저장소 유지 |

위 `*.test.ts(x)`는 루트 Vitest 18개 파일/81개 검사에 포함된다. 기본 루트 명령은 Atelier 러너 충돌 때문에 실패한다. 분리 진단의 통과 결과와 구분한다.

## 2. Atelier: 설계·전달·검토 보존

기존은 HTTP API이며 목표는 단일 bridge WS다. 원본 HTTP 서버가 통합 제품에 남는다는 의미가 아니다. 아래 public/src/tests 경로는 `atelier/atelier/` 기준이다.

| ID / 기능 | 현재 UI·도메인 | 현재 저장/API | 실제 테스트·근거 / 남은 확인 | 목표 연결 |
|---|---|---|---|---|
| T01 네 시작 경로 | public/guide.js ENTRIES, app.js 생성·openProject | POST/GET /api/projects | domain.test.mjs AC01/41/55, easy-guide.test.mjs 중립 활동 패턴 | 홈 → atelier.project.create/load |
| T02 가이드·상세·작업 위치 | easy-guide.js, app.js changed/flush/progress/local draft | PUT /api/projects/:id, settings.lastProject | easy-guide.test.mjs의 미완성 초안 유지·되돌아가기. browser-ux*.js는 이번에 미실행 | 같은 데이터 + 안내 밀도 설정 |
| T03 결정 상태·출처·확정 | domain.js decision/updateDecision/confirmed | 프로젝트 fields·history·revision·intent | domain.test.mjs 제안/제외·의도 확인; easy-guide upstream 재확인 | shared 도메인 + 서버 검증 patch |
| T04 제품·고객·기능·콘텐츠 | guide.js 질문·예시, domain.js allDecisions/assemble | fields/features/contents | domain.test.mjs와 easy-guide.test.mjs의 범용 결과·예시 출처 보존 | 프로젝트 설계 |
| T05 흐름·분기·복구 | structure.js graphIssues/createGraph, domain.js acknowledgeGraph | flows.graph·screens | extension.test.mjs의 고립/막다른 경로·분기/복구·중복 edge 검사 | 사용자 흐름 |
| T06 영향 전파 | structure.js dependencyEdges/impactedIds/propagateImpact | dependsOn·scopeMode·reviewNeeded·review.recheck | extension.test.mjs의 명시적 링크·순환 종료·과거 판정 보존 | 편집 상세·근거 패널 |
| T07 원본·영역·크롭 | app.js addReference/createRegion/bindReference | files POST, references.regions.rect/cropId | domain.test.mjs 원본 교체·좌표/손상 검증; server.test.mjs 실제 PNG. 드래그 UI 미실행 | 레퍼런스 연구·chunk 업로드 |
| T08 컨셉 비교·선택 | domain.js addConcepts/chooseConcept, guide.js | concepts.selected/status/reason | domain.test.mjs AC04/44, AC05/07/58. 실제 화면 비교 미실행 | 컨셉 탐색 |
| T09 스타일·명시 값 충돌 | applyPalette/issues/ready, easy-guide.js 샘플 | styles.role/value/scope | domain.test.mjs AC13 충돌, easy-guide.test.mjs 스타일 변경·과거 snapshot 불변 | 스타일과 리소스 |
| T10 실제 문서·서체·리소스 | public/resource-types.js, app.js loadProjectFonts | files; src/resources.mjs 형식 검증 | resources.test.mjs의 MD/JSON/SVG/WOFF2/ZIP byte·download·프로젝트 분리; extension.test.mjs detection. 실제 FontFace UI 미실행 | 리소스·로컬 FontFace |
| T11 브리프 검사·사용자 의도 | domain.js issues/ready, app.js 의도 확인 | intent.choice/revision/reason | domain.test.mjs AC29/30: 확인 전 snapshot 차단·생성≠검토 | 디자인 브리프 |
| T12 선택 범위·근거 구분 | structure.js selectScope/attachmentIds/currentInput | output.selection, snapshot.selection/scopeContexts | extension.test.mjs의 flows/screens/assets, 근거 포함과 타깃 비확장·무관 파일 제외 | 프롬프트 스튜디오 |
| T13 불변 프롬프트·결정 추적 | domain.js assemble/makeSnapshot | snapshots의 input/text/criteria/sections/versions | domain.test.mjs 결정적 조립·불변, server.test.mjs 기존 snapshot 수정 거부 | 서버 snapshot.create |
| T14 실제 ZIP·handoff | server.mjs bundle, src/zip.mjs | GET /api/projects/:id/bundle?snapshot= | server.test.mjs 실제 ZIP header/PNG/prompt, resources.test.mjs 범위 파일 포함·무관 파일 제외 | bundle.export → download transfer |
| T15 자체 백업·새 프로젝트 복원 | app.js backup/restore | GET backup, POST /api/restore; validateBackup | server.test.mjs·resources.test.mjs 실제 byte 왕복, extension.test.mjs 손상·연결 거부 | backup.export/import |
| T16 수동 실제 결과 등록 | app.js resultModal, domain.js baseline/beginReview | results.snapshotId/fileId/execution/source | domain.test.mjs AC17/23/60/62. 이미지/실행 근거 없는 완료 차단 | review.start + 수동 결과 |
| T17 기준별 검토·시각/동작 | domain.js reviewProblems/finishReview | reviews.items/intent/scope/state | domain.test.mjs AC24/31/32/33/34/37/40: 근거·의도·행동 기록 검사 | 자가 진단과 수정 |
| T18 수정 계획·새 수정본·회귀 | createPlan/makeSnapshot(plan)/beginReview | plans·parentReviewId·planId·snapshot selection | extension.test.mjs 원래 출력 selection 유지, domain.test.mjs 새 회차·판정 초기화 | 수정 제작과 새 검토 |
| T19 저장 충돌·재시작 | server.mjs persist/SQLite WAL, app.js flush 임시 draft | projects.version·revisions·files | server.test.mjs stale writes·SQLite restart, resources.test.mjs restart. 실제 입력 복구 UI 미실행 | 별도 Atelier Store |
| T20 설정·공통 기본값·프로젝트 삭제 | app.js 설정·삭제 확인, server.mjs settings/DELETE | settings UI, DELETE project와 files | 서버 경로는 확인. 일부 수동 설정·삭제 UI의 전용 자동 검사 근거 부족 | 설정·명시적 삭제; 실행 중 삭제 거부 |

Atelier 자동 검사는 5개 파일/53개다. browser-journey.js·browser-extension.js·browser-ux.js·browser-ux-revision.js는 제공 page·픽스처에 의존하는 수동 실행 시나리오이며 이번 단계에서 실행하지 않았다. 과거 스크린샷/VALIDATION.md는 디자인 참고와 이전 검증 이력이다.

## 3. 신규 기능과 기존 기능의 경계

| 신규 기능 | 연결할 기존 근거 | 후속 필수 회귀 |
|---|---|---|
| AI 설계 제안 | T03/T06 + A06/A07/A14 | readOnly, 오래된 revision, 허용 필드/ID, 확정 보존, AI 오류와 내장 예시 구분 |
| Codex UI 제작 | T11/T12/T13 + A08~A14 | 고정 입력, workspace 재검증, 일반 작업과 공통 잠금, Team/Solo ID 귀속 |
| 자동 결과 연결 | A17 + T16/T17 | 실제 파일·해시·출처 확인, 원본 snapshot, 부분 실패와 검토 완료 구분 |
| 수정 제작 | T18 + A08~A14 | 새 generation, 부모 결과·계획 추적, 유지 조건·회귀 항목 재검토 |
| 통합 데이터/파일 WS | A20 + T07/T10/T14/T15/T19 | byte/hash/type·소유 관계·chunk·용량·재시작·권한 미복원 |

새 UI로 이동할 때 A/T 항목마다 새 진입점·정상/실패 경로·증거를 갱신한다. 미구현 버튼이나 모의 결과로 보존 완료를 표시하지 않는다. 실제 접근성·모바일·일반 사용자의 독립 진행은 별도 검증 대상이다.
