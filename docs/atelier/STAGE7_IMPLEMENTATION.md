# 7단계 — 실제 산출물과 검토·수정 왕복

2026-10-30. `main`, HEAD `ced016939fc2a04864132454a3b55e5aa464a933`의 기존 미커밋 6단계 변경을 보존했다. 루트 AGENTS.md와 대상 하위 지침 유무를 확인했다. 이 작업의 [0단계 재점검](STAGE0_RECHECK_STAGE7.md)은 UI·AI 실행 없이 먼저 마쳤다. 원본 Atelier, 사용자 데이터·코드, 기존 대화 형식을 교체하지 않았다. 아래는 목표 계약과 구분되는 현재 구현이다.

## 구현과 변경 파일

| 영역 | 실제 파일 | 동작 |
|---|---|---|
| 근거 계약 | shared/atelier/artifacts.ts, execution.ts, types.ts | manifest, 실제 명령/파일 근거, 결과의 generationId/artifactManifestId/behaviorEvidence 추가 |
| 근거 정규화·파일 경계 | server/atelier/artifact-events.ts, artifact-paths.ts | 실제 item ID·thread/turn, 명령 종류/종료 코드, 경로·byte/hash 검사 |
| 수집·원본 결과 연결 | server/atelier/artifacts.ts | 종료 후 불변 사본, 원래 snapshot 결과 생성, 실패·누락·부분·검사 연결 구분 |
| 저장·실행 연결 | store.ts, execution.ts, execution-runtime.ts, worker.ts, index.ts | SQLite v4, 내부 artifact.record/finish, 기존 공통 실행 잠금과 이벤트 귀속 유지 |
| 공개 요청·호환성 | handlers.ts, validation.ts, bundle.ts, shared/atelier/domain.ts | 제한된 읽기/재연결, 자동 근거 수정 거부, 사용자 직접 동작 근거 요구, legacy 손실 방지 |
| UI | src/features/atelier/Artifacts.tsx, Generation.tsx, Review.tsx | 네 상태 표시, 안전한 코드/이미지, 원본 기준·시각/동작 검토·별도 AI 의견·수정 계획 |
| 검증 | artifacts.test.ts, atelier.test.ts, fixtures/artifact-app-server.mjs, verify-atelier-artifacts*.mjs | 실제 byte·안전 경계·합성 WS·실제 모델 왕복 |

