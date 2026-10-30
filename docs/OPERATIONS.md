# Auto-Codex·Atelier 운영과 검증

기본 화면은 Atelier 공통 작업실이다. 일반 작업·설계·대화/결과·픽셀·활동 센터·전역 승인에 같은 브리지를 사용한다. 기존 레이아웃은 호환/복귀용이며 독립 앱이 아니다. 브라우저의 명시적 레이아웃 선호는 보존하고 신규 기본값은 Atelier다. 홈 장식과 우측 안내를 제거했으며 연결·토큰·실행/승인은 기존 상단·활동/전역 화면에서 확인한다.

지원 조건은 Node 22.13+와 내장 node:sqlite다. check:node를 시작/검사/빌드 전에 실행하며, 이번 실환경은 Windows/Node 22.18.0이다. 최소 22.13.0 및 macOS/Linux 실환경은 미검증이다. AI에는 로그인된 Codex CLI가 필요하며 CLI가 없더라도 수동 설계·저장·파일·검토를 사용할 수 있다. 실제 제공 모델 중 GPT-6 시리즈를 우선하며 계정 거부를 가짜 응답이나 자동 모델 변경으로 숨기지 않는다.

## 실행 모드

- `TEAM AUTO`: 역할 분배, 의존성 스케줄링, 검증, 최종 보고를 사용합니다.
- `SOLO`: 기존처럼 하나의 Codex thread/turn에서 요청 전체를 처리합니다.

## 안전 제한

- Run당 최대 Task 수: 8개
- 동시 read Task: 최대 3개
- 동시 write Task: 1개
- 네트워크: 기본 비활성화
- write root: 선택한 프로젝트 절대경로
- 모든 Task thread: ephemeral
- 지원하지 않는 App Server request: 오류 응답 후 UI 알림

## 실패 처리

- Coordinator output이 JSON이 아니거나 계획 검증에 실패하면 deterministic fallback을 적용합니다.
- 선행 작업이 실패·중단·차단되면 일반 후속 작업은 `blocked`가 됩니다.
- 최종 report Task는 `runAfterFailure` 정책으로 모든 선행 작업이 종료될 때까지 기다린 뒤 실행됩니다.
- report 자체가 실패하면 Bridge가 Task 상태와 오류를 로컬 요약으로 제공합니다.

## 검증 명령

```powershell
npm run typecheck
npm test
npm run build
node tools/verify-conversation-restart.mjs
node tools/verify-atelier-stage8.mjs
```

conversation-restart 명령은 빌드된 브리지와 합성 JSONL App Server를 `.cache/` 아래 격리된
폴더에서 실행합니다. `127.0.0.1:4785`만 사용하며 실제 Codex/model/도구 호출은
없습니다. 프로젝트 전환, 프로세스 종료 후 transcript 복원, `thread/resume`,
진행 중 Team 작업의 중단 복구, 만료 승인 거부와 네트워크 기본 차단을 확인합니다.

conversation-restart는 4785, 전체 stage8 회귀는 해당 검사와 4872/4876/4882/4883/4886의 격리 fixture를 사용한다. UI fixture `node tools/verify-atelier-artifacts.mjs --ui`는 별도 4888이다. 실제 AI 호출은 없고 각 명령이 종료 시 자기 child를 정리한다. `.cache`의 합성 데이터는 사용자 기록과 구분하며 자동 삭제하지 않는다. 원본 검사는 `npm --prefix atelier/atelier run check`, `npm --prefix atelier/atelier test`다. 전체 회귀 기록은 docs/atelier/STAGE8_REGRESSION_EVIDENCE.json에 저장한다.

## 대화와 프로젝트 기록

- 요청·응답 전체, 요청별 Team 작업/결과, 현재 프로젝트와 선택한 대화를
  앱 설치 폴더의 `.local-data/history.json`에 저장합니다. 파일은 Git 및
  정적 웹 리소스 대상에서 제외됩니다. 다른 PC나 서버로 업로드하지 않습니다.
- 스트리밍 중에도 최대 약 200ms 주기로 저장하고 정상 종료 전에는 저장을
  기다립니다. 갑작스러운 강제 종료에서는 마지막 저장 이후의 조각이 누락될 수 있습니다.
- 임시 파일을 동기화한 뒤 순서대로 원자 교체합니다. 저장 형식·파일 크기(64MB)와
  데이터 폴더의 junction/심볼릭 링크 경계를 검증합니다. 저장 실패는 UI 오류로 표시합니다.
- 재실행하면 마지막 대화와 프로젝트를 불러옵니다. 이전 대화 선택 시 해당
  프로젝트로 함께 전환합니다. 프로젝트를 다시 열어도 이전 기록을 삭제하지 않습니다.
