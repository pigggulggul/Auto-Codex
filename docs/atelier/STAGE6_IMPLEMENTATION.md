# 6단계 — 고정 스냅샷에서 기존 Team/Solo 제작 연결

2026-10-30. `main`의 깨끗한 작업 트리에서 시작했고 루트 AGENTS.md 외 하위 AGENTS/override는 없었다. 소스는 5단계까지 구현되어 있었으며, CONTRACTS.md의 binding/generation은 목표 계약이었다. 아래 범위를 구현했다. **로컬·합성 검증 및 CLI 갱신 후 GPT-6.1 Sol의 실제 Solo 생성·수정 스모크가 통과했다.** 최초 0.101.0 CLI/5.2 모델 거부 이력은 보존하며, 후속 6시리즈 검증 결과와 구분한다.

## 실제 구현

- `shared/atelier/execution.ts`: WorkspaceBinding, InputManifest, DesignGeneration의 실제 타입. 기존 Project/PromptSnapshot/ManualResult/history archive v1 형식은 변경하지 않았다.
- `server/atelier/execution.ts`, `staging.ts`: 서버 소유 binding, snapshot/plan 소유·버전·draft·확정 의도 검사, 파일 소유·원본 byte/hash 검증과 staging. 현재 편집본 대신 명시된 과거 고정본을 그대로 사용한다. create는 final, revise는 confirmed plan에 연결된 revision snapshot을 사용한다. revision의 planId는 snapshot에서 가져오며 브라우저가 따로 지정하지 않는다.
- `execution-runtime.ts`, `server/index.ts`: 준비부터 종료 저장까지 일반 실행/제안과 공통 admission을 유지하고 **기존 startTurn → startTeamRun/ensureThread**를 호출한다. 별도 Codex child나 제작 스케줄러는 없다. 기존 계획 검증·최대 8 task·동시 read 3·writer/검증 독점을 유지한다. 일반 작업의 추가 맥락 텍스트를 제작 프롬프트에 자동 조립하지 않는다. Solo의 같은 대화 thread 재개 자체는 유지하므로 thread의 기존 대화 맥락이 사라진다는 뜻은 아니다.
- 기존 모델 목록·effort·활성 스킬을 시작 직전 확인한다. Auto는 실제 제작 프롬프트에 동일 결정적 router를 적용하여 manifest에 경로를 기록하며, Manual 미선택은 기본 에이전트다. 모델 카탈로그는 계정 사용 가능 보장이 아니며, 모델 실패는 실제 실패로 기록한다.
- 실제 Solo thread/turn, Team run/task/agent/thread/turn만 기록한다. Solo에 Team ID를 만들지 않는다. DB에는 대화 ID와 실제 user/assistant message ID를 연결한다. 토큰·응답·activity·pending 승인 처리는 기존 경로를 사용한다. 완료 task/turn 및 소속을 모르는 지연 이벤트가 다른 대화 응답으로 떨어지지 않게 거부한다. 진단 method 이벤트는 기존대로 남는다.
- `Generation.tsx`, `Workspace.tsx`, `App.tsx`, `api.ts`: 프롬프트 스튜디오의 선택 고정본 → 현재 workspace/대화 연결 → 실제 제작 시작/기록 조회/중단. 기존 실행 설정의 Team/Solo·모델·스킬을 사용한다. 요청 불명 시 같은 키를 사용자가 조회하며, 마운트/재접속은 조회만 한다. 탭 이동과 기존 승인/결과/픽셀/활동 진입점은 유지한다. generation interrupt는 같은 연결의 시작/대용량 전송 큐보다 우선 처리한다.

변경 파일(저장소 루트 기준):

