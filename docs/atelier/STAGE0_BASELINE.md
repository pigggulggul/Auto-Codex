# Atelier 통합 0단계 — 기준선과 구현 전 결정

기록일: 2026-10-29, Asia/Seoul. 이 단계는 소스 조사·기존 검사·설계 문서 작성이다. UI·런타임·저장 형식·테스트 설정은 변경하지 않았고 실제 Codex·모델을 실행하지 않았다.

후속 수정 (2026-10-29 23:00 KST): **B01 테스트 러너 충돌을 해결했다.** `vite.config.ts`의 test.include를 Auto-Codex의 src/server 테스트로 한정하고 Atelier는 기존 Node runner로 유지했다. 기본 `npm test` 18개 파일/81개, Atelier 독립 테스트 53개, 타입 검사·빌드·Atelier 문법 검사 14개가 모두 통과했다. 로그는 `.cache/test-runner-fix/`에 있다. 아래 실패·소스 지문·진행 조건은 0단계 당시의 이력으로 보존하며, 현재 다음 작업은 1단계 공통 셸 구현이다. 테스트 삭제·skip·assertion 변경이나 앱 기능 변경은 없다.

읽을 순서: 이 문서 → [기능 보존표](FEATURE_PRESERVATION.md) → [구현 계약](CONTRACTS.md). 전체 작업 순서는 [통합 가이드](../ATELIER_INTEGRATION_GUIDE.md)를 따른다.

## 1. 조사 대상과 변경 보존

- 루트: `C:\Users\USER\Desktop\Claude\Auto-Codex`, 브랜치 `main`.
- 적용 지침: 루트 `AGENTS.md`. 숨김 파일을 포함한 저장소 검색에서 추가 `AGENTS.md`/`AGENTS.override.md`는 발견하지 않았다.
- 최초 확인 HEAD: `e66837b6f9ee74b7fbb4a1c0fbaad2034765540b`. 실행 전 다수 수정·미추적 파일과 `atelier/` 원본이 있었다.
- 조사 중 외부 Git 작업으로 HEAD가 `2fed4b606f6fafad3d2859bf48edfd9d63a6a655`로 바뀌었다. 이 작업에서는 stage/commit/reset/stash를 실행하지 않았다.
- 실행 전 지문을 기록한 소스·매니페스트·도구·에셋 등 **192개 파일의 SHA-256은 실행 후 동일**했다. 최종 지문은 [소스 목록](STAGE0_SOURCE_MANIFEST.json), 명령별 결과와 로그 해시는 [검증 기록](STAGE0_EVIDENCE.json)에 보관한다.
- 사용자 데이터 `.local-data/history.json`, Atelier 실제 `data/`와 비밀 파일은 열거나 마이그레이션하지 않았다. 테스트는 임시 데이터와 합성 프로젝트를 사용했다.

검사 로그의 로컬 원본은 `.cache/atelier-stage0-20261029/`에 있다. 캐시 경로의 자료는 전달용 계약이나 복원 데이터가 아니며 Git에 포함하지 않는다. 공유 문서에는 원문 환경 변수·실제 대화·자격증명을 기록하지 않았다.

## 2. 실제 환경과 실행 명령

| 항목 | 현재 확인 결과 |
|---|---|
| OS / 런타임 | Windows, Node `v22.20.0`, npm `11.6.2` |
| SQLite | `node:sqlite`의 `DatabaseSync(':memory:')` 정상, SQLite `3.50.4`; experimental 경고 발생 |
| 루트 패키지 | Auto-Codex `0.1.0`, React `19.2.8`, Vite `8.2.2`, Vitest `4.1.11`, TypeScript `7.0.2` — package-lock 기준 |
| 의존성 | 루트 package-lock 유지, 신규 설치·패키지 변경 없음. Atelier는 런타임 외부 패키지 없음 |
| 버전 제약 | 잠금 파일 Vite/plugin-react는 `^20.19.0 || >=22.12.0`, Atelier package는 `>=22.13` |
| 문서 차이 | 루트 README의 Node 20+는 Vite의 20.19 하한을 충분히 설명하지 못한다. 통합 지원안은 22.13+이며 현재 설정에 적용하지 않았다 |
| 런처 | START_AUTO_CODEX.cmd는 node 존재만 확인하고 버전 비교는 하지 않는다. 포트 정리·필요 시 설치·CLI 탐색·브라우저 열기 부작용이 있어 이번 검증에서는 실행하지 않았다 |
| CI | `.github/` 기반 CI 설정을 발견하지 않았다. 로컬 검사 결과만 기록한다 |

