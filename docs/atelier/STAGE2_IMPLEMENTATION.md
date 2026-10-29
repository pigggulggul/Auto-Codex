# Atelier 통합 2단계 — 도메인·규칙 이식

2026-10-29, Windows / Node v22.20.0. 시작 브랜치 `main`. **R2: 공통 도메인·데이터 계약 추가**. 1단계 셸·스타일·승인·문서의 기존 미커밋 변경을 보존했다. 루트 AGENTS.md를 확인했으며 대상 경로의 AGENTS.md/AGENTS.override.md는 없었다.

## 변경 파일과 범위

| 파일 | 구현 |
|---|---|
| shared/atelier/domain.ts | 결정·상태·이력·예시·컨셉·브리프 검사·조립·스냅샷·검토·수정 계획 |
| shared/atelier/structure.ts | 흐름 그래프, 결정 의존성과 재검토 전파, 선택 범위·근거·첨부 선별 |
| shared/atelier/guide.ts | 원본 12개 질문·4개 시작점·6개 제품 유형·내장 예시·버전·공통 기준 |
| shared/atelier/types.ts, value.ts, index.ts | 실제 소스의 타입 계약, 복제·동결, context를 받는 공통 진입점 |
| shared/atelier/domain.source.test.mjs | 원본 domain.test.mjs의 순수 도메인 시나리오 22개 |
| shared/atelier/structure.source.test.mjs | 원본 extension.test.mjs의 순수 그래프·영향·범위 시나리오 15개 |
| shared/atelier/parity.test.mjs | 7개 원본 백업 예제의 전체/흐름/화면/리소스 출력·기준·파일·수정 회차 비교, 가이드·생성자·불변성·의존 경계, 19개 |
| tsconfig.node.json | shared 전체를 strict 타입 검사에 포함. ES2022만 사용하므로 DOM 의존도 드러남 |
| tsconfig.server-build.json | shared TypeScript 검사 파일이 서버 산출물에 들어가지 않도록 제외 |
| vite.config.ts | 기존 1단계 Vitest 설정에 shared 검사만 추가. 원본 Atelier의 node:test 분리는 유지 |
| tools/verify-atelier-domain.mjs | 빌드 모듈 직접 로드·신규 기준 동결·결과/검토 미생성과 원본 해시를 재현 가능하게 검사 |
| docs/atelier/DOMAIN_CONTRACT.md, STAGE2_SOURCE_MANIFEST.json | 필드별 원본·검증 대응, 현재/후속 계약 구분, 원본 16개 파일 해시 |
| docs/ATELIER_INTEGRATION_GUIDE.md, README.md | 2단계 진행 상태와 검증 진입점만 갱신 |

기존 파일이나 `.local-data`를 이전·수정하지 않았다. 새 런타임 의존성, 외부 서비스, 유료 API, 배포, 새 HTTP/WS endpoint는 없다. `atelier/atelier/server.mjs`를 통합 런타임에서 import하지 않는다.

## 원본·가이드 차이와 이식 결정

- 원본 3개 JS 모듈은 이미 DOM을 사용하지 않지만 ID·시각은 crypto/Date에서 직접 만든다. 이식본은 `createDomain/createStructure`에 context를 주입해 환경 효과를 분리했다. 테스트는 같은 ID 순서·시각으로 원본과 비교한다.
- 원본 `contracts.d.ts`에는 snapshot의 input 구체 구조·output/intent/scopeContexts, 일부 링크·검토 메타데이터가 빠져 있다. 실제 domain/structure/app/panels와 validateProject를 기준으로 보완했다. [로컬 계약과 필드 대응표](DOMAIN_CONTRACT.md)를 따른다.
- 원본의 스냅샷 보존은 복제와 서버의 변경 거부에 의존한다. 이식본은 신규 스냅샷에 deep readonly와 재귀 freeze를 추가했다. baseline 작성 완료 후 동결하고 리뷰 dependency 배열을 따로 복제한다. legacy 스냅샷 JSON은 자동 수정·동결하지 않는다.
- 원본과의 비교에서 reference.history=[]가 입력 정리에 포함됨을 확인해 동일하게 보존했다. 16개 기준 파일은 0단계 SHA-256 목록과 모두 일치한다. 기존 guide/template/schema/model 번호도 그대로다.

## 기능 보존·검증 결과

최종 코드에 대해 실행했다. 루트 22개 테스트 파일·141개 검사가 통과했고 skip은 없다. 신규 56개는 도메인 검증이며 실제 디자인 제품을 생성했다는 증거가 아니다.

