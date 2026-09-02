# Auto Codex Agent Town

Codex Local 작업을 역할별 에이전트에게 자동 분배하고, 픽셀 아트 사무실에서 실행 상태를 보여주는 로컬 웹 앱입니다. Node Bridge가 `codex app-server`와 JSONL로 통신하면서 실제 thread, turn, 도구, 파일 변경, 명령 실행, 승인 요청만 화면 상태로 변환합니다.

## 현재 범위

- localhost 전용 React/Vite UI
- `codex app-server` 자동 실행 및 재연결
- 로컬 프로젝트 경로 선택
- 프로젝트 스킬 조회 및 수동/자동 라우팅
- Coordinator의 요청 분해와 역할·의존성·실행순서 결정
- 독립적인 읽기 작업 최대 3개 병렬 실행
- 같은 작업공간을 건드리는 쓰기·검증 작업 단독 실행
- 작업별 독립 App Server thread/turn과 이벤트·응답·승인 상관관계
- 성공·실패·차단 결과 수집, 검증, 최종 Coordinator 보고
- Team Auto 픽셀 사무실과 Solo 단일 에이전트 모드
- 명령·파일·추가 권한 승인/거부

Supabase, 원격 데이터베이스, 사용자 계정, 클라우드 배포는 사용하지 않습니다.

## 스킬과 캐릭터

Manual 모드는 프로젝트의 `.agents/skills`에 있는 스킬을 기본 목록으로 보여줍니다. 프로젝트 스킬이 없거나 Codex의 전역·시스템 스킬까지 선택하려면 `Codex 스킬 전체 보기 <`를 누릅니다.

Team Auto는 먼저 `Coordinator`가 요청을 구체적인 Task로 나눕니다. 각 Task는 `Builder`, `Researcher`, `Documenter`, `Visual Designer`, `QA Inspector`, `Integrator` 역할 중 하나에 배정됩니다. 역할에 맞는 전용 Skill이 있으면 해당 Task에만 붙이고, 없으면 일반 Codex 에이전트가 역할 지시를 수행합니다. Pixel은 이 실행 구조의 명칭이 아니라 Cyworld·ZEP처럼 보이는 화면 테마입니다.

계획은 Bridge에서 다시 검증합니다. 알 수 없는 의존성, 순환 의존성, 8개 초과 작업은 거부하며 Coordinator 계획을 사용할 수 없으면 안전한 기본 계획으로 전환합니다. 읽기 전용 Task끼리만 병렬로 시작하고, `workspaceWrite` Task는 다른 작업과 겹치지 않습니다. 변경 작업 뒤에는 QA 검증을 추가하고, 일부 작업이 실패해도 최종 보고 Task는 모든 작업이 끝난 뒤 실행됩니다.

Manual에서 지정한 캐릭터는 선택한 프로젝트 경로별로 브라우저 로컬 저장소에 보관됩니다. 현재 캐릭터 화면은 CSS 펫을 사용하며, 실제 codex-pet 스프라이트는 [docs/PET_SPRITES.md](docs/PET_SPRITES.md)의 규격에 맞춰 나중에 연결할 수 있습니다.

## 실행

필수 조건:

- Node.js 20 이상
- Codex CLI가 PATH에 설치되어 있고 로그인되어 있어야 함
- `codex app-server`를 지원하는 Codex CLI 버전

가장 간단한 실행 방법은 프로젝트 폴더의 `START_AUTO_CODEX.cmd`를 더블클릭하는 것입니다. 빌드와 로컬 브리지를 시작한 뒤 기본 브라우저로 대시보드를 엽니다. Auto Codex를 사용하는 동안 함께 열린 터미널 창을 닫지 마세요.

PowerShell에서 직접 실행하려면:

```powershell
Set-Location 'C:\Users\user01\Desktop\Claude\Auto-Codex'
& '.\START_AUTO_CODEX.cmd'
```

런처는 시작할 때 전용 로컬 포트 `4780`/`4781`의 이전 프로세스를 정리한 뒤
새 브리지와 대시보드를 연결합니다. 따라서 이전 실행이 남아 있어도 오래된
서버가 재사용되지 않습니다.

개발 모드:

```powershell
npm install
npm run dev
```

브라우저에서 [http://127.0.0.1:4780](http://127.0.0.1:4780)을 엽니다. 브리지는 `127.0.0.1:4781`에서만 수신합니다.

프로덕션 빌드 실행:

```powershell
npm run build
npm start
```

이 경우 UI와 브리지를 [http://127.0.0.1:4781](http://127.0.0.1:4781)에서 함께 제공합니다.

## 프로젝트 폴더 선택

- `폴더 선택…`은 로컬 브리지가 Windows 폴더 선택창을 엽니다.
- `경로 열기`는 `C:\Users\...` 형태의 경로를 직접 입력할 때 사용합니다.
- 화면에 `bridge offline`이 보이면 웹페이지만 열려 있고 로컬 브리지가 꺼진 상태입니다. `START_AUTO_CODEX.cmd`로 다시 실행하세요.

`spawn codex ENOENT` 오류는 Windows의 npm 설치가 `codex.cmd`로 제공될 때 발생할 수 있습니다. 브리지는 Windows 명령 처리기를 통해 해당 shim을 실행합니다. 수정 후에는 실행 중인 Auto Codex 터미널을 종료하고 런처를 다시 실행해야 새 브리지 코드가 적용됩니다.

브라우저 보안상 일반 웹페이지는 선택한 폴더의 Windows 절대경로를 직접 얻을 수 없습니다. 따라서 폴더 대화상자는 브리지 서버가 띄웁니다.

## PET_SPRITES.md란?

`docs/PET_SPRITES.md`는 코드가 아니라 캐릭터 이미지 교체 규격 문서입니다. 현재 CSS 임시 펫을 실제 codex-pet 스프라이트로 바꿀 때 이미지 위치, 애니메이션 상태 이름, 반복 여부 등을 맞추기 위해 사용합니다. 현재 버전 실행에는 별도 스프라이트 파일이 필요하지 않습니다.

검증:

```powershell
npm run typecheck
npm test
npm run build
```

## 보안 경계

- 프런트엔드는 명령 문자열을 직접 실행하지 않습니다.
- 브리지는 Codex App Server가 발급한 승인 요청 ID만 처리합니다.
- 선택한 프로젝트 경로를 workspace root로 사용합니다.
- bridge와 dev server는 `127.0.0.1`에만 바인딩합니다.
- `thread/shellCommand`처럼 샌드박스를 우회하는 API는 사용하지 않습니다.

현재 설치된 Codex CLI가 보내는 명령 실행, 파일 변경, 추가 권한 승인 요청을 지원합니다. 추가 권한 승인 시 브라우저가 권한 내용을 만들지 못하며 App Server가 요청한 권한 집합만 그대로 승인합니다.

개념 학습과 Notion 정리용 문서는 [docs/MULTI_AGENT_GUIDE.md](docs/MULTI_AGENT_GUIDE.md), 자세한 흐름은 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), 운영 방법은 [docs/OPERATIONS.md](docs/OPERATIONS.md)를 참고하세요.
