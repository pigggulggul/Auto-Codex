# 8단계 — 공통 작업실 최종 회귀와 운영 계약

2026-10-30, Windows/Node 22.18.0. 시작 브랜치 `main`, HEAD `ced016939fc2a04864132454a3b55e5aa464a933`. 루트 AGENTS.md와 대상 하위 AGENTS/override 유무를 확인했다(하위 없음). 기존 미커밋 6/7단계 변경을 보존하고 커밋·stash·reset·원본 폴더/기록/사용자 코드 삭제를 수행하지 않았다. 새 의존성·외부 서비스·유료 API·배포는 없다.

## 요청한 개선과 실제 소스 차이

- 대화 이름: 첫 요청의 의미 있는 첫 줄을 기본 제목으로 사용하고, 사용자가 1~80자의 이름을 저장/재작성할 수 있게 했다. AI 요약 호출은 없다. 직접 저장한 titleSource=user는 후속 요청이 덮어쓰지 않는다. 첫 요청으로 이름 만들기는 편집 초안만 채운다. 이름은 홈/선택기/결과에서 동일하다.
- `conversation.rename`은 실제 ID·허용 필드·길이·expectedTitle을 검사하고 디스크 저장 후에만 상관된 result를 보낸다. 저장 전 제목을 공개하지 않고, 자동 저장/종료 저장과 직렬화한다. 없는 ID·다른 창의 변경·저장 실패는 성공으로 표시하지 않는다. history v1의 title과 선택적 titleSource만 추가하여 기존 대화·thread·본문을 보존한다.
- 홈의 atelier-home-hero는 일반 작업 시작 버튼만 남겼다. 장식 문구/이미지와 우측 AtelierNotes 컴포넌트를 제거했다. 연결·실행·토큰·승인 상태는 기존 상단/전역 승인/활동 경로를 유지한다.
- **이미 구현된 기본값:** App.tsx는 이 작업 전부터 명시적 legacy 선호가 없으면 Atelier였다. 8단계는 별도 앱을 추가하거나 같은 기본값을 새 전환이라고 만들지 않고, 현재 기본 화면과 호환 경로를 검증했다. 기존 화면은 단계적 이식 중 복귀용으로 남긴 같은 브리지의 다른 배치다. 명시적 선호와 현재 초안/대화/실행을 보존한다. 설정에 이 관계를 설명했다.
- README의 편집 UI/제작 준비 중 설명은 현재 7단계 소스와 달랐다. README·ARCHITECTURE·OPERATIONS를 실제 단일 브리지/SQLite v4/실행·백업 한계로 갱신했다. 목표와 현재 계약의 세부 차이는 CONTRACTS 및 6/7단계 기록을 유지한다.

## 최종 검증과 실패 이력

주요 변경 파일:

| 영역 | 파일 |
|---|---|
| 이름·대화 저장/메시지 | shared/conversation-title.ts 및 test, shared/protocol.ts, server/client-message.ts 및 test, conversation-store.ts 및 test, server/index.ts, src/hooks/useBridge.ts, src/components/ConversationPicker.tsx |
| 홈·기본/호환 UI | src/App.tsx, components/layout/AtelierPages.tsx 및 test, styles.css, styles/atelier-shell.css |
| 경계·회귀 도구 | tools/verify-conversation-restart.mjs, verify-atelier-assets.mjs, verify-atelier-domain.mjs, verify-atelier-stage8.mjs, serve-stage8-offline-ui.mjs; artifact fixture UI 포트 4888 분리 |
| 문서·증거 | README, ARCHITECTURE, OPERATIONS, 통합 가이드/계약/보존표, 이 문서, STAGE8_* 기록과 stage8 UI PNG |

`npm run typecheck`, `npm test`(30개 파일/188개), `npm run build`, 원본 `npm --prefix atelier/atelier run check`(14개 모듈), `npm --prefix atelier/atelier test`(53개)를 실행했다. 최종 결과와 전체 회귀의 리비전 지문은 [회귀 기록](STAGE8_REGRESSION_EVIDENCE.json)에 있다. SQLite experimental 경고는 유지한다. Windows sandbox의 임시 파일 rename/loopback 제약으로 필요한 로컬 검사만 승인된 외부 sandbox 실행을 사용했으며 제품 sandbox·권한은 완화하지 않았다.

빌드 후 `node tools/verify-atelier-stage8.mjs`는 서로 다른 loopback 포트의 합성 fixture 8종을 제한된 병렬성으로 실행하고 명령별 종료 코드·로그 hash·현재 주요 소스 hash를 기록한다. 모델/실제 사용자 데이터는 사용하지 않는다. 7단계의 [실제 GPT-6.1 Sol 제작·수정 기록](STAGE7_LIVE_EVIDENCE.json)은 보존하되 이번 단계의 새 실제 모델 실행으로 표시하지 않는다.