| 영역 | 파일 |
|---|---|
| 실행·타입·staging | `shared/atelier/execution.ts`, `server/atelier/execution.ts`, `execution-runtime.ts`, `staging.ts`, `server/index.ts` |
| 저장·WS 통합 | `server/atelier/store.ts`, `worker.ts`, `client.ts`, `handlers.ts`, `errors.ts`, `.gitignore` |
| 화면·transport | `src/features/atelier/Generation.tsx`, `Workspace.tsx`, `api.ts`, `src/App.tsx` |
| 검사 | `server/atelier/execution.test.ts`, `atelier.test.ts`, `src/features/atelier/api.test.tsx`, `tools/fixtures/generation-app-server.mjs`, `tools/verify-atelier-generation.mjs`, `verify-atelier-generation-live.mjs`, `verify-atelier-storage.mjs` |
| 문서·근거 | `docs/ATELIER_INTEGRATION_GUIDE.md`, `docs/atelier/CONTRACTS.md`, `FEATURE_PRESERVATION.md`, 이 문서, `STAGE6_WS_EVIDENCE.json`, `STAGE6_LIVE_EVIDENCE.json`, `stage6-ui-{1440,768,390}.png` |

## 실제 WS 계약

공통 strict envelope는 `type, v:1, clientRequestId:UUID, payload`이며 제어 256KiB/기존 제한을 유지한다. browser sandbox/command/cwd/permissions/writableRoots 필드는 허용하지 않는다.

| operation | 실제 payload / 반환 |
|---|---|
| binding.set | P, expectedVersion, conversationId. 현재 선택한 실제 project workspace·대화만 서버에서 연결하고 이미 명시적으로 신뢰된 경로인지 검사. binding ID·버전 반환 |
| binding.get | P → 현재 binding 또는 null |
| generation.start | P, expectedVersion, snapshotId, bindingId, purpose(create/revise), executionMode(team/solo), skillMode(auto/manual), model?/effort?/skillPath?, idempotencyKey(UUID). 저장된 generation 반환 |
| generation.list | P, cursor?, limit?(1~64) → 기존 페이지 계약, input 전체 제외 |
| generation.get | P, generationId → 고정 input과 실제 runtime IDs/상태/오류/message IDs |
| generation.interrupt | P, generationId → 현재 active generation만 중단 요청. 다른/과거 generation은 NOT_FOUND |

`atelier.generation.state` 이벤트에는 P, generationId, snapshotId, conversationId, version, state, runtime을 넣는다. 일반 `run.state`, `turn.state`, `activity.event`, `approval.*`, `assistant.text`, `token.usage` 계약을 대체하지 않는다. capabilities의 execution은 현재 CLI 연결 여부이며 inference 성공 보장이 아니다.

동일 키는 `{P, snapshotId, bindingId, purpose, 실행/모델/스킬 선택}` 요청 내용의 정규화 해시에 묶인다. expectedVersion은 재조회 시 변할 수 있어 해시에서 제외한다. 같은 키·내용은 실행 중/종료 후/재시작 후 모두 저장된 generation을 반환한다. 같은 키·다른 내용은 IDEMPOTENCY_CONFLICT다. 수정/재시도는 사용자가 새 키로 시작한다. 현재 별도 retryOf 필드는 지원하지 않는다.

## 입력·권한·저장·복구

InputManifest v1은 snapshot 전체 SHA-256/프롬프트 SHA-256, 결정 버전, selection, binding 버전·대화·canonical workspace, 실제 선택 모델/effort/skill, 파일 ID/hash/size/role/staging 상대경로를 고정한다. snapshot이 선택한 referenceFileIds만 byte로 전달하며 전체 코드/대화/환경/DB를 입력 묶음에 포함하지 않는다. 이미지 파일도 원본 자료로만 staging하며 시각 입력·이미지 이해를 보장하지 않는다.