- Solo는 저장한 App Server thread ID로 `thread/resume`한 뒤 새 turn을 시작합니다.
  재개 실패는 오류로 표시하고 기존 thread를 새 thread로 몰래 대체하지 않습니다.
  Team의 ephemeral task thread는 재실행하지 않습니다. 이전 요청/응답의 제한된
  맥락과 요청별 결과를 보관해 다음 요청에서 이어갑니다.
- 종료 당시 실행 중이던 항목은 복원 시 `interrupted`로 정리합니다. 도구나 작업을
  자동 재실행하지 않습니다. 승인 요청/승인 결정, 프로젝트 신뢰, 네트워크 허용은
  저장하지 않습니다. 신뢰는 기존 설정을 다시 확인하고 네트워크는 다시 꺼집니다.
- 읽을 수 없거나 손상된 기록은 덮어쓰지 않습니다. 앱 종료 후 파일을 별도로
  보관하고 마지막 정상 백업으로 복원하거나 새 기록 파일을 시작하세요.

대화 이름은 일반 작업의 `대화 이름 저장`으로 편집한다(1~80자). 첫 요청의 의미 있는 첫 줄을 기본값으로 쓰며 AI 요약은 호출하지 않는다. 직접 저장한 이름은 이후 요청이 바꾸지 않는다. 이름은 history v1의 기존 title과 선택적 titleSource에 저장한다. 다른 창의 예상 이름 불일치·없는 대화·저장 실패는 성공으로 응답하지 않는다. 저장 성공을 받은 뒤 새로고침/재시작과 대화 선택에서 같은 이름을 확인할 수 있다. 연결이 끊겨 응답이 불명확하면 자동 재전송하지 말고 최신 이름을 확인한다.

## Atelier 저장·백업·복구

- 통합 설계는 `.local-data/atelier/atelier.sqlite`(user_version=4), 첨부 `files/`, 실제 산출물 사본 `artifacts/`에 저장한다. history.json v1, 원본 `atelier/atelier/data`, 사용자 workspace는 별도이며 자동 이전·삭제하지 않는다.
- SQLite 1/2/3에서 이전할 때 해당 버전의 일관된 VACUUM INTO 사본을 먼저 만든다. 더 높은 버전은 수정하지 않는다. WAL DB 본체만 임의 복사하거나 이전 앱으로 자동 downgrade하지 않는다.
- 수동 atelier-backup v1 JSON/ZIP은 기존 방식으로 준비·장치 저장한다. JSON 전체 90MiB·파일당 15MiB 한도를 지킨다. 손상/해시/참조/교차 프로젝트를 검사하고 가져오기는 새 프로젝트를 만든다. handoff ZIP은 복원용 백업이 아니다.
- 자동 runtime 결과가 포함된 프로젝트는 구형 JSON 백업을 명시적으로 거부한다. 실행/여러 산출물 기록이 없는 성공 백업을 만들지 않는다. 통합 AI 백업·ID 재매핑 복원은 아직 미지원이다.

전체 보관 순서:

1. 실행·승인·전송을 정리하고 bridge를 완전히 종료한다. 원본 Atelier 서버를 별도로 실행 중이면 그 데이터도 별도 종료/보관 대상으로 다룬다.
2. `.local-data/atelier` 전체(DB·있다면 WAL/SHM/journal·files·artifacts)를 같은 시점의 세트로 보관한다. `.local-data/history.json`과 사용자 workspace·`.auto-codex/atelier-inputs`는 별도 보관한다. OS/조직의 보호된 로컬 백업 위치를 사용하며 공개 저장소에 넣지 않는다.
3. 복원은 bridge 종료 상태에서 현재 자료도 별도 보관한 후, 같은 지원 앱 버전과 한 세트를 사용한다. 다른 시점의 DB/byte를 혼합하지 않는다. history를 설계 백업으로 덮어쓰지 않는다.
4. 시작 후 기존 P/snapshot/result 관계, 첨부/산출물 hash, 일반 대화·이름을 확인한다. 진행 중 상태는 interrupted이며 승인·trust·네트워크 권한을 복원하거나 실행을 재전송하지 않는다.
5. 이전 v3 앱으로 복귀하려면 v3 DB 사본과 그 시점의 파일 세트를 사용하고 이후 v4 기록/byte는 따로 보관한다. 마이그레이션 DB 사본만으로 전체 데이터가 복원된다고 보장하지 않는다. 사용자 코드 변경은 별도 버전/백업으로 관리한다.

실제 사용자 데이터의 파괴적 복원은 실행하지 않았다. fixture에서 v3 사본 일관성·journal·수집 중 종료·손상 사본·대화 재시작을 검증한다. 재시작 도중 수집이 중단된 경우 이미 커밋한 사본만 hash 확인 후 읽고, 현재 workspace를 옛 실행의 산출물로 재수집하지 않는다.

## 실제 완료 상태와 제한

