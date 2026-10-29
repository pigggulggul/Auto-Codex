# Atelier 2단계 — 로컬 도메인 계약

상태: **2단계 시점의 `shared/atelier/` 순수 도메인 계약**. 아래의 저장소·WS 미구현 설명은 당시 경계다. 현재 브리지 검증·저장·실제 수동 명령은 [3단계 기록](STAGE3_IMPLEMENTATION.md)에 구현 상태를 별도로 기록했다. AI·제작 연결은 여전히 후속 제안이다. legacy 유형·가이드 메타데이터·시각 필드 보완도 3단계 기록을 따른다.

## 호출·상태 소유

`createDomain(context)`가 원본 domain/structure 함수를 제공한다. `createStructure(context)`만 별도로 사용할 수도 있다. 질문·예시·버전은 `guide.ts`, 데이터 타입은 `types.ts`, 공통 진입점은 `index.ts`다.

```ts
import { createDomain } from './shared/atelier/index.js';

// 이 context의 구현·ID 유일성·시각의 신뢰는 호출 계층 책임이다.
const domain = createDomain(context);
const project = domain.newProject({ name: '내 설계', entry: 'idea' });
const problems = domain.issues(project);
// 이유를 적은 진단 기준은 draft다. 제작 결과나 검토 완료가 아니다.
const snapshot = domain.baseline(project, '현재 알고 있는 의도부터 비교');
```

- 도메인은 `Date`, `crypto`, DOM, 파일, DB, 네트워크, App Server를 사용하지 않는다. ID는 `context.id(prefix)`, ISO 시각은 `context.now()`로 주입한다. 운영 어댑터는 아직 추가하지 않았다.
- `newProject/decision`은 객체 생성, `updateDecision/touch/chooseConcept/editGraph/acknowledgeGraph` 등은 전달된 편집본을 명시적으로 변경한다. 함수형 불변 상태 저장소를 새로 도입하지 않았다.
- `issues/ready/assemble/selectScope/reviewCriteria`는 편집본을 변경하지 않는다. 같은 입력·템플릿은 같은 텍스트·섹션·근거 목록을 만든다.
- `project.version`은 저장 계층의 optimistic version이다. `revision`은 설계 의미 변경, decision/graph 버전은 결정·연결 변경이다. 도메인이 저장 성공이나 실행 성공을 선언하지 않는다.

## 실제 원본과 타입의 대응

근거: `atelier/atelier/public/domain.js`, `structure.js`, `guide.js`, `app.js`의 `add-*`·`createRegion`·`resultModal`·`planModal`, `panels.js`의 상세 편집, `src/project-validation.mjs`의 `validateProject/validateRelations`. 원본의 `contracts.d.ts`만으로 누락된 필드를 추정하지 않았다. 현재 원본 해시는 [원본 목록](STAGE2_SOURCE_MANIFEST.json)에 고정했다.

아래 표는 **로컬 데이터 필드 대응표**다. 브라우저가 이 표의 모든 속성을 임의 patch해도 된다는 뜻이 아니다. ID·버전·이력·소속·확정 명령은 다음 단계의 브리지 allowlist와 런타임 검증이 소유해야 한다.

