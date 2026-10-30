# DI / DO / Pulse 사용자 입력 실사용 테스트

검증일: 2026-10-30 (한국 시간). 실제 로그인된 Codex App Server의 `gpt-6.1-sol`을 사용했다. 합성 응답 fixture와 기존 `DI-DO.atelier.json` 예시는 사용하지 않았다. 기존 예시는 이번 요구의 DO/DI 조작 방향과 달라 재사용하면 결과가 왜곡된다.

## 결론

제공된 설명은 **동작하는 UI 프로토타입을 만들기에 충분**했다. 그러나 **현재 작업실에서 이 설명을 넣고 AI 후보를 반영하는 기본 여정은 제작으로 이어지지 않았다.** 직접 제작 경로로 만든 비교용 시제품도 운영 화면의 우선순위와 참고 스타일 적용을 보완해야 한다. 전체 성공이나 배포 준비 완료로 판정하지 않는다.

| 검증 경로 | 결과 |
| --- | --- |
| 작업실: 원문 입력 → 실제 AI 제안 → 3개 후보 반영 → 제작 준비 | 제작 전 차단. 기능·화면·흐름 등의 항목을 자동으로 만들지 않음 |
| 비교: 같은 도메인 요구 → 일반 Codex Solo 제작 → 브라우저 직접 조작 | 실제 HTML/CSS/JS 생성. 동작 검사 18개 통과, UX 검사 1개 실패, 참고 스타일 1개 부분 반영 |

두 번째 경로는 작업실 성공의 증거가 아니다. 테스트 담당자가 출력 위치·독립 HTML 형식·실행 제한을 지정하고 공개 참고 자료의 관측 기록과 공식 SVG를 로컬로 준비한 **보조 비교 실험**이다. 서비스 요구사항을 추가하거나 실제 장비 연결을 가정하지 않았다.

## 1. 작업실에서 실제로 진행한 여정

입력은 [테스트 원문](../../tools/fixtures/dido-idea.txt)을 아이디어란에 그대로 붙여 넣었다. 프로젝트 이름과 제품 유형 `제작 도구`를 선택하고 새 프로젝트를 만들었다. 기존 프로젝트·사용자 대화·설정·권한은 변경하지 않았다.

1. 최초 기본 3문항을 대상으로 실제 AI 제안을 요청했다.
2. AI가 제품·사용자·목표 후보 3개를 반환했다. DO 6개, DI 3개, Config.ini, 가변 채널, DO=`SIB_DI_X`, DI=`SIB_DO_X`, 200ms, Pulse A/B 그룹을 올바르게 해석했다. 원문에서 모호한 속도 단위·실제 통신 방식은 확인할 가정으로 남겼다.
3. 화면에서 세 후보를 각각 반영했다. JSON 형식 오류는 발생하지 않았으며 후보는 정상적으로 `proposed` 상태로 저장됐다. 사용자 확정으로 위장하지 않았다.
4. 기능·화면·흐름·컨셉·스타일·리소스의 개수는 모두 0이었다.
5. 현재 제작 조건은 16개가 남았다. 이 중 11개는 필수 답변의 확정 조건이고, 5개는 기능·흐름·컨셉·스타일·자료의 준비 조건이다. 16개 전부를 결함으로 집계하지 않는다. 후보 확정은 의도된 사용자 결정이다.
6. 최종 고정본 생성 요청은 `INVALID_SELECTION`으로 거부됐고 제작 준비 버튼도 비활성화됐다. 따라서 작업실의 실제 제작 실행·산출물 생성은 수행되지 않았다.

핵심 부족점은 원문에 이미 적힌 요구를 **기능·화면·흐름을 포함한 전체 설계 초안으로 전환하는 경로가 없는 것**이다. 현재 AI 계약은 `brief/flow/concept/style`의 기존 대상 수정만 지원한다. 신규 기능·화면·자료를 한 번에 구성하는 목적은 없다. 흐름 제안을 받으려면 화면을 먼저 수동 추가해야 하며, URL 참고 자료를 읽고 시각 정보를 연결하는 경로도 기본 제안에 포함되지 않는다.

이 현상은 사용자에게 설명을 더 요구하는 것으로 해결하기보다, 전체 초안을 만들고 사람이 검토할 수 있는 단계로 개선하는 것이 적절하다. 확정·실행 승인 자체를 자동으로 우회해서는 안 된다.

## 2. 비교용 시제품의 실제 동작

[시제품 열기](../../.cache/dido-acceptance/prototype/index.html) · [작성된 가정과 구현 범위](../../.cache/dido-acceptance/prototype/README.md)

