# Atelier 통합 1단계 — 공통 셸 구현과 검증

2026-10-29, Windows / Node v22.20.0. 범위·위험도: **R1 UI 확장**. Atelier 디자인 기반 셸과 기존 기능의 진입점을 구현했다. 설계 도메인·SQLite·AI 어댑터는 아직 연결하지 않았다.

## 구현한 내용

| 변경 | 파일·동작 |
|---|---|
| 공통 탐색·모바일 메뉴 | [AtelierNavigation.tsx](../../src/components/layout/AtelierNavigation.tsx): 홈·일반 작업·대화/결과·활동·픽셀·설정. 여덟 디자인 편집 메뉴는 disabled와 준비 상태로 표시 |
| 홈·준비 상태·우측 안내 | [AtelierPages.tsx](../../src/components/layout/AtelierPages.tsx): 실제 대화 요약, Codex 작업 시작 진입점, 생성 기능이 없는 디자인 준비 안내, 실제 연결·작업 상태 |
| 기존 기능 연결 | [App.tsx](../../src/App.tsx): 기존 useBridge·실행 함수·컴포넌트 연결을 유지하고 페이지·셸 표시 상태만 추가 |
| 스타일 | [토큰](../../src/styles/atelier-tokens.css), [셸 스타일](../../src/styles/atelier-shell.css): 흰 배경·회색 본문·핑크 강조, 로컬 Instrument 서체, 좌측 탐색·중앙 작업·접을 수 있는 안내 |
| 로컬 에셋·라이선스 | public/atelier-assets/: 원본의 13개 SVG·2개 WOFF2·2개 OFL·라이선스 문서, 총 18개. 모두 원본과 SHA-256 일치 |
| 정적 파일 제공 | server/index.ts의 contentType에 font/woff2·font/woff·text/plain만 추가. 새 API·WS 메시지·실행 권한 변경 없음 |
| 승인 키보드 동작 | [ApprovalDialog.tsx](../../src/components/ApprovalDialog.tsx): native dialog, 첫 초점 거절, Tab/Shift+Tab 순환, 결정 후 초점 복귀, Esc로 결정/닫기 금지 |
| 경계 회귀 | [AtelierPages.test.tsx](../../src/components/layout/AtelierPages.test.tsx): 준비 메뉴·실제 대화 escaping·실행 중 대화 전환 차단·제안된 편집기의 비활성 상태·상태 구분 |

기본 셸은 Atelier다. 사이드바/설정에서 **기존 화면으로 전환**, 기존 화면 상단에서 **Atelier 화면으로 돌아가기**를 제공한다. 선택은 `auto-codex.shell`이라는 UI 전용 localStorage 키에 보관한다. 기존 모델·스킬·캐릭터·애니메이션 설정 키와 대화 저장 형식은 유지한다.

## 기능 보존과 상태

[보존표](FEATURE_PRESERVATION.md)의 A01~A20에 해당하는 기존 컴포넌트와 실행 경로를 계속 사용한다.

- 일반 작업/설정: ConversationPicker·ProjectPanel·ModelPicker·SkillPicker, Team/Solo와 업무 지시.
- 대화와 결과: 기존 ResultView·Markdown/원문·전체 보기·복사.
- 활동 센터: 기존 OperationsPanel의 활동·결과·퀘스트.
- 픽셀 화면: 기존 PixelOffice·캐릭터 선택·외형 선택·줌·동작 축소.
- 전역: 연결·실행/승인 상태·토큰·오류·실행 중단·승인 대화상자.

컨트롤·결과·픽셀·활동 패널은 페이지를 바꿀 때 상태를 버리지 않고 숨김 처리한다. 업무 지시·미전송 경로·접기 상태를 유지하며 새 WS 연결이나 실행을 만들지 않는다. 기존 셸로 왕복해도 동일 App/useBridge 인스턴스를 사용한다. 브라우저 새로고침까지 미전송 업무 초안을 영속 저장하는 기능은 이번 단계에 추가하지 않았다.

Atelier 원본 서비스와 data는 수정하지 않았다. T01~T20의 설계 편집·파일·백업 기능은 원본에서 계속 제공되며 통합 앱에서 아직 사용할 수 없다. 홈의 네 시작점은 안내 카드이며 프로젝트 생성이나 AI 생성 버튼처럼 동작하지 않는다.

## 검증 결과

| 명령/검사 | 결과 |
|---|---|
| `npm run typecheck` | 통과. 최종 build의 동일 typecheck도 통과 |
| `npm test` | **19개 파일·85개 tests 통과**, skip 없음. 기존 81개와 신규 경계 검사 4개 |
| `npm run build` | 통과. 최종 UI 41개 모듈과 서버 빌드 |
| `npm --prefix atelier/atelier run check` | 14개 모듈 문법 통과 |
| `npm --prefix atelier/atelier test` | **53개 통과**, 실패/skip 0 |
| `node tools/verify-atelier-assets.mjs` | 격리된 실제 빌드 bridge에서 폰트·OFL·아이콘·LICENSE의 응답 MIME·원본 byte 확인 통과 |
| `node tools/verify-conversation-restart.mjs` | 합성 App Server로 기존 프로젝트/대화 복원·Solo resume·Team 중단 복구·만료 승인 거부·network=false 통과 |
| `node --check` 신규 도구 2개 | 문법 통과 |
| `git diff --check` | 공백 오류 없음. 저장소의 LF→CRLF 안내만 발생 |