발견·해결한 실패:

1. 최초 타입 검사에서 새 shared 테스트의 NodeNext import 확장자가 누락됐다. `.js` 확장자를 수정했고 assertion/검사를 생략하지 않았다.
2. 과거 2단계 원본 지문과 현재 파일이 달라 보존 검사가 실패했다([최초 회귀 기록](STAGE8_REGRESSION_FIRST_ATTEMPT.json)). 줄바꿈만으로 설명되지 않는 파일도 있었다. 현재 원본 16개는 Git HEAD와 LF 정규화 시 모두 일치하고 원본의 작업 트리 diff는 없다. 과거 지문과 원본은 바꾸지 않고 [현재 기준선](STAGE8_SOURCE_MANIFEST.json)을 별도로 기록했다. 원래 검사에 명시적 `--manifest docs/atelier/STAGE8_SOURCE_MANIFEST.json` 선택을 추가해 이 기준선의 SHA-256을 검사한다. 내용 변경을 허용하는 wildcard나 assertion 제거가 아니다. 과거 지문의 작성/내용 차이 원인을 임의 추정하지 않는다. 기본 2단계 지문 검사는 역사적 리비전용이며 현재 회귀에서는 명시적 8단계 지문을 사용한다.
3. 정적 파일은 문자열 경로만 검사해 dist 내부 junction이 외부 파일을 가리켜도 200을 반환했다. 격리된 합성 private 파일로 거부 테스트가 먼저 실패했고, 실제 dist/파일 경로를 읽기 전후 확인하도록 수정 후 403으로 차단됐다. 정상 로컬 서체·아이콘·라이선스의 MIME/byte는 유지됐다. 생성 산출물은 여전히 정적 서버에 복사하지 않는다.
4. 브라우저 검사에서 초기 렌더 전에 버튼 수를 계산하거나 정확하지 않은 접근성 이름을 사용한 테스트 선택자가 시간 초과했다. 실제 DOM의 접근성 이름/상태를 기다리도록 바꿔 재검증했다. 제품 검사를 건너뛰거나 완료 상태를 변경하지 않았다.

## 통합 수용 기준 16항목

아래 통과는 명시된 코드·fixture·실제 브라우저 범위다. 실제 모델/실환경/사용자 연구 한계는 별도다.

| # | 수용 기준 | 현재 근거 |
|---|---|---|
| 1 | 일반 작업을 설계 없이 Team/Solo로 실행 | generation/restart WS의 기존 turn.start 양 모드; 실제 UI의 일반 Solo 실행과 저장된 결과 |
| 2 | 폴더·신뢰·스킬·모델·effort·조사·네트워크 보존 | 경로/소실/junction·trust/router/client-message/model-selection 단위 검사; generation/restart의 실제 정책; UI 설정 진입. OS 폴더창 자체는 미검증 |
| 3 | 픽셀·캐릭터·활동·긴 결과·토큰·중단·승인 접근 | 원래 world/sprite/rendering/operations/token 단위 검사; UI 픽셀/활동/결과/설정 진입·긴 본문 스크롤/Esc 복귀·모바일 승인 focus/거부; generation 중단 |
| 4 | 기존 기록·결과 재시작/형식 호환 | history v1 기존 fixture+선택 titleSource, Solo resume·Team interrupted·승인 만료·새 이름 저장 후 재시작; storage/artifact 재시작 |
| 5 | Atelier 수동 설계·원본·ZIP·백업·검토 왕복 | 현재 원본/도메인 16개 지문·순수 도메인/원본 53개; 실제 byte/ZIP/새 P 복원·부분 전송·검토/계획 WS; 수동 네 시작점·8탭 UI |
| 6 | Atelier 기본·한글·1440/768/390·키보드·동작 축소 | 실제 home/work 화면과 넘침 검사, 메뉴 Esc/focus 복귀, native 승인 focus trap, reduced-motion; 원래 기본값/호환 레이아웃의 초안 유지 |
| 7 | CLI 실패 상태의 수동 설계와 실제 오류 | missing-cli storage fixture 및 4889 실제 UI: 오류 배너, 수동 새 설계 저장, AI 버튼 비활성 |
| 8 | AI 제안과 확정 분리·오래된 제안 거부 | proposal fixture의 invalid/model failure/policy denied/stale apply/양방향 잠금/중단; 도메인 적용·검증. 자동 확정 없음 |
| 9 | 고정 입력·실제 산출물·원래 검토 연결 | InputManifest·실제 runtime/byte/hash, original snapshot/result, 사본 손상·다른 P/runtime/cwd 거부; 실제 모델 검증은 7단계 이력 |
| 10 | 중복·다중 창·쓰기 충돌 방지 | generation fixture의 durable key·충돌·재연결·일반/제안 admission·여러 창·쓰기 독점/읽기 병렬 검사 |
| 11 | pending 승인·subset·재전송/복원 거부 | approval-response/runtime-registry, generation/restart의 거부/만료·목적별 policy; UI에서 Escape는 승인으로 처리하지 않음 |
| 12 | 생성물/첨부의 부모 권한 실행 방지 | HTML/SVG 텍스트, invalid PNG 거부, raster Blob, React Markdown 경계; 7단계 HTML 공격 문자열의 부모 global/외부 요청 없음; 정적 junction 403 |
| 13 | 실행/파일/검사/검토와 실패·부분 상태 분리 | artifact fixture의 누락/실패/late write/중단/관측 없는 검사, collecting crash의 부분 사본 read-only 복구; status 네 축 유지 |
| 14 | 계획→새 snapshot→수정 제작→재검토 | artifact WS와 도메인의 원래 범위·confirmed plan·새 result·parent review·판정 초기화·이전 match 회귀/보존 |
| 15 | 타입·단위·빌드·관련 회귀 | typecheck/build, root 188, 원본 53/14, stage8 8종 종료 코드와 소스/로그 지문 |
| 16 | 지원 환경·가져오기·백업·복구·제한 문서화 | README/ARCHITECTURE/OPERATIONS, CONTRACTS, 이 문서와 7단계 실제 계약; legacy 손실 방지·full stopped-set 복구·미지원 AI 백업 명시 |

