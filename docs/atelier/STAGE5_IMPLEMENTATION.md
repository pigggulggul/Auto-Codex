# 5단계: 읽기 전용 설계 제안

2026-10-30. 4단계 검증 완료 후 현재 main의 기존 미커밋 작업을 보존하며 구현했다. 외부 서비스·패키지·배포를 추가하지 않았다.

## 구현과 계약 차이

- `server/atelier/proposal-runtime.ts`는 기존 단일 `CodexAppServer`를 공유한다. 일반 turn.start의 대기열·활성 Team/Solo·승인 대기와 제안의 준비/실행을 하나의 admission 경계로 검사한다. thread는 read-only/ephemeral/approvalPolicy=never, turn은 readOnly/networkAccess=false/approvalPolicy=never로 서버가 강제한다. 일반 조사 모드의 네트워크 옵션을 상속하지 않는다. 스킬·브라우저 cwd·sandbox·권한 입력은 받지 않는다.
- JSON outputSchema와 응답 검증은 별개다. 모델 출력은 비신뢰이며 허용된 필드·문자열/목록/바이트 한도·목적·대상 소유·revision·대상 버전을 검사한다. 흐름 후보는 화면·전이·분기/복구를 구조로 받고 도메인 그래프 검증을 거친다. 이미지 입력은 현재 지원하지 않으며 IMAGE_UNSUPPORTED로 별도 기록한다. 이미지 분석·시각 결과·완료를 생성하지 않는다.
- 제안은 SQLite proposals 테이블에 별도 저장한다. 요청 r, 대상 ID/버전, 이전 값, 입력 SHA-256, idempotencyKey, 실제 모델/thread/turn과 생성/갱신 시각을 기록한다. 후보 원문·사용자 편집·적용·제외를 구분한다. 모델 실행 전에는 runtime ID를 만들지 않는다.
- 항목별 저장/적용/제외는 엄격한 WS이다. 적용은 사용자 동작이며 현재 project version·proposal version·revision·대상 버전을 다시 검사한다. 원래 확정 값은 적용 전까지 보존하고, 적용 시 이력에 남긴 뒤 proposed로 반영한다. 도메인의 version·영향 전파·의도 무효화·흐름 graph version을 거친다. 변경된 설계는 새 요청이 필요하며 기존 고정 스냅샷은 변경하지 않는다. 같은 제안의 다른 항목은 그 제안 자체의 앞선 적용만 있었으면 개별 적용할 수 있다.
- 실제 App Server 이벤트는 proposal thread로 먼저 상관 처리하여 기존 대화 응답/완료에 섞지 않는다. 실제 token usage와 진단 method는 기존 경로에 전달한다. 늦은 이벤트·조기 완료·WS 재접속은 재실행 명령이 아니다. 모델 오류/잘못된 출력/오래된 응답/CLI 불가/정책 거부/중단을 구분한다. 응답 불명 요청은 저장한 같은 키로 사용자가 확인한다.
- 권한 확대·대화형 도구 요청은 정책 오류로 거부한다. readOnly는 모든 읽기 도구 실행이 불가능하다는 뜻이 아니다. 존재하지 않는 no-tools 옵션은 전송하지 않는다. 응답 96KiB, 저장 제안 200KiB, 입력 96KiB, 대상·후보 8개, 프로젝트별 제안 256개, 실행 3분을 제한한다. 타임아웃은 실패를 기록하고 중단을 요청하며, 종료 통지가 없으면 해당 독점 child를 종료해 확인한 뒤 잠금을 해제한다. 종료 확인 실패는 잠금을 유지하고 bridge 재시작이 필요하다.

가이드의 5단계 네 목적(brief/flow/concept/style)을 구현했다. 최초 계약 표의 review 목적·skillPath·generation 동반 반환은 후속 제안이다. 새 화면·컨셉 등의 대상은 수동 탭에서 먼저 추가하고 선택한다. AI의 무제한 대상 생성이나 자동 확정은 제공하지 않는다. 제작 실행·산출물 수집은 6~7단계 영역이다. 기존 legacy Atelier JSON 백업은 원래 설계·파일 형식을 유지하며 AI 제안 기록은 포함하지 않는다. AI 기록까지 보관하려면 bridge 종료 후 `.local-data/atelier` 전체를 보관해야 한다. 통합 AI 백업 형식은 아직 제안이다.

## 검증