가이드 초안은 `change:created/modified`를 제안했지만, App Server의 실제 `fileChange.changes.kind`는 `add/update/delete`이며 이전 파일 내용 자체를 증명하지 않는다. 현재 `reportedChange`로 런타임 보고임을 명시한다. 이전 byte 비교로 새 파일/수정 파일을 추정하지 않는다. [공식 App Server 문서](https://learn.chatgpt.com/docs/app-server)와 설치 CLI 0.166.0의 로컬 JSON schema를 확인했다. `item/completed`의 파일·명령 기록을 사용하며 모델 본문의 파일 목록·성공 문장은 근거로 사용하지 않는다. 새 shell API나 별도 제작 실행기는 추가하지 않았다.

## 실제 WS 계약

기존 `atelier.*` v1 envelope, 허용 필드 검사, P/버전 검사, 기존 chunk 전송을 사용한다. renderer는 파일 경로·명령·승인 권한을 지정하지 않는다.

| 요청 | payload | 결과 |
|---|---|---|
| artifact.get | designProjectId, generationId | 해당 프로젝트 generation의 executionState와 manifest 또는 null |
| artifact.read | designProjectId, generationId, artifactId, view:preview/download | 실제 hash 재검증 후 download descriptor, mime, truncated; byte는 transfer.read |
| artifact.attach | designProjectId, expectedVersion, generationId | ready 근거의 누락 결과 연결만 재시도. 실행·현재 파일 재수집 없음 |

`artifact.record/finish`는 worker 내부 전용이다. 공개 요청으로 runtime 근거를 제출할 수 없다. compact `atelier.artifact.state` 이벤트는 조회 신호다. `atelier.project.changed`는 자동 결과로 저장 버전이 바뀌었음을 알리며 사용자 편집 초안을 자동 덮어쓰지 않는다.

manifest contractVersion=1은 P/generation/snapshot, 수집 phase(recording/collecting/ready/interrupted), artifact status, checkStatus, 실제 후보 경로·파일·명령·제외/누락·한계를 저장한다. 명령/파일은 실제 thread/turn/item, Team 명령은 task ID에도 연결한다. Solo에 가짜 run/task ID를 생성하지 않는다. 마지막 runtime ID와 다른 항목은 제외한다. 이전 6단계 generation은 manifest 없음으로 표시하며 현재 파일을 과거 결과로 연결하지 않는다.

## 수집·검사·미리보기

- 기존 실행기에서 관측한 fileChange 경로만 종료 시 수집한다. canonical workspace 내부·실재 디렉터리, traversal, private 경로, junction/symlink/hardlink, 비밀 형태 내용, 파일 크기·읽기 전후 identity·변경·SHA-256를 검사한다. 파일 삭제 보고는 실제 부재도 확인한다. Git 초기화/전체 workspace 스캔은 없다.
- 실제 byte를 `.local-data/atelier/artifacts/P/manifestId/artifactId.bin`에 배타적으로 복사·sync·hash 검사한다. ready manifest는 불변이다. 후속 제작이 같은 경로를 변경해도 이전 사본과 결과의 snapshotId는 유지된다. 자동 결과 생성과 manifest.resultId 연결은 한 SQLite transaction이다. 자동 출처·실행 기록은 result.update로 변경하지 못한다.
- 관측된 정확한 `npm test`, `npm run test/typecheck/build` 및 제한된 PowerShell wrapper만 검사로 분류한다. 실제 cwd가 제작 workspace와 같고, 종료 코드 0, 파일의 검사 시점 hash와 최종 hash 일치, 이후 fileChange 없음, 누락/제외 없음일 때만 **관측된 검사**가 passed다. 다른 cwd·임의 shell/모델 문장·실행 전/후 불명 파일은 통과 근거가 아니다. 전체 필수 검사가 실행됐다는 뜻은 아니다.
- 명령 원문과 stdout/stderr는 manifest에 남기지 않는다. 표준 검사 label·실제 상태·종료 코드·시간·hash 연결만 남긴다. 파일 변경 diff도 저장하지 않는다. 기존 일반 대화/진단 정책은 별도이며 이 기능이 원문 로그의 비밀 제거를 보장하지 않는다.
- 경로 최대 256개, 명령 64개, 파일당 15MiB, 캡처 총량 90MiB. 검사 checkpoint 읽기 총량은 generation당 512MiB, 회당 90MiB다. 후보 메타데이터 80KiB, 후보+명령 110KiB, 완성 시 200KiB의 내부 예산으로 DB manifest 220KiB·WS frame 1MiB 이하를 유지한다. 한도/비밀/경로 검사 실패는 제외와 한계를 남기며 검사 통과를 차단한다.
- HTML/SVG/JS는 React의 `<pre>` 텍스트로만 표시한다. iframe, innerHTML, 스크립트 실행, 부모 앱 권한으로 여는 링크를 제공하지 않는다. 코드 미리보기는 256KiB. 구조를 확인한 PNG/JPEG/WebP만 Blob 이미지로 표시하고 URL은 폐기한다. 바이너리는 미리보기 없이 명시적 내려받기, 코드 내려받기는 안전한 .txt 이름과 octet-stream이다. 외부 자산·자동 스크린샷·시안 이미지를 만들지 않는다.

**수집 한계:** 명령·외부 도구가 fileChange 없이 만든 파일은 자동 발견하지 않는다. `verified`는 수집 대상 파일의 실제 존재·byte 확인이며 전체 요구사항·디자인 품질·실행 동작의 보증이 아니다. 검사 hash는 관측 시점의 연결이고 외부 프로세스의 모든 동시 변경을 기록하는 파일시스템 감사 기능은 아니다. 코드 평가 없이 사용자 관찰을 요구한다.

## 검토·수정 왕복

실행 종료, 산출물 확인, 관측된 검사 통과, 사용자 시각/동작 검토 완료를 별도로 표시한다. 재검토가 필요한 과거 완료 회차는 현재 완료로 표시하지 않는다. 자동 결과의 명령 종료 기록은 직접 동작 근거가 아니므로 별도 behaviorEvidence가 없으면 동작 포함 검토 완료를 거부한다. 수동 이미지/실행 근거 등록은 기존대로 유지한다.

사용자 판정은 각 기준의 관찰·근거·verdict에 저장하고 AI/외부 의견은 별도 externalFeedback/feedbackSource에 저장한다. 이 단계에 자동 AI 디자인 판정은 없다. 의견란은 사용자가 가져온 의견이며 실제 AI가 분석했다고 표시하지 않는다.

기존 review → 선택 항목 plan.create → 사용자 plan.confirm → revision snapshot → 새 revise generation → 원래 수정 snapshot의 새 result → 새 review 흐름을 사용한다. 새 판정·관찰은 초기화되고 이전 match는 회귀 항목으로 남는다. 부모 결과·계획·판정은 보존한다. 시각 자료 없이 시각 일치, 이미지로 동작 일치, 프롬프트 생성만으로 문제 해결을 선언하지 않는다.

## 저장·백업·복구와 위험도

R2: 비신뢰 모델/renderer가 사용자 workspace 파일과 실행 provenance를 변조·노출하거나 권한을 재사용하는 것이 주요 위험이다. bridge가 경로/byte/소유와 실제 runtime을 검증하며 renderer는 ID로만 읽는다. HTML/SVG 비실행, 민감 경로 제외, 다른 P/runtime/cwd·중복·손상 거부를 검사했다. 기본 sandbox·네트워크 차단·pending 승인 subset·Team 스케줄링·일반 대화/토큰 저장은 유지한다. 새 서비스·유료 API·배포·의존성은 없다. 자기 검토이며 독립 보안 감사는 아니다.

SQLite user_version=4로 artifact_manifests를 추가한다. v3에서 이전하기 전에 `VACUUM INTO atelier-v3-backup-UUID.sqlite`로 일관된 DB 사본을 만든다. 기존 v1/v2 사본과 files·history·원본 Atelier DB를 보존한다. 수집 중 재시작은 interrupted이며 현재 workspace를 과거 산출물로 자동 재수집하지 않는다. 이미 커밋한 부분 사본은 hash 검증 후 열람할 수 있지만 자동 결과/검사 통과를 생성하지 않는다. orphan/journal 복구는 내부 사본 경로로 제한하고 사용자 산출물은 삭제하지 않는다.

기존 수동 프로젝트의 atelier-backup v1/ZIP/import는 유지한다. **runtime 결과가 있는 프로젝트는 legacy JSON export를 명시적으로 거부한다.** 새 실행 ID가 담긴 legacy import도 거부한다. 실행 연결·여러 사본을 조용히 누락한 성공 백업을 만들지 않는다. 통합 AI 백업 포맷과 새 P로 ID 재매핑 복원은 아직 제안이며 구현되지 않았다.

현재 전체 보관/복구: 실행과 전송을 끝내고 bridge를 완전히 종료한 뒤 `.local-data/atelier` 전체(DB+files+artifacts 및 남은 SQLite 부속 파일)를 일관된 세트로 보관한다. `.local-data/history.json`과 사용자 workspace/staging은 별도 보관 대상이다. 동일한 지원 버전으로 종료 상태에서 세트 전체를 복구하고 파일 hash·과거 결과·일반 대화를 확인한다. 다른 시점의 DB/파일을 혼합하거나 자동 downgrade하지 않는다. v3 앱으로 돌아갈 때는 v3 DB 사본과 그 시점의 원본 파일 세트를 사용하고 이후 기록은 별도 보관한다. 마이그레이션 DB 사본 하나는 전체 byte 백업이 아니다. fixture의 재시작·v3 사본 일관성은 검증했지만 사용자 실제 데이터의 파괴적 복원은 실행하지 않았다.

## 검증 근거와 한계

- 최종 `npm run typecheck`와 `npm run build` 통과(빌드 내부 타입 검사 포함), `npm test` 29개 파일/184개 통과. `npm --prefix atelier/atelier run check` 14개 모듈, `npm --prefix atelier/atelier test` 53개 통과. Windows/Node 22.18.0의 최종 미커밋 코드 기준이며 설치·배포·의존성 변경 없음. SQLite experimental 경고가 있다.
- `node tools/verify-atelier-generation.mjs`, `verify-atelier-storage.mjs`, `verify-atelier-proposals.mjs`, `verify-conversation-restart.mjs` 통과. 각각 기존 스케줄링/승인/중단/잠금·legacy byte/ZIP/백업/Origin/Host/재시작·readOnly 제안/오래된 적용/모델 오류·대화/토큰/승인 복구를 확인한다. Windows sandbox의 임시 파일 rename/loopback 제약 때문에 해당 로컬 검사만 승인된 외부 sandbox 실행을 사용했으며 제품 sandbox는 변경하지 않았다.
- [합성 WS 근거](STAGE7_WS_EVIDENCE.json): 실제 로컬 SQLite·worker·chunk byte, HTML 텍스트/PNG, 원본 snapshot, 자동 결과 불변·멱등, 직접 동작 근거, AI 의견 분리, 수정 round trip/초기화/회귀, 실패 검사·검사 후 변경·누락·차단·중단·승인 거부·Team·재시작. 합성 item/종료 코드는 실제 모델 검사와 구분한다.
- [실제 모델 근거](STAGE7_LIVE_EVIDENCE.json): CLI 0.166.0/GPT-6.1 Sol, `.cache`의 합성 단일 HTML 생성·수정, 실제 fileChange/byte/hash·원본 snapshot/result·같은 Solo thread와 다른 turn·과거 사본·새 미판정 검토 확인. 이 스모크의 검사는 notRun, 시각·동작 판정은 미완료다. [최초 시도](STAGE7_LIVE_FIRST_ATTEMPT.json)는 생성·수정 후 미판정 부모에 regression을 요구한 smoke assertion에서 실패했다. 판정 없는 부모의 검토 초기화·보존을 검사하도록 수정했다. 제품 assertion/검토 완료 조건은 완화하지 않았고 합성 검사는 이전 match의 회귀를 별도로 확인한다.
- 실제 브라우저: HTML의 공격 문자열을 텍스트로 열었을 때 부모 global/iframe/외부 요청 없음, valid PNG Blob 표시. 1440/768/390px 가로 넘침 없음, 키보드 Enter 미리보기, reduced-motion 환경·검토 진입 확인. [1440](stage7-ui-1440.png), [768](stage7-ui-768.png), [390](stage7-ui-390.png). 합성 화면이며 사용자 결과 품질 검증은 아니다.
- 미검증: Node 22.13.0 정확한 하한 실행, macOS/Linux 실환경, 실제 Team 모델 왕복(합성 Team은 통과), 대형 실제 프로젝트의 성능, 완전한 접근성·사용자 연구, 사용자 실제 백업 파괴적 복원. 자동 실행 미리보기/자동 AI 검토/통합 AI 백업은 지원하지 않는다.

실패 경로 단위 검사에는 삭제 보고와 실제 파일 불일치·소실 workspace·hardlink·foreign cwd·메타데이터 상한·active SVG/잘못된 PNG·사본 손상·collecting 도중 종료/journal 복구를 포함한다. 마지막 검사에서 부분 사본은 workspace 후속 변경과 무관하게 유지되고 결과·검사 완료로 승격되지 않았다. 최종 diff는 입력→실제 runtime→경로→사본→원본 결과→사용자 검토 순서로 자기 검토하고 `git diff --check`를 확인했다. 원본 Atelier 소스와 package/lock/AGENTS에는 이번 변경이 없다.

8단계의 기본 화면 전환·전체 기능 수용표 완료·운영 문서 일괄 반영은 이번 범위가 아니다. 다음 단계는 위 미검증과 통합 가이드의 전체 회귀 조건을 확인하고, 미지원 기능을 완료로 표시하지 않는 것이다. 외부 실행 승인 대기는 없다.