staging은 `<검증 workspace>/.auto-codex/atelier-inputs/<서버 gen-id>/`다. 서버 ID와 검증된 확장자만 파일명으로 사용하고 `wx`에 해당하는 exclusive open·symlink/junction 검사·canonical 경로 재확인·sync·해시 대조를 한다. 실행 전달 직전 prompt/manifest/선택 byte를 다시 검사한다. 파일당 기존 15MiB, 선택 입력 256개/90MiB, prompt 128KiB, generation JSON 220KiB, 프로젝트별 generation 256개, 디스크 여유 16MiB 이상을 적용한다. `.gitignore`에는 staging namespace만 추가했다. 원본을 덮어쓰거나 첨부/ZIP/SVG를 실행하지 않는다.

staging은 성공/실패/중단 후 **보존**하며 자동 정리하지 않는다. 부분 준비도 보존한다. 원본 코드/설계 저장소와 구분하여 사용자가 실행 종료를 확인한 뒤 정리할 수 있다. 범용 삭제·셸 API는 없다. 경로 검사와 OS open 사이 로컬 파일시스템 경쟁을 완전히 원자적으로 차단하는 OS 전용 핸들 정책까지 구현한 것은 아니다.

제작 범위는 산출 목표다. 파일 권한은 별도 workspaceWrite sandbox이며 선택 화면 파일만 쓸 수 있다고 주장하지 않는다. turn networkAccess=false를 유지하고 기존 on-request/pending ID/요청된 권한 subset 승인 경로를 사용한다. 일반 폴더 없는 조사·명시적 웹 옵션은 유지하되 제작에는 사용하지 않는다. 일반 작업·제안·다중 창·기다리는 승인과 잠금을 공유한다.

SQLite user_version=3에 bindings/generations만 추가한다. 기존 v2는 변경 전 VACUUM INTO로 일관된 `atelier-v2-backup-*.sqlite`를 남긴다. v1이면 기존 v1 사본 절차를 거쳐 v3로 이동한다. 기존 프로젝트·파일·history·Atelier 원본 DB는 이전/삭제하지 않는다. generation 자체의 preparing → dispatching → 실제 runtime 연결 기록이 실행 journal이다. history placeholders의 저장 성공을 기다린 후 dispatching을 저장하고 모델 turn을 보낸다. 두 저장소의 단일 원자 commit이나 exactly-once dispatch를 보장하지 않는다. 시작/종료 저장 실패 및 응답 불명은 자동 재전송하지 않으며, 실행기 종료 확인 실패는 잠금을 유지한다. 재시작 시 미완료 generation은 RUNTIME_OUTCOME_UNKNOWN/interrupted로 정리하고 ID는 역사로만 남긴다. 승인·trust·네트워크 허용을 복원하지 않는다.

legacy JSON 백업은 여전히 설계·파일 백업이다. 제안·binding·generation은 포함하지 않음을 UI에 표시했다. 통합 AI 백업은 후속 제안이다. 전체 AI 기록 보관은 bridge 종료 후 `.local-data/atelier` 전체, history는 별도로 보관해야 한다. 구버전은 v3를 읽을 수 없으므로 롤백 시 현재 전체 사본을 먼저 보존하고 호환 코드·DB/파일 사본을 함께 선택한다. 자동 downgrade나 사용자 코드 삭제는 하지 않는다.

## 검증과 한계