| 명령 / 확인 | 결과 |
|---|---|
| `npm run typecheck` | 통과. shared 전체 strict 검사, allowJs=false 유지 |
| `npx vitest run shared/atelier` | 3개 파일·56개 통과 |
| `npm test` | 22개 파일·141개 통과: 기존 85개 + 신규 56개 |
| `npm run build` | 통과: UI 41개 모듈, 기존 서버와 build-server/shared/atelier/*.js 생성 |
| `npm --prefix atelier/atelier run check` | 원본 14개 실행 모듈 문법 통과 |
| `npm --prefix atelier/atelier test` | 원본 53개 통과, 실패·skip 0. 원본의 SQLite/파일/백업/ZIP/재시작 검사 포함 |
| `node tools/verify-atelier-domain.mjs` | 빌드된 index.js 직접 import, newProject → 미준비 → draft baseline → 중첩 freeze·변조 거부. 결과·리뷰 0, 원본 16개 SHA-256 일치 |
| `git diff --check` | 통과. 기존 LF→CRLF 안내만 존재 |

처음 도메인 검사 실행은 Windows 샌드박스의 Vitest 임시 파일 rename EPERM으로 테스트 수집 전에 실패했다. 필요한 로컬 도구 권한으로 다시 실행해 위 결과를 확인했다. 자동 승인 검토 거절은 없었다. 원본 비교에서 발견된 history 누락은 수정 후 재검사했다.

보존표 A01~A20의 프로젝트·일반 작업·대화·Team/Solo·실행·승인·이력·픽셀 기능의 소스는 이번 단계에서 수정하지 않았다. 1단계 공통 셸과 기존 화면 전환도 유지한다. T03~T06/T08~T09/T11~T13/T16~T18의 도메인 의미는 새 shared 모듈로 검증했다. 디자인 편집의 사용자 진입점은 아직 원본 Atelier에만 있고 통합 셸에서는 계속 준비 상태다. 나머지 T 항목의 통합 완료를 주장하지 않는다.

거부/실패 경로에는 미확정·제외 결정, 명시 값 충돌, 미존재·미확정 출력 대상, 고립·막다른 흐름, 복구 보존값 누락, 재확인되지 않은 그래프, 끊긴 의존·원본/파일 참조, 좌표 오류, 오래된 의도, 미확정 수정 계획, 결과/관찰/근거 부족, 동작 기록 없는 behavior 검토가 포함된다. 순환 전파 종료·무관 결정 보존·이력 파일 제외·부모 판정 보존·새 판정 초기화·스냅샷 직접 변조 거부도 확인했다.

## R2 위협 분석·복구

- 보호 자산/공격자: 설계 의도·범위·기준·과거 판정과 실행 권한을 변조된 편집/향후 AI 입력으로부터 보호해야 한다.
- 경계/오용: 지금은 신뢰된 로컬 호출 → 순수 도메인 → 데이터 반환이며 새 외부 입력 경로가 없다. 제안을 확정값으로 취급하거나, 범위를 넓히거나, 이미지 근거로 동작 완료를 표시하는 오용을 회귀 검사한다.
- 방어/근거: 확정/제안 분리, 명시적 영향 그래프, 범위/근거 선별, 신규 스냅샷 동결, 검토 근거 검사. 현재 타입은 unknown payload의 런타임 검증·인가가 아니다. 서버 소유/파일 실재/ID/트랜잭션 검증은 3단계에서 필수다.
- 적용/복구: 데이터·DB migration과 외부 배포가 없다. shared 모듈은 아직 런타임 UI/브리지에 연결되지 않았다. 이 단계의 추가 파일·설정 변경만 되돌리면 되며 기존 미커밋 셸·데이터를 reset/삭제할 필요가 없다.

## 미검증·다음 단계 조건

새 브라우저 화면이 없어 UI 크기·키보드·동작 축소의 추가 검증은 해당 없음이다. 이전 단계의 UI 증거를 이번 단계의 새 실행 증거로 재사용하지 않는다. 실제 Codex/모델·생성물·OS 폴더창·통합 DB/WS·디자인 편집은 실행하지 않았다. 이번 단계가 제안 API나 수동 작업실을 활성화하지 않는다.

다음은 **3단계 저장소·파일·WS·백업**이다. 이 도메인을 이용하되 unknown 입력의 필드별 검증, 소유 관계, optimistic version, 기존 스냅샷 변경 거부, 실제 바이트/해시/프로젝트 분리, 제한된 전송·백업 왕복·충돌 복구를 먼저 입증해야 한다. 이후 4단계에서 수동 편집 UI를 연결한다. AI 제안·실행 manifest·자동 제작은 여전히 5~7단계다. 추가 승인 대기 없음.