실제 스크립트:

| 위치 | 명령 | 현재 동작 |
|---|---|---|
| 루트 | `npm run dev` | 서버 TS watch·bridge·Vite, predev에서 서버 빌드 |
| 루트 | `npm run build` | typecheck → Vite dist → 서버 TS build-server |
| 루트 | `npm start` | 빌드된 bridge가 4781에서 정적 UI와 WS 제공 |
| 루트 | `npm run launch` | 빌드 후 bridge `--serve --open` |
| 루트 | `npm run typecheck`, `npm test` | 두 TS 설정 검사 / Vitest 기본 검색 |
| Atelier | `npm --prefix atelier/atelier start` | 독립 HTTP 4317, 자체 DB·파일 저장 |
| Atelier | `npm --prefix atelier/atelier run check` | Node --check로 14개 모듈 문법 검사 |
| Atelier | `npm --prefix atelier/atelier test` | Node --test로 5개 테스트 파일, 53개 검사 |

개발 UI 4780, bridge 4781, Atelier 원본 4317은 모두 loopback에 바인딩하는 코드다. 실제 제품 서버를 켜 둔 수동 UI 검증은 이번 단계에서 하지 않았다.

## 3. 현재 데이터·신뢰 경계

### Auto-Codex

`src/App.tsx` → `useBridge` → `shared/protocol.ts`의 WS 메시지 → `server/client-message.ts` → `server/index.ts` → Codex App Server stdio JSONL.

- `project.select/pick/trust`, `workspace.mode/network`, `conversation.new/select`, `models.refresh`, `skills.refresh`, `turn.start/interrupt`, `approval.resolve`가 현재 명령이다.
- `ConversationArchive.version = 1`. `.local-data/history.json`에 대화 ID·프로젝트·transcript·Solo thread·Run/Task·결과·activity를 저장한다. 64MiB 상한, 직렬화한 원자 교체, 저장 경로/junction 검사, 손상 파일 덮어쓰기 방지가 있다.
- 복원 중 진행 상태는 interrupted로 정리한다. pending 승인·권한·네트워크 허용을 복원하지 않는다. Solo는 thread/resume, Team task는 ephemeral이다.
- 기본 프로젝트 Solo는 workspaceWrite다. Team의 access=read 및 research 모드는 readOnly, 프로젝트 write는 선택 root의 workspaceWrite다. 네트워크는 프로젝트에서 false, 폴더 없는 조사만 사용자 설정을 반영한다.
- 승인 내용은 브리지의 pending request에서 가져오고 `approvalResponse`는 요청된 권한만 반환한다. 브라우저의 approvalId와 App Server 원본 ID를 구분한다.

### Atelier

`public/app.js` → 동일 출처 `/api/*` → `server.mjs` → SQLite + 실제 파일. AI 실행 연결은 없다.