| 영역 / 타입 | 실제 필드 | 원본 규칙·검증 / 통합 상태 |
|---|---|---|
| 공통 결정 `Decision` | id/version/value/status/source/reason/scope/reviewNeeded/history, dependsOn/screenIds/flowIds/assetIds/referenceIds/regionIds/appliesTo/fileIds, scopeMode/conceptId/fontAssetId, fileId/cropId | 상태 unknown/proposed/confirmed/excluded, 출처 user/example/observation/external. 유효한 status만 확정으로 취급; 빈 value는 요구로 조립하지 않음. 변경 전 이력 최대 50, 활동 최대 150 |
| fields | product/user/goal/decisionMaker/value/doubt/evidence/environment/scope/fit/constraints/criteria | QUESTIONS의 기존 12개 key. constraints만 선택 항목. 자동으로 사실·사용자 조사로 승격하지 않음 |
| features / `Feature` | priority/purpose/action/info/flowIds | 이번 범위 확정 기능, 흐름 참조 검사 |
| contents / `Decision` | kind/purpose/availability/content/conditions/materialType/screenIds/fileId | 보유 상태면 실제 내용 또는 파일 ID 필요. 생성 계획과 보유를 구분 |
| flows / `Flow` | goal/role/start/steps/branch/recovery/complete/loop/graph | steps는 화면 ID. 시작·완료·도달 가능성·막다른 경로·분기 조건·복구 보존 데이터·사용자 재확인 검사 |
| screens / `Screen` | kind/role/entry/priority/actions/response/next/exceptions/preserve/links | 역할·흐름 소속과 확정 상태 검사. 페이지·패널·게임 상태 의미 보존 |
| references / `Reference` | id/name/url/fileId/note/role/regions/dependsOn 등 링크 | 참조 노드와 결정을 구분. URL만으로 확정 관찰을 허용하지 않음. 스냅샷 입력에서는 원본처럼 history=[] 유지 |
| regions / `Decision` | fileId/cropId/rect, dimension/observation/interpretation/target/purpose/keep/change/avoid/useMode/appliesTo | rect=x/y/w/h, 범위·유한값·원본 교체·적용 관계 검사. 실제 이미지 해독·크롭·파일 소유 검증은 3단계 |
| concepts / `Decision` | selected/summary/experience/hero/bg/text/accent/font/shape/typography/material/layout/motion/intensity/resources/reference/assumptions, 예시 name/label | 내장 후보는 proposed. 사용자가 고르는 chooseConcept만 선택·확정 변경. 이미지 분석 결과로 표시하지 않음 |
| styles / `Decision` | role/scope/exception/conceptId/fontAssetId 및 공통 링크 | 색 형식·역할·적용 범위·같은 역할/범위의 다른 값 충돌·실제 확정 서체 연결 검사 |
| assets / `Decision` | kind/purpose/method/availability/rules/sourceUrl/usage/review/fileId/referenceIds | 보유는 fileId 필요. 파일 ID 존재 검사와 바이트·라이선스·실행 검증은 서로 다름 |
| output / `Output` | purpose/format/scope/selection/tech/extra/common/commonVersion/procedure/procedureSource/language/version | selection.mode=all/flows/screens/assets, ids는 실제 대상. extra 원문 보존 |
| progress/settings | tab/guideStage/returnTo 및 원본 가이드 초안, density=guide/quick | UI·진행 정보. 임의 가이드 초안은 unknown으로 보관하며 조립 입력에서는 제거. 실행 권한 설정이 아님 |
| intent | choice/reason/revision | ready는 원본처럼 issues 없음 + 해당 revision의 choice=match 검사. 이유 필수의 새 WS 명령은 아직 미구현 |
| `PromptSnapshot` | id/number/createdAt/revision/templateVersion/guideVersion/commonVersion, selection/scopeContexts/decisions/referenceFileIds/input/criteria/intent/output/text/sections/draft/planId/baselineReason? | 깊은 readonly 타입과 신규 스냅샷의 재귀 freeze. 과거 저장본은 재작성하지 않음 |
| `ManualResult` | id/number?/snapshotId/fileId?/source?/screen/environment?/instruction?/execution?/note?/keep? | 실제 기준 ID에 연결. 원본 legacy 최소 기록을 수용하도록 일부 메타데이터는 optional. 등록·파일 실재 검증 UI/서버는 후속 단계 |
| `Review` / `ReviewItem` | resultId/snapshotId/parentReviewId/planId, scope/state/intent/intentReason/screen/holdReason/learning/externalFeedback/feedbackSource, createdAt/completedAt?/recheck?; 항목 expected/decisionIds/verdict/observation/evidence/target/keep/cause/resolution/regression/selected | visual/behavior 구분, unverifiable 초기값. 시각 근거만으로 behavior 완료 불가. 기준 변경은 과거 판정을 지우지 않고 recheck로 표시 |
| `RevisionPlan` | id/reviewId/resultId/snapshotId/selection/itemIds/createdAt/confirmed, problem/cause/target/change/scope/keep/materials/check | 항목 선택·변경/유지/재검토 내용 필요. 미확정 계획은 수정 스냅샷 생성 거부 |

추가 필드의 string/배열 타입은 TypeScript 호출 계약이다. `unknown` JSON 입력을 안전한 `Project`로 파싱했다는 의미가 아니다. 원본 `validateProject`의 형식 검사와 백업 관계·실제 바이트 검증을 통합 브리지로 옮기는 일은 3단계이며, 현재 임의 WS patch는 열리지 않는다. `updateDecision`은 신뢰된 로컬 편집 함수를 위한 API로, 서버 명령 handler에 그대로 노출하면 안 된다.

## 범위·스냅샷·검토의 불변식

- 영향은 명시적 dependency graph로 전파한다. 순환은 방문 집합으로 종료한다. 연결되지 않은 결정·흐름은 재검토 상태로 만들지 않는다. 문장의 숨은 의미를 분석하지 않는다.
- 흐름 출력은 그 흐름의 화면, 화면 출력은 선택 화면과 경계 맥락, 리소스 출력은 선택 리소스를 포함한다. 지원 서체와 확정 dependsOn 근거는 필요할 때 포함하되 근거의 원래 제작 대상을 추가하지 않는다.
- 첨부 ID는 현재 선택된 확정 근거에서 계산한다. 다른 대상의 파일·편집 이력 파일을 자동 첨부하지 않는다. `fileIds`는 백업을 위한 전체 참조 수집이며 `attachmentIds`와 용도가 다르다.
- 신규 스냅샷은 입력·설정·선택·텍스트·기준·근거 ID·버전을 복제하고 재귀 동결한다. `baseline`은 사유와 진단 문구를 작성한 뒤 동결한다. 신규 리뷰 항목도 별도 복제해 frozen 기준 배열을 공유하지 않는다.
- 결과는 지정한 과거 스냅샷에 남는다. 수정 스냅샷은 원래 계획의 selection/범위/형식을 유지한다. 새 리뷰는 부모 기준을 사용하고 판정은 unverifiable로 초기화하며, 부모 match는 regression 표시만 한다.
- 검토 완료에는 원본의 근거·의도·관찰·판정 규칙을 적용한다. 프롬프트·초안 생성은 결과 생성이나 검토 완료가 아니다.

## 다음 단계에서 강제할 경계

3단계는 unknown payload의 필드별 allowlist·크기·enum·소유 관계·ID 유일성·중첩 참조·저장 충돌·과거 스냅샷 변경 거부·실제 파일 바이트를 브리지에서 검증해야 한다. 타입 선언, 도메인의 issues, 재귀 freeze는 서버 인가·파일 검증·저장 트랜잭션의 대체가 아니다. 전달받은 result/review/plan 객체를 프로젝트 소속 검증 없이 실행·저장 계층에 신뢰해서는 안 된다.