| 검사 | 결과·근거 |
| --- | --- |
| DO / DI / Pulse Board 세 화면 | 통과 |
| 기본 DO 6개 / DI 3개 | 통과 |
| DO `SIB_DI_X` 클릭 ON/OFF 및 전송 기록 | 통과. 실제 통신이 아닌 전송 시뮬레이션 |
| DI `SIB_DO_X` 200ms 화면 갱신 | 통과. MutationObserver로 실제 화면 갱신 간격 측정 |
| 갱신 일시정지·재개 | 통과 |
| Config.ini 파일 업로드 | 통과. DO 12개 / DI 5개 / 일반 보드당 5채널로 변경 |
| 잘못된 Config.ini | 통과. 입력과 실행 중 설정 유지 |
| Pulse 보드 안의 A/B DO + DI 채널 | 통과. 2/1/3 구성 확인 |
| Pulse 가변 그룹 | 통과. 1/1, 2/2 구성 확인 |
| A/B 그룹별 값 전송 | 통과. A=0 / B=80의 표시·시뮬레이션 결과 확인 |
| 전체 DO에 같은 값 전송 | 통과. A/B=35 및 네 채널의 표시 확인 |
| 잘못된 채널 수 | 통과. 0 거부, 기존 채널 유지 |
| Guidance 아이콘 위치·출처 | 통과. 공식 settings.svg와 SHA-256 일치, 설정 버튼 1개 / 보드 카드 0개 |
| 마우스 추적 장식 | 통과. 실제 위치 변화 및 pointer-events:none |
| 호버·스크롤 고정 탭 | 통과 |
| 키보드 조작 / reduced-motion | 통과 |
| 390px, DO 12개 | 통과. 가로 넘침 없음 |
| 브라우저 오류·외부 통신 | 오류 0개, 외부 요청 0개. 시뮬레이션·가상 데이터 안내 표시 |
| 핵심 상태가 첫 화면에 보이는가 | **실패**. 1440×1000 화면에서 첫 신호가 y=1035px에 위치. 큰 소개 문구·여백·요약 영역이 보드를 아래로 밀어냄 |
| 참고 서체·인터랙션의 정확한 적용 | **부분 반영**. 원본 BT Grotesk 대신 Arial/맑은 고딕. 커서·호버·sticky 탭은 자체 구현이며 원본과의 동등성 미검증 |

### 시각 확인

![기본 DO 화면](../../.cache/dido-acceptance/prototype-do-1440.png)

![Pulse 설정 화면](../../.cache/dido-acceptance/prototype-pulse-1440.png)

실제 Config.ini 문법, 채널별 값 정의, 장비 프로토콜이 없으므로 샘플 문법으로 검사했다. 일반 보드당 8채널·Pulse 1개·속도 0=OFF/양수=ON·각 입력의 최대치 등은 생성 모델이 명시한 검증용 가정이며 실제 사양으로 확정하지 않는다. 물리 보드 송수신, 서버·장비 동기화, 실제 속도 단위 및 장시간 운전은 미검증이다.

## 3. 참고 자료와 증거

- [Heron 원본](https://heronaiapp.com/)의 실제 계산된 서체·색·커서 요소를 별도 브라우저로 읽었다. 관측된 강조색은 #FA3600, 주요 글자색은 #282828이었다. 브라우저 최초 스크린샷은 로딩 중 화면이므로 원본 레이아웃 완성본의 증거로 사용하지 않는다.
- [Guidance 공식 페이지](https://www.streamlinehq.com/icons/guidance)와 [공식 벡터 저장소](https://github.com/webalys-hq/streamline-vectors/tree/52d750c9ce051e51cb181b7a78932120c48541d0/guidance)를 사용했다. 고정 commit의 공개 SVG 10개를 검증 폴더에 준비했고 실제 사용된 것은 설정 아이콘 1개다. 원본 서체 파일은 가져오지 않았다.
- 로컬 증거: [작업실 여정](../../.cache/dido-acceptance/journey-evidence.json), [실제 제작 실행](../../.cache/dido-acceptance/control-evidence.json), [기능·UX 검사 결과](../../.cache/dido-acceptance/prototype-checks.json), [출처 manifest](../../.cache/dido-acceptance/assets/SOURCES.json).

초기 자동화는 반영 직후 같은 이름의 버튼을 다시 집어 대기했다. 후보별 위치로 선택해 같은 저장본을 재개했고 새 모델 호출 없이 정상 반영을 확인했다. 파일 업로드 검사에서는 Windows CRLF와 textarea의 LF 정규화를 동일하게 비교하도록 검사 도구를 수정했다. sticky 검사는 실제 스크롤 가능한 DO 화면에서 수행했으며, 모바일에서는 표시 중인 시뮬레이션 안내를 확인했다. 제품의 검증 조건이나 실패 assertion을 제거하지 않았다.

## 4. 재현 및 변경 범위

`npm run build` 후, 설치된 Playwright 경로를 사용한다. `--live`는 실제 로그인 모델을 호출한다. 기존에 신뢰된 현재 저장소만 사용하고, 지침·신뢰 설정을 변경하지 않는다.

```powershell
node tools/verify-atelier-dido-live.mjs --live --stage=references --playwright=<playwright 경로>
node tools/verify-atelier-dido-live.mjs --live --stage=assets --playwright=<playwright 경로>
node tools/verify-atelier-dido-live.mjs --live --stage=journey --playwright=<playwright 경로>
node tools/verify-atelier-dido-live.mjs --live --stage=control --playwright=<playwright 경로>
node tools/verify-dido-prototype.mjs <playwright 경로>
```

범위/위험도: R1, 검증 스크립트·입력 fixture·보고서 추가. 기존 src/server/shared/package 파일의 diff 해시가 실제 모델 실행 전후 동일함을 확인했다. 작업실 DB와 일반 대화는 각각 새로운 `.cache/dido-live-*`에 격리했다. 비교 시제품도 `.cache/dido-acceptance/prototype/`에만 생성했다. 로컬 서비스는 127.0.0.1의 4893/4894만 사용하고 검사 종료 후 종료했다. 추가 권한 요청은 승인하지 않는다. 배포·마이그레이션·실제 장비 접속은 실행하지 않았다.

이 보고서는 테스트 결과이며 위 두 제품 부족점을 수정했다고 주장하지 않는다. 자동 초안 구성과 운영 화면의 정보 우선순위 개선이 후속 작업이다.