- 기본 위치는 `atelier/atelier/data/atelier.sqlite`, `data/files/<project-id>/<file-id><ext>`이며 ATELIER_DATA로 테스트 위치를 분리한다.
- SQLite 테이블은 projects·revisions·files·settings. WAL/foreign_keys 활성화. projects.version에 의한 optimistic conflict, revisions의 이전 JSON, 기존 snapshots 변경 금지가 있다.
- project.schemaVersion=1, modelVersion=2. package=1.2.0, health=1.3.0, GUIDE_VERSION=guide-1.3.2, TEMPLATE_VERSION=atelier-prompt-1.3.2는 서로 다른 버전이다.
- `unknown/proposed/confirmed/excluded`, `user/example/observation/external`이 현재 결정 상태/출처다. AI용 출처는 아직 없다.
- 자체 백업은 `{format:'atelier-backup', version:1, exportedAt, project, files}`. 한 설계 프로젝트의 전체 데이터·파일·내부 이력을 담는다. 프로젝트 목록 전체 백업은 아니다. 복원은 새 프로젝트 ID를 만들고 원본을 보존한다.
- 전달용 ZIP은 prompt.md·decisions.json·handoff.json·attachments.txt·선택된 실제 files를 담는다. 자체 백업과 달리 전체 편집 이력을 복원하지 않는다.
- 기존 제한은 파일당 15MiB, JSON 요청/백업 90MiB. 원본/크롭/이미지 결과는 PNG/JPEG/WebP. 문서·데이터·서체·SVG·ZIP 등은 별도 리소스이며 실행·압축 해제하지 않는다.

## 4. 검증 결과

최종 판정은 각각의 종료 코드로 판단했다. 아래 진단용 통과 결과는 기본 `npm test` 실패를 대체하지 않는다.

| 명령 / 조건 | 결과 | 근거·의미 |
|---|---|---|
| `npm run typecheck` | 통과, exit 0 | renderer / server 타입 검사 |
| `npm run build` | 통과, exit 0 | 내장 typecheck 포함, 37개 UI 모듈·dist·서버 빌드 |
| `npm test` — 기본 sandbox | 실행 전 실패, exit 1 | 23개 suite 변환 캐시 rename EPERM, 실행된 Vitest test 없음 |
| `npm test` — 작업 폴더 TEMP/TMP | 실패, exit 1 | Vitest 80 통과·junction fixture 생성 1 실패, Atelier node:test 5개 suite를 잘못 수집 |
| `npm test` — 허용된 로컬 테스트 권한 | **실패, exit 1** | Auto-Codex 18개 파일/81 tests 통과, Atelier 5개 파일에 `No test suite found` |
| `npm test -- src server` — 진단 | 실패, exit 1 | 경로 substring 필터의 server가 Atelier server.test.mjs도 선택. 81 tests는 통과했지만 격리 명령으로 부적합 |
| `npm test -- --exclude 'atelier/**'` — 러너 분리 진단 | 통과, exit 0 | Auto-Codex 18개 파일/81 tests, skip 없음 |
| `npm --prefix atelier/atelier run check` | 통과, exit 0 | 14개 실행 모듈 문법 |
| `npm --prefix atelier/atelier test` — 기본 sandbox | 중단 | loopback 연결 제한으로 통합 fixture 실패/대기. 종료해 독립 실행으로 재검증 |
| `npm --prefix atelier/atelier test` — 허용된 로컬 테스트 권한 | 통과, exit 0 | 53 tests, 실패/취소/skip 0 |
| `node tools/verify-conversation-restart.mjs` — 기본 sandbox | 실패, exit 1 | loopback 4785 connect EACCES |
| 동일 재시작 검사 — 허용된 로컬 테스트 권한 | 통과, exit 0 | 프로젝트 전환·transcript·thread resume·Team 중단 복구·만료 승인 거부·네트워크 기본 false |
| 메모리 SQLite 조회 | 통과 | 실제 사용자 DB를 열지 않고 내장 API 확인 |

기본 sandbox의 TEMP/TMP 진단은 쓰기 가능한 저장소 안으로 임시 파일 위치만 바꿨다. junction/포트 권한까지 해결됐다고 주장하지 않았으며, 해당 검사는 명시적인 도구 권한 확장 후 수행했다. 실제 모델·도구·외부 네트워크 호출은 없었다.

## 5. 확인된 차이·다음 단계 전 조건