## 기능 보존표 A01~A20 / T01~T20

기존 FEATURE_PRESERVATION의 초기 표는 역사적 근거이며 아래가 현재 검증 연결이다. 원본 컴포넌트·메시지 경로는 유지한다.

| 보존 ID | 현재 진입점/메시지 | 이번 근거와 제한 |
|---|---|---|
| A01/A02/A03 | 공통 ProjectPanel; project.select/pick/trust, workspace.mode/network | 기존 경로/trust/client 검사·WS 실제 sandbox/소실·UI 설정; 물리적 폴더창/외부 웹 조사 미실행 |
| A04/A05/A20 | ConversationPicker/Home/ResultView; conversation.new/select/rename; history v1 | 새 이름·stale/없는 ID/저장 실패/기본 라벨 이름 보존·재시작·thread resume·손상/junction 거부 |
| A06/A07 | 기존 ModelPicker/SkillPicker; model/skills refresh, turn.start | 실제 카탈로그와 제공된 6시리즈 우선·effort 검증·기본 에이전트/결정적 라우터; 새 실제 모델 호출 없음 |
| A08/A09/A10/A11 | 일반 작업/Generation→기존 startTurn/planner/orchestration | Team/Solo·최대 task·DAG·read 병렬/write/QA 독점·실패/차단/정리 보고·공통 잠금 |
| A12/A13/A14/A18 | 전역 중단/승인, Activity/Operations, token usage | 실제 fixture item/turn·승인 ID/subset·중단·늦은 ID 차단·토큰 단위/WS·모바일 승인 focus |
| A15/A16/A17/A19 | 픽셀/캐릭터·ResultText·오류 배너/재연결 | 자산 hash·world/sprite/operations/Markdown tests, UI 진입/긴 본문/복귀·missing CLI. 전체 캐릭터 선택의 모든 조합 수동 검사는 아님 |
| T01/T02/T03/T04 | Home 네 시작점, 가이드/상세, Project/Questions/Entity | 실제 네 P 생성·각 초기 탭·8탭·원본 입력/초안·상태/출처/영향 규칙 검사 |
| T05/T06 | flow/screens/graph·의존성·recheck | 순수 포팅/원본 도메인·shared extension의 분기/복구/DAG/순환·영향·이전 판정 보존 |
| T07/T08/T09/T10 | References/지역/크롭, concepts, styles/assets/FontFace | 실제 byte 형식/소유/크롭/서체/범위·원본 및 파일 WS, tabs UI. 모든 이미지 드래그/서체 조합의 수동 UX는 미검증 |
| T11/T12/T13 | Brief→selection→immutable snapshot/Generation | 사용자 의도·근거와 제작 대상 분리·결정 추적/hash·old snapshot 불변·공통 제작 sandbox |
| T14/T15/T19 | transfer/bundle/backup, store/worker | 실제 ZIP/byte 왕복·새 P 복원·버전 충돌·종료/만료·Origin/Host/rate·DB/hash/journal·재시작 |
| T16/T17/T18 | 수동 RegisterResult와 자동 Artifacts→Review→Plan | 기존 수동 이미지/행동 근거·시각/행동 판정·별도 AI 의견·자동 source 불변·revision/회귀·새 판정 초기화 |
| T20 | 설정·공통 기본값·명시적 프로젝트 삭제 | WS 설정/삭제·진행 중 삭제 거부·확인 대상·정확한 내부 파일 정리; 사용자 workspace/history/원본 자동 삭제 없음 |