- 최초 구현 시 `npm run typecheck`, `npm test` 172개, `npm run build` 통과. 6시리즈 후속 변경 후에는 174개와 같은 필수 검사가 통과했다. 최초 샌드박스 Vitest 임시 캐시 rename EPERM은 테스트 미실행이며, 승인된 재실행 결과와 구분했다.
- `execution.test.ts`: 실제 byte/선택 외 파일 제외/불변 snapshot/manifest/idempotency, draft/다른 snapshot·binding·대화/버전/권한 필드 거부, 손상 원본·staging, junction/기존 폴더·덮어쓰기/소실, v2 사본·재시작 복구, history 실패의 미전송·종료 불명 잠금. `api.test.tsx`: 같은 소켓의 진행 중 start보다 generation interrupt를 우선 보냄.
- `node tools/verify-atelier-generation.mjs`: 실제 bridge/worker/SQLite/WS와 **합성 App Server**로 Solo/Team·조기 완료·모델 실패·시작 실패 복구·승인 거부·만료 승인·준비 중 같은 소켓 중단·다중 창·양방향 일반/제안 잠금·재접속/재시작 중복 방지·늦은 타 작업 이벤트 차단. [기록](STAGE6_WS_EVIDENCE.json). 네트워크 false와 실제 생성된 runtime ID를 검사하며 모델 품질·파일 제작 성공 증거가 아니다.
- `node tools/verify-conversation-restart.mjs`, `node tools/verify-atelier-proposals.mjs`, `node tools/verify-atelier-storage.mjs` 통과. 저장 회귀 도구의 빈 generation.start 기대값은 미구현 CAPABILITY_UNAVAILABLE에서 구현된 strict schema INVALID_MESSAGE로 변경했다. 기존 DB 버전 assertion은 2→3으로 바꾸고 handle finally close를 보강했다. 검사 삭제/skip은 없다.
- 원본 `npm --prefix atelier/atelier run check` 14개 모듈과 `npm --prefix atelier/atelier test` 53개도 통과했다. 최초 샌드박스 로컬 연결 실패와 남은 검사 프로세스의 포트 충돌은 실패로 구분하고, 해당 프로세스 종료 후 단독 재실행했다. 원본 소스는 수정하지 않았다.
- Solo의 응답 전 이벤트는 512개/512KiB로 제한해 잠시 보관하고, 실제 turn/start 응답 ID를 저장한 뒤 일치하는 이벤트만 반영한다. 초과는 실행기 중단과 잠금 보존으로 처리한다. 합성 조기 완료와 같은 thread의 잘못된 조기 turn/본문 거부를 추가 확인했다.
- UI: `node tools/verify-atelier-generation.mjs --ui` 합성 fixture에서 선택 고정본으로 Team 시작→실제 fixture 종료→산출물 확인 필요 표시 확인. 1440/768/390px 가로 넘침 없음, reduced-motion과 Tab으로 기록 선택 접근 확인. `stage6-ui-1440.png`, `stage6-ui-768.png`, `stage6-ui-390.png`. 실제 모델·전체 접근성 검증과 구분한다.
- 현재 설치 `codex-cli 0.101.0`에서 generate-json-schema로 workspaceWrite/writableRoots/networkAccess/approvalPolicy 필드를 확인했다. 이전 5단계 기록의 0.165와 다르다. 현재 readOnly 스키마에는 networkAccess 필드가 없어 제안 경로의 전 버전 호환성 검증을 이번에 완료했다고 주장하지 않는다. [공식 App Server 문서](https://learn.chatgpt.com/docs/app-server)의 수명 주기와 로컬 설치 스키마를 대조했다.
- 최초 `node tools/verify-atelier-generation-live.mjs --live`: 이미 신뢰된 이 저장소의 `.cache` 합성 단일 HTML 생성/수정을 목표로 실제 요청을 시도했다. 첫 도구 실행의 과도한 조회는 LIMIT_EXCEEDED로 실패하여 조회 간격을 수정했다. 재시도는 실제 turn을 받았으나 기본 카탈로그 `gpt-5.2-codex`가 ChatGPT 계정에서 지원되지 않는다는 실제 활동 오류와 함께 failed. [갱신 전 실패 기록](STAGE6_LIVE_PRE_UPGRADE.json). 그 당시 실제 생성·수정은 미검증이었으며 아래 후속 실행에서 확인했다.

7단계 ArtifactManifest·자동 결과 등록·검사 통과 판정·시각/동작 검토·자동 수정 왕복은 **아직 제안**이다. 현재 artifactStatus는 pending만 사용한다. completed는 App Server 종료만 의미하며 산출물·검토 완료를 만들지 않는다. 다음 단계에서는 이번 실제 파일/실행 근거를 검증된 manifest로 원본 snapshot에 자동 연결해야 한다. 실제 Team의 모델 계획 품질과 전체 시각/동작 검토는 미검증이다.

실제 스모크 재실행은 `node tools/verify-atelier-generation-live.mjs --live --model <설치 App Server 카탈로그의 선택 모델>`이다. --model 생략 시 현재 기본 모델을 쓰며, 거부된 모델을 자동 교체하지 않는다. 기존 CODEX_BIN 설정을 유지할 수 있지만 CLI 교체·설치나 로그인/계정 변경을 이 도구가 수행하지 않는다.

## CLI 갱신 후 6시리즈 후속 검증

사용자가 CLI 갱신 완료와 6시리즈 중심 사용을 지정했다. 기존 미커밋 6단계 변경을 보존한 채 다음을 반영했다.

- 설치 `codex-cli 0.166.0`의 실제 model/list에서 `gpt-6.1-sol`(default), `gpt-6-astra`, `gpt-6.1-terra`, `gpt-6-sol`, `gpt-6-luna`를 확인했다. 카탈로그 반환은 사용 권한 확정과 구분하며 실제 호출 모델만 성공 확인한다.
- 새 `shared/model-selection.ts`/`model-selection.test.ts`: 제공 목록에 6시리즈가 있으면 해당 목록의 순서·default·effort를 그대로 사용한다. 모델명은 하드코딩하지 않는다. `src/App.tsx` 선택기는 이 경우 6시리즈만 표시하고, 저장된 5시리즈 선택은 유효한 6시리즈 기본값으로 전환한다. 일반 작업·제안·제작의 서버 기본 선택도 같은 함수를 사용한다. 6시리즈 없는 합성/기타 카탈로그의 기존 동작은 보존한다. 명시된 모델의 실행 실패 후 자동 fallback은 없다.
- 추가 변경 경로: `server/index.ts`, `server/atelier/proposal-runtime.ts`, `src/App.tsx`, `tools/verify-atelier-generation-live.mjs`, shared의 위 두 파일. 실행기·권한·저장 형식은 변경하지 않았다. live 스모크는 제공된 6시리즈만 허용한다.
- `node tools/verify-atelier-generation-live.mjs --live --model gpt-6.1-sol` 통과. 실제 HTML 1,581 bytes를 생성하고 bridge 재시작 후 같은 thread를 resume하여 수정했다. create와 revise의 generation/turn은 서로 다르며 실제 파일의 SHA-256이 변경되었다. 수정 HTML의 title/h1, 기존 버튼 존재와 inline script의 구문 파싱을 별도 확인했다. 브라우저 행동 검토를 완료한 것으로 기록하지 않았다. [현재 성공 기록](STAGE6_LIVE_EVIDENCE.json).
- 타입 검사·174개 테스트·빌드·최종 합성 제작 회귀 통과. 5시리즈 성공 검증, 나머지 모든 6시리즈의 실제 inference는 이번 범위가 아니다. 별도 API·결제·배포·권한 변경은 없다.

R2 위협 분석: 보호 자산은 로컬 코드·설계·첨부·대화와 실행/승인 권한이다. 비신뢰 WS·파일·모델을 bridge strict schema/소유·해시·canonical path·영속 중복 키·공통 잠금·pending 승인 경계에서 제어한다. 교차 프로젝트/경로 이탈/재전송/동시 창/저장·실행기 장애를 위 테스트로 확인했다. 로컬 전용 저장소는 오프라인 추론을 뜻하지 않으며 선택된 합성 자료만 기존 Codex 모델 경로로 전달했다. 외부 서비스·유료 API 추가, 설치, 배포, push/merge는 실행하지 않았다. 자기 diff 검토이며 독립 보안 리뷰는 아니다. 승인 대기 없음.