### B01 — 루트 테스트 러너 검색 범위 충돌

근거: 루트 package.json의 `vitest run`, vite.config.ts에 test.include/exclude 없음, Atelier tests의 `node:test` import. Vitest가 `atelier/atelier/tests/*.test.mjs`를 수집하지만 그 파일은 Node runner 전용이므로 suite 없음으로 실패한다.

수정 방향: **다음 구현 단계에서** 별도 test 설정으로 루트 Vitest를 `src/**/*.test.{ts,tsx}`·`server/**/*.test.ts`에 한정하고, Atelier Node runner를 별도 명령/검증 절차로 유지한다. 테스트 삭제·skip·assertion 완화는 하지 않는다. 이 단계는 기준선 기록이므로 설정을 수정하지 않았다. 기본 npm test가 통과하기 전 전체 검증 통과나 통합 준비 완료라고 보고하지 않는다.

### B02 — 설계 제안에는 새 실행 정책이 필요

현재 프로젝트 Solo의 sandbox는 workspaceWrite이며, task-planner의 `design` kind도 write로 정규화한다. 따라서 단순 프롬프트 교체나 visual 역할 지정은 readOnly 제안 정책을 만들지 못한다. 5단계의 공통 실행 어댑터에서 서버가 목적별 정책을 강제해야 한다.

### B03 — 보안·대용량·UI 검증은 현재 기능과 구분

- 현재 WS는 `new WebSocketServer({noServer:true})`로 명시적인 앱별 maxPayload가 없고, 파서는 unknown type은 거부하지만 모든 추가 필드·문자열/배열 크기를 제한하지 않는다. 새 계약의 엄격한 필드·chunk·속도 제한은 아직 미구현이다.
- 현재 isAllowedOrigin은 Origin이 없으면 허용하고 로컬 hostname/port를 검사한다. 새 Host/세션 검증이 구현됐다고 보지 않는다. 인터넷 노출이나 실제 공격 실험은 하지 않았다.
- ApprovalDialog에는 aria-modal 등 선언은 있으나 초점 trap·복귀·Escape 동작을 보장하는 로직을 확인하지 못했다. ResultView 등의 SSR 테스트 통과는 실제 키보드/보조기기 검증을 대체하지 않는다.
- Atelier bundle은 요청 snapshot ID를 찾지 못하면 최신 snapshot으로 fallback한다. 신규 제작/내보내기 API는 명시적 snapshot 누락을 거부해 잘못된 버전 전달을 막아야 한다.

위 항목은 소스 조사에 기반한 구현 과제다. 실제 취약점 악용 성공이나 독립 보안 감사 결과로 해석하지 않는다.

## 6. 단계 진행 판정

**0단계 조사·기준선·계약 문서 작성은 완료. 제품 통합은 미구현.** 기능 보존 매핑과 후속 계약은 별도 문서에 고정했으며 아직 작동하는 API가 아니다.

1단계 착수 조건:

1. B01 러너 분리를 선행 검증 작업으로 처리하고 기본 npm test 및 Atelier 독립 검사를 모두 통과시킨다.
2. 현재 Git/하위 지침/소스 지문을 재확인한다. 기존 사용자 변경을 되돌리지 않는다.
3. 공통 셸은 일반 작업·대화/결과·픽셀·활동·승인을 전부 연결하고, 설계 미구현 메뉴는 준비 상태로 표시한다.
4. 이번 계약의 Node 22.13+·SQLite·WS·AI 정책은 이후 해당 단계에서 구현한다. 1단계에서 런타임·DB·AI 기능까지 함께 바꾸지 않는다.

미검증: 실제 CLI 설치·로그인·모델 제작, 라이브 UI/접근성/모바일, Node 22.13.0 자체에서의 실행, 장기간 데이터/성능, 새 WS·DB·어댑터. 배포·원본 데이터 이전·승인 대기 없음. 현재 변경 위험도는 R0 문서이며, 계약의 실제 적용은 R2다.