## UI 확인 자료

합성 사용자·파일·App Server를 명시적으로 사용했다. 실행 관측 fixture 응답을 실제 AI 결과로 표시하지 않는다. [홈 1440](stage8-home-1440.png), [768](stage8-home-768.png), [390](stage8-home-390.png), [대화 이름](stage8-conversation-1440.png), [일반 작업 390](stage8-work-390.png), [승인 390](stage8-approval-390.png), [CLI 실패](stage8-cli-unavailable.png)를 확인했다.

관측값: 각 홈/모바일 일반 작업 가로 넘침 없음, hero의 유일한 자식은 시작 button, notes DOM 없음. 이름 저장/새로고침 복원과 후속 요청 후 유지. 긴 합성 본문 reader 높이 722px/내용 5612px로 내부 스크롤·Esc 복귀/초점 반환. 메뉴 Esc 초점 복귀, reduced-motion 활성, 승인 첫 초점/Shift-Tab trap·Escape 후 pending 유지/명시적 거부. 네 시작점의 초기 탭은 design/reference/concept/review, 여덟 탭 모두 진입되고 오류 배너 없음. 원본 전체 브라우저 시나리오를 그대로 실행한 것은 아니며 제공 page를 사용한 이번 실제 조작과 단위/WS 근거를 구분한다.

최종 클라이언트 빌드의 [UI 관측 기록](STAGE8_UI_EVIDENCE.json)에는 이름의 HTML 공격 문자열 비실행, 원문 복사/초점 복귀, [실제 파일 미리보기](stage8-artifacts-1440.png)의 HTML 텍스트·외부 요청 없음·실제 PNG와 미완료 사용자 검토도 남겼다. 전체 회귀 뒤 정리한 소스 차이는 AtelierPages.tsx EOF의 빈 CRLF 한 줄뿐이며 원래 hash와 최종 hash를 회귀 JSON의 postRegressionFormatting에 구분했다. 동작 변경은 없고 최종 빌드/타입·diff 검사를 확인했다.

## R2 보안·호환성·복구

보호 대상은 로컬 대화/이름·프로젝트/산출물 byte와 실행/승인 권한이다. 비신뢰 renderer/model/가져오기/경로·ID·재전송이 진입점이다. bridge가 strict 메시지/소유/버전, 실재 경로·hash, 공통 admission, 실제 pending subset을 강제한다. 새 rename은 일반 메타데이터 저장이며 cwd/thread/권한을 받지 않는다. 정적 파일 경계 보강은 dist 밖 실제 대상을 거부하고 기존 byte를 유지한다. 자원 한도·표시의 비실행·실패/중단·재시작·상관 검사를 실제 fixture로 확인했다. 독립 보안 감사나 다중 사용자 서버 인증을 제공한다는 뜻은 아니다.

SQLite는 기존 7단계 v4를 유지하고 추가 이전은 없다. history는 v1을 유지한다. 적용은 기존 실행을 끝내고 bridge를 종료한 다음 빌드/재시작한다. rollback도 먼저 전체 DB+files+artifacts·별도 history/workspace를 보관하고 해당 데이터 버전을 지원하는 앱을 사용한다. legacy JSON이 자동 runtime 결과를 누락한 성공 백업으로 동작하지 않으며, 통합 AI 백업은 여전히 제안이다. 상세 순서는 OPERATIONS를 따른다. 실제 사용자 자료의 파괴적 복구나 공개 배포는 수행하지 않았다. 승인 대기 없음.

## 미검증과 후속 조건

- Node 22.13.0 정확한 하한·다른 Node/OS 조합, 실제 OS 폴더 선택창, 실제 Team 모델 왕복과 대형 프로젝트 부하, 외부 웹 조사, 모든 캐릭터/서체/이미지 드래그 조합.
- 완전한 WCAG/스크린리더·사용자 연구, 실제 사용자 백업의 파괴적 복원. 이번 키보드/모바일 결과를 전체 접근성 인증으로 확대하지 않는다.
- 통합 AI 백업/ID 재매핑, 자동 AI 디자인 판정, 실행형 HTML/SVG 미리보기, 외부 이미지/Figma/호스팅은 미구현이다. 후속 요청이 있을 때 목적·권한·보존 계약과 검증을 별도로 갖춘다.

현재 Windows 로컬 기능/경계 검증을 기준으로 Atelier 공통 셸을 기본 사용하며 기존 레이아웃·픽셀·결과·활동 접근을 유지한다. 미검증 환경을 지원 완료나 배포 완료로 표시하지 않는다.