- `npm run typecheck`, `npm test` 165개, `npm run build` 통과.
- `server/atelier/proposals.test.ts`: 별도 후보/명시 적용/원래 확정 이력/불변 스냅샷/영향 전파, 네 목적, 원문·편집·제외, 잘못된 출력·다른 프로젝트·이미지 미지원, 오래된 응답, 실제 SQLite v1 사본과 v2 전환/재시작 중단, readOnly와 정책 거부, 준비 중 중단, 타임아웃의 종료 확인 전 잠금 유지.
- `tools/verify-atelier-proposals.mjs`: 실제 bridge/worker/SQLite/WS + 명시적 합성 App Server. 정상·잘못된 JSON·모델 실패·조기 완료·권한 거부·명시 중단·오래된 적용·일반 실행과 양방향 잠금·대화 불오염·시작 실패 후 재연결. 결과는 `STAGE5_WS_EVIDENCE.json`.
- `tools/verify-conversation-restart.mjs`: 기존 프로젝트 전환·대화 복원·thread 재개·부분 Team 복구·만료 승인·네트워크 기본 차단·지연 시작 중단 회귀 통과.
- `tools/verify-atelier-storage.mjs`: 실제 byte/백업/재시작·원본 DB/history 보존·CLI 없음·host/origin/속도/전송 중단 회귀 통과. 원본 53개 테스트와 소스 16개 해시 확인도 유지한다.
- 브라우저 실제 UI: 합성 fixture임을 모델 이름에 표시한 격리 저장소에서 제안 요청→후보 편집 저장→선택 적용→본문이 proposed/r2로 바뀜 확인. `stage5-proposal-fixture.png`. 390px에서 입력 접근과 가로 넘침 없음 확인(`stage5-mobile-fixture.png`). 이는 실제 모델 응답 품질 검증이 아니다.
- 설치된 `codex-cli 0.165.0-alpha.1.2`의 실제 `app-server generate-json-schema --experimental` 출력에서 thread의 read-only/ephemeral/never와 turn의 readOnly/networkAccess/outputSchema 필드를 확인했다. `STAGE5_CLI_SCHEMA_EVIDENCE.json`에 두 스키마 해시를 기록했다. 스키마 생성 중 CLI의 사용자 홈 임시 alias 생성은 샌드박스에서 거부됐지만 명령은 성공했고 모델·네트워크 요청은 하지 않았다.
- 최종 UI의 설계 탭 스크롤 1597px → 흐름 탭 0px → 설계 복귀 1597px를 확인했다. 실제 실행 중 프로젝트 삭제와 잘못된 proposal ID 중단도 최종 WS 검사에서 거부했다.

실제 로그인된 Codex 모델 요청과 응답 품질, CLI 버전별 실행 호환성(설치 버전의 프로토콜 스키마 확인과 구분), OS별 모든 로컬 서체, 대용량 파일 선택창, 전체 접근성/사용성 연구는 미검증이다. 모델이 없는 환경에서 가짜 후보를 제품에 채우지 않는다. 합성 fixture는 테스트 도구에만 존재한다.

## 위협 분석·적용·복구

R2. 보호 대상은 설계 확정값/고정본/파일과 기존 실행·승인·대화다. 브라우저·모델·업로드는 비신뢰이며 WS의 허용 필드/한도, worker의 프로젝트 소유/버전, SQLite 트랜잭션과 공유 도메인에서 거부한다. 재전송은 키로 중복 실행을 막고 동시 적용은 proposal version과 project version으로 차단한다. 모델이 권한을 승인하거나 쓰기 실행으로 승격할 수 없다.

bridge의 소유 잠금 하에서 기존 v1 DB를 `VACUUM INTO`로 일관된 사본(`atelier-v1-backup-*.sqlite`)을 만든 뒤 proposals 테이블만 추가해 user_version=2로 전환한다. 프로젝트·파일·history·원본 Atelier DB를 이전하지 않는다. 새 DB도 설계 도메인 schemaVersion=1은 그대로다. 하위 버전 bridge는 v2를 거부한다. 롤백은 bridge를 멈추고 현재 전체 데이터 사본을 먼저 보관한 뒤 코드와 사본을 함께 선택해야 하며, 사전 DB 사본에는 이후 신규 기록이 없다. 자동 다운그레이드·운영 마이그레이션·배포는 실행하지 않았다. 승인 대기 없음.

다음 단계는 사용자가 6단계를 요청하고, 검증된 workspace binding·불변 snapshot·기존 실행/승인·실제 산출물 manifest를 연결하는 조건이다. 이번 제안 적용을 제작 완료나 결과 검토 완료로 해석하지 않는다.
