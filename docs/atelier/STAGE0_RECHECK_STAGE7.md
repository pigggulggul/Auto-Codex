# 0단계 재점검 — 7단계 시작 전 현재 기준선

2026-10-30, `main` HEAD `ced016939fc2a04864132454a3b55e5aa464a933`의 기존 미커밋 6단계·6시리즈 선택 변경을 보존한 작업 트리다. 루트 AGENTS.md를 확인했고 대상 하위 AGENTS.md/AGENTS.override.md는 없다. 최초 0단계 자료는 과거 기준선으로 보존하고 이 문서가 이번 작업 시작 상태를 기록한다. 이 점검 중 UI 교체·AI inference·배포·의존성 변경은 하지 않았다.

## 실제 기능·형식·명령

| 영역 | 실제 소스·현재 형식 | 확인 |
|---|---|---|
| 공통 셸·일반 작업·대화·활동·픽셀·승인 | src/App.tsx, useBridge, 각 컴포넌트 / 기존 ClientMessage·ServerMessage | 루트 타입/174개 검사/빌드 통과 |
| Team/Solo·중단·승인·토큰 | server/index.ts, orchestration, runtime-registry, approval-response, token-usage | 기존 계획/최대 task·read 병렬/쓰기 독점·pending subset 규칙 유지 |
| 기존 대화 | conversation-store.ts, .local-data/history.json archive v1 | Atelier와 별도 저장; generation은 대화/message ID로 참조 |
| Atelier 수동 4가지 시작·8탭·설계/검토/수정 계획 | src/features/atelier, shared/atelier | 도메인 schemaVersion=1/modelVersion=2, immutable snapshot 유지 |
| 통합 설계 저장 | server/atelier/store.ts, files.ts, worker.ts | .local-data/atelier의 SQLite user_version=3 및 프로젝트별 byte; 원본 DB 미이전 |
| 제안·제작 | proposal-runtime.ts / execution-runtime.ts, shared/atelier/execution.ts | 제안은 readOnly/네트워크 false/never; 제작은 검증 workspaceWrite/네트워크 기본 false/on-request, 기존 실행기 공유 |
| 파일 전송·ZIP·백업 | transfers.ts, bundle.ts, handlers.ts | WS chunk 256KiB, frame 1MiB, 파일 15MiB, legacy JSON 백업 90MiB; 실제 byte/hash·소유 검증 |
| 원본 Atelier | atelier/atelier의 public/src/server.mjs | 패키지 1.2.0, 자체 SQLite·files·JSON 백업·ZIP·HTTP. 통합 제품은 원본 서버/DB를 사용하지 않음 |

지원 하한은 두 패키지 모두 Node 22.13+이고 통합 앱의 tools/check-node.mjs가 내장 SQLite를 검사한다. 점검 환경은 Node 22.18.0, codex-cli 0.166.0. npm/package-lock 및 기존 React/Vite/TypeScript 도구 체인을 유지한다. 실제 명령은 루트 `npm run typecheck`, `npm test`, `npm run build`, 원본 `npm --prefix atelier/atelier run check`, `npm --prefix atelier/atelier test`다. 이번 기준선에서 빌드(내부 타입 검사 포함), 174개 루트 검사, 14개 원본 모듈 문법 검사, 53개 원본 검사가 모두 통과했다. 별도의 완성된 test:e2e 명령은 없다.

## 연결·권한·복구 계약의 현재와 제안

- 단일 React → 127.0.0.1:4781/ws → Node bridge → codex app-server stdio JSONL. 개발 UI 4780, 원본 4317 서버를 통합 필수 프로세스로 추가하지 않는다. renderer는 경로/명령/승인의 권한 근거가 아니다.
- P(설계), binding(workspace+conversation), snapshot(고정 입력), generation(실행), 실제 run/task/thread/turn, message ID를 구분한다. 키 재전송은 저장된 generation 조회이며 재실행이 아니다. 복원 ID는 실행 권한이 아니다.
- 원본 source/byte·선택 범위·hash는 bridge가 검사하고 필요한 파일만 workspace/.auto-codex/atelier-inputs에 staging한다. 목적별 sandbox는 제작 범위와 별개다. 명시적 승인·기존 일반 조사 옵션을 보존한다.
- SQLite와 history 사이 단일 원자 commit은 없다. 준비/dispatch/runtime journal을 저장하고 재시작 미완료 generation은 interrupted/outcome unknown으로 처리한다. 기존 승인·trust·network 권한을 복원하거나 자동 실행하지 않는다.
- user_version 1/2 이전 시 일관된 VACUUM INTO 사본을 먼저 만들고 데이터·원본 Atelier DB·history를 보존한다. 전체 기록 복구는 bridge 종료 후 일관된 DB+files와 호환 버전을 함께 사용하며 사용자 코드 삭제/자동 downgrade는 하지 않는다.
- legacy atelier-backup v1은 수동 설계·원본 byte의 새 프로젝트 가져오기를 유지한다. handoff는 복원 백업이 아니다. 통합 AI 백업은 아직 제안이다. 새 결과가 구형 형식에 표현되지 않을 때는 조용히 누락하지 않고 명시적 거부/전체 데이터 보관 안내가 필요하다.
- **7단계 시작 시 미구현:** ArtifactManifest·실제 명령 근거에 따른 검사 상태·자동 결과 연결·안전한 코드/이미지 산출물 읽기. 현재 generation.artifactStatus는 pending이고 과거 실제 스모크 성공은 제품의 자동 산출물/검토 완료 기능과 구분한다.

기능 보존 매핑은 FEATURE_PRESERVATION.md의 A01~A20/T01~T20을 유지한다. 새 7단계 연결은 A08~A14/A17/A20과 T12~T19의 실제 소스·요청·검사에 추가하며, 기존 수동 result.register/review/plan/snapshot 경로를 대체하지 않는다. 이후 별도로 진행한 [7단계 구현·검증](STAGE7_IMPLEMENTATION.md)은 이 점검 시점과 구분한다. 단일 브리지·WS envelope/크기·ID·목적별 sandbox·Node/SQLite·백업 재매핑/복구의 상세 목표는 CONTRACTS.md, 현재 구현 차이는 3/5/6/7단계 기록을 따른다.