프롬프트 고정은 제작 완료가 아니며 실행 종료도 파일/검사/디자인 일치를 보장하지 않는다. fileChange로 관측된 경로만 최종 실제 byte로 수집하며 미관측 도구 파일은 자동 확인하지 않는다. 관측된 정확한 npm 검사 명령의 cwd·종료 코드·대상 hash 연결만 검사 상태로 표시하고 원문 stdout/stderr는 manifest에 보관하지 않는다. 실제 이미지와 코드 텍스트만 미리보기로 제공하며 생성 HTML/SVG/스크립트는 부모 앱에서 실행하지 않는다.

시각/동작 판정은 원래 snapshot 기준의 사용자 관찰·근거로 완료한다. 명령 종료 코드는 직접 동작 근거가 아니고 AI/외부 의견은 별도 의견란이다. 수정 계획 확인→새 revision snapshot→새 generation/result→새 검토를 사용하며 이전 판정을 복제하지 않는다. [7단계 한도](atelier/STAGE7_IMPLEMENTATION.md)와 [8단계 수용 기록](atelier/STAGE8_ACCEPTANCE.md)의 미검증 항목을 따른다. 외부 서비스·이미지 생성 API·자동 배포·실행형 웹 미리보기는 추가하지 않는다.

범위/위험도는 R2입니다. 보호 대상은 로컬 대화/프로젝트 경로와 실행 권한이며,
브라우저에서 조작된 경로·승인 ID·복원 상태가 경계 입력입니다. cwd는 실행 전에
다시 검증하고 승인은 현재 프로세스의 pending 요청과만 상관시킵니다. 저장 기록은
실행 권한으로 사용하지 않습니다. 서버 스키마/경로 거부 테스트와 격리된 재시작
검증으로 확인합니다. 8단계는 배포나 추가 SQLite 이전 없이 v4와 history v1을 유지합니다.
되돌릴 때는 아래 전체 세트 보관 절차와 데이터 버전을 지원하는 앱을 사용하세요.
낮은 SQLite 스키마를 기대하는 앱으로 새 DB를 자동 downgrade하지 않습니다.

시스템 npm shim이 손상된 개발 환경에서는 저장소의 로컬 실행 파일로 같은 검사를 수행할 수 있습니다.

```powershell
.\node_modules\.bin\tsc.cmd --noEmit
.\node_modules\.bin\tsc.cmd --noEmit -p tsconfig.node.json
.\node_modules\.bin\vitest.cmd --run
.\node_modules\.bin\vite.cmd build
.\node_modules\.bin\tsc.cmd -p tsconfig.server-build.json
```

## 수동 스모크 테스트

결과 화면은 요청·최근 응답·작업별 결과를 마크다운으로 표시합니다. 각 카드의
`전체 보기`를 누르면 뷰포트에 맞는 읽기 창이 열립니다. 본문을 끝까지 스크롤하고
`마크다운 보기`/`원문 보기`로 전환하거나 원문을 복사할 수 있습니다. Esc 또는
닫기로 복귀하며 키보드 초점은 열기 버튼으로 돌아갑니다. 카드 목록은 본문 높이를
압축하지 않는 블록 흐름이며, 긴 본문만 카드 안에서 스크롤됩니다.

표시 경계: 저장된 대화와 모델 응답은 비신뢰 텍스트로 유지합니다. 제목·목록·표·
인용·코드·강조·HTTP(S) 링크를 React 노드로 렌더링하며 원시 HTML을 삽입하지
않습니다. 실행 가능한 URL 스킴과 자동 이미지 로딩을 허용하지 않습니다.
읽기 뷰는 원문이나 실행 권한을 변경하지 않으며 재빌드/재실행으로 적용합니다.
현재 대화 이름 API·설계 저장 계약은 위의 실제 계약을 따르고, 레이아웃을 바꿔도 저장한 원문은 유지됩니다.

읽기 창 검증은 긴 합성 대화와 여러 작업 결과로 수행합니다. 캐릭터의 대기 → 작업석
→ 공용 공간 복귀는 가짜 App Server 알림으로 검사하며 실제 모델/도구를 실행하지 않습니다.

1. 프로젝트 폴더를 선택하고 필요하면 신뢰합니다.
2. Team Auto에서 작은 읽기 요청을 실행합니다.
3. 작업 보드에 plan → research → report가 표시되는지 확인합니다.
4. 서로 독립적인 read Task가 동시에 `running`이 될 수 있는지 확인합니다.
5. write Task 실행 중 다른 Task가 실행되지 않는지 확인합니다.
6. 승인 대화상자에 Task ID와 원본 명령·경로·권한이 표시되는지 확인합니다.
7. 작업 완료 후 QA와 Coordinator 보고가 표시되는지 확인합니다.
8. Activity feed의 수정·명령 상태가 실제 이벤트가 있을 때만 나타나는지 확인합니다.