테스트의 junction·원자 파일 rename·loopback 연결에는 필요한 로컬 도구 권한을 사용했다. 실제 모델·셸·사용자 데이터·운영 서비스는 사용하지 않았다. 소스 검사와 브라우저 검증은 독립 보안 감사가 아니다.

### 실제 브라우저 확인

브라우저에는 [합성 UI fixture](../../tools/fixtures/atelier-ui-server.mjs)가 제공하는 **UI 검증용 합성 대화·모델**만 사용했다. 이 도구는 실제 Codex·셸·모델을 호출하지 않으며 사용자 history를 읽거나 저장하지 않는다. 생성 응답/승인도 테스트용임을 화면에 표시한다. 테스트 전용 서버는 종료했다.

| 확인 항목 | 결과·근거 |
|---|---|
| 홈·일반 작업·결과·활동·픽셀·설정 | 탐색과 기존 컴포넌트 접근 확인 |
| 디자인 준비 상태 | 여덟 메뉴 disabled, 편집/저장/생성 미지원 문구 확인 |
| 입력 보존 | 업무 텍스트·미전송 경로를 작성한 후 결과/설정으로 이동·복귀해 값 유지 확인 |
| 셸 왕복 | 기존 화면 → Atelier로 돌아온 뒤 같은 업무 초안 유지 확인 |
| 합성 승인 | 거절에 최초 초점, 역방향은 마지막 승인 버튼, 정방향은 거절로 순환, Esc 후 pending 유지, 거절 후 heading으로 복귀 |
| 긴 결과 | 전체 보기에서 실제 스크롤 영역, 원문 전환, Esc 닫기·열기 버튼으로 초점 복귀 확인 |
| 실행 중 탐색·중단 | HOLD_UI 합성 실행 → 홈 이동 → 전역 중단 → 진행 작업 없음 확인 |
| 연결 종료 | bridge offline과 새 실행 버튼 disabled 확인 |
| 모바일 메뉴 | native modal 열기·Tab/Shift+Tab 순환·Esc 닫기·열기 버튼으로 초점 복귀 확인 |
| 캐릭터 설정 | Builder 선택 → 실제 상태·외형 1~5 선택 컨트롤 접근 확인. 사용자 외형 설정 변경은 하지 않음 |
| 1440×1000 | 홈/일반 작업 scrollWidth=1425, viewport=1440; 넘침 없음 |
| 768×1024 | 홈 scrollWidth=753, viewport=768; 메뉴 버튼·단일 작업 열 확인 |
| 390×844 | 홈/일반 작업/픽셀 scrollWidth=375, clientWidth=375; 넘침 없음. 픽셀 월드는 기존 내부 스크롤 유지 |
| 폰트·동작 축소 | document.fonts loaded 및 Instrument Sans 확인. 검증 브라우저의 prefers-reduced-motion=true가 캐릭터 동작 축소로 반영됨 |
| 콘솔 | 연결 종료 실험 전 검증에서 error/warn 없음 |

화면 증거는 모두 합성 자료다:

- [데스크톱 홈](stage1-home.png), [일반 작업](stage1-work.png), [활동 센터](stage1-operations.png), [픽셀 화면](stage1-pixel.png), [승인](stage1-approval.png)
- [모바일 홈](stage1-mobile-home.png), [모바일 작업](stage1-mobile-work.png), [모바일 픽셀](stage1-mobile-pixel.png)

## 재현과 복구

전체 검사는 루트 package.json의 기존 명령을 사용한다. 프로덕션 정적 에셋 검사는 build 후 `node tools/verify-atelier-assets.mjs`를 실행한다. 이 검사는 `.cache/atelier-assets-*`에 격리된 합성 bridge를 띄우며 loopback 4872만 사용한다.

화면 검증을 재현하려면 build 후 `node tools/fixtures/atelier-ui-server.mjs`를 실행하고 `http://127.0.0.1:4871`을 연다. 일반 업무 입력/실행은 합성 승인 요청을 표시한다. `HOLD_UI`를 포함한 요청은 중단 버튼 확인용 합성 진행 상태를 유지한다. 이 서버를 실제 Auto-Codex 실행기로 사용하지 않는다. 종료는 Ctrl+C다.

기존 화면으로 전환하면 즉시 이전 UI 구성을 사용할 수 있다. 데이터 migration이 없으므로 UI 표시 복귀에 DB 복원·대화 삭제가 필요하지 않다. 새 UI 선호 키만 추가했으며 workspace·네트워크 허용·승인을 자동으로 바꾸지 않는다.

## 미검증·다음 단계

- 실제 CLI/계정/모델을 통한 업무 실행과 OS 폴더창·실제 프로젝트 신뢰 변경은 미실행. 해당 연결은 기존 코드와 합성 회귀로 확인했다.
- 실제 스크린리더 전체, 모든 Windows/브라우저 조합, 200% 확대의 전체 흐름은 미검증. 접근성 규격 전체 충족으로 보고하지 않는다.
- AI 제안·도메인·DB·WS chunk·디자인 편집·프롬프트 생성은 미구현이다.

다음은 **2단계 — Atelier 도메인·규칙의 shared/atelier TypeScript 이식**이다. 기존 확정/제안·영향 그래프·범위 조립·불변 스냅샷·검토/수정 관계를 원본 fixture로 입증한 후 저장소·편집 UI를 순서대로 연결한다. 외부 배포·공개 게시·추가 승인 대기 없음.
