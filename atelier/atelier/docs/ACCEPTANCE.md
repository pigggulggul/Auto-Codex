# AC01–AC64 구현·검증 대응표

기준: 서비스 명세 v1.3 §22. 2026-10-29에 검증했다.

1.2 기본 가이드의 최신 구현은 `public/easy-guide.js`이며 기존 app의 상세 편집과 결정·파일·스냅샷을 공유한다. AC01/02/04/05/08/09/10/16/19/21/25/41/44/55/56/57/58/59/62/63은 `easy-guide.test.mjs`, 네 프로젝트 UI 조작과 파일 복원으로 추가 확인했다. [최신 UX 변경·검증](UX-1.2.md)과 [실제 데이터 근거](ux-scenarios.json)를 함께 본다. AC54 실제 초보 사용자 평가는 미수행이다.

`D`는 `tests/domain.test.mjs`의 데이터·상태 단위 검증, `S`는 `tests/server.test.mjs`의 실제 HTTP·SQLite·파일 검증, `B`는 실제 브라우저 조작, `V`는 저장한 화면을 직접 열어 본 시각 확인, `I`는 구현과 출력 문서 확인이다. 이는 실제 제품 디자인의 품질 평가나 초보 사용자 측정을 의미하지 않는다. `사용자 확인 필요`가 붙은 행은 해당 사람의 판단을 프로그램이 대신하지 않는다는 뜻이다.

| AC | 구현 위치 / 연결 | 수행한 검증과 상태 |
|---|---|---|
| AC01 | domain.newProject / app.createModal | D+B: 원문·최소 입력·미정 상태를 보존하며 생성 |
| AC02 | app.referenceView / createRegion | D+B: 원본·드래그 영역·일반 관찰 문장·직접 적용 기록 |
| AC03 | guide / assemble의 레퍼런스 절 | D+I: 보이지 않는 기능을 이미지 관찰로 만들지 않음 |
| AC04 | conceptView / chooseConcept | D: 한 방향만 확정해 진행할 수 있음 |
| AC05 | PALETTES / styleView / preview | D+B+V: 역할별 색·실제 한글·버튼 샘플. 최종 취향은 사용자 확인 필요 |
| AC06 | Region.target/purpose/keep/change | D+B: 특정 도구 영역에만 적용하는 문장이 프롬프트까지 유지 |
| AC07 | conceptExamples / mix-concept | D+V: 두 방향의 주인공·구성·서체·리소스 비교. 한 방향 허용 |
| AC08 | flowExample / graphIssues / flowGraphEditor | D+B+V: 반복 루프·확인 지점·실제 분기·복구·패널·다중 행동, 구매 필수 아님 |
| AC09 | flowExample('제작 도구') | D+B: 입력·선택·꾸미기·완료·편집 보존과 복구 |
| AC10 | ScreenState.actions / assemble | D+I: 여러 가능한 행동을 저장·출력 |
| AC11 | decision.source/status | D+B: 예시는 제안, 선택 전 확정하지 않음 |
| AC12 | confirmed / assemble | D: 제외 문장이 요구나 미정 목록에 혼입되지 않음 |
| AC13 | issues.explicit-conflict / ready | D: 같은 역할·범위의 다른 값 충돌 시 최종 생성 차단 |
| AC14 | structure.dependencyEdges / propagateImpact | D+B: 기능→흐름→화면→규칙·자료 및 수동 근거 연결을 따라 전파, 무관한 흐름과 옛 스냅샷 보존 |
| AC15 | issues.missing-reference/missing-file | D+S: URL만 있는 자료·누락 원본을 관찰 완료로 만들지 않음 |
| AC16 | upload / validateBackup / 오류 복구 | D+S+B: 잘못된 파일·백업·저장 실패에서 기존 결정과 입력 보존 |
| AC17 | resultModal의 버전 선택 / beginReview | D+B: 선택한 이전 스냅샷에 연결, 최신 편집 덮어쓰기 없음 |
| AC18 | snapshot.sections.decisionIds / trace | D+I: 문단별 결정 ID·당시 버전과 현재 편집 위치 연결 |
| AC19 | selectScope / assemble / makeSnapshot | D+S+B: 실제 선택 ID로 흐름·화면·리소스를 선별하고 고객 맥락·경계 연결·명시적 근거를 통합 문서에 반영 |
| AC20 | Content/Asset availability / bundle | D+S+B: 보유 파일·미확보 제작 계획·별도 제공 구분, 실제 바이너리 포함 |
| AC21 | output.extra / 재조립 | D+B: 추가 지시 원문이 재조립과 새 스냅샷에도 유지 |
| AC22 | backup / restore / SHA-256 | D+S+B: 데이터·원본·크롭·두 결과 파일·회차 참조 복원 |
| AC23 | snapshot.criteria / review.snapshotId | D+B: 당시 프롬프트와 고정 기준으로 비교 |
| AC24 | result.execution / review.scope | D+B+I: 스크린샷으로 동작 완료를 주장하지 않음 |
| AC25 | density / same p object | D+B: 가이드·빠른 편집이 같은 데이터와 조립 결과 사용 |
| AC26 | projects + files의 복합 키 | D+S+B: 다른 프로젝트 파일 조회 차단, 예시 프로젝트 분리 |
| AC27 | product/user/decisionMaker/value/doubt | D+B: 고객·의사결정자·제공 결과·의문을 별도로 저장·출력 |
| AC28 | fit / intent / reviewCriteria.fit | D+B+I: 적합성을 별도 기준으로 확인. 실제 적합성 판단은 사용자 확인 필요 |
| AC29 | ready / confirm-intent | D+B: 규칙 검사로 의도 확인 자동 완료하지 않음 |
| AC30 | snapshots / handoff / reviews 분리 | D+B: 출력만으로 디자인 검토 완료되지 않음 |
| AC31 | ReviewItem.expected/observation/evidence | D+B: 기대·실제 관찰·화면/영역 근거 저장 |
| AC32 | default verdict / reviewProblems | D+B: 자료 부족은 확인 불가, 자동 일치 없음 |
| AC33 | 복합 스타일·일관성 기준 | D+I: 색 하나로 종합 판정하지 않음. 실제 스타일 판단은 사용자 확인 필요 |
| AC34 | review.intent / finishReview | D: 의도 불일치·미확인일 때 완료 차단 |
| AC35 | plan.cause/target/change | D+B: 브리프·스타일·리소스·구현 원인과 수정 대상 구분 |
| AC36 | assemble({plan}) | D+B: 전체 맥락+불일치 근거+수정+유지+재검토가 새 통합본에 포함 |
| AC37 | finishReview / reviewProblems | D+B: 새 결과와 새 근거 없이 해결·완료로 전환하지 못함 |
| AC38 | parentReviewId / regression | D+B: 같은 기준 재사용·새 판정 초기화, 이전 일치 항목 회귀 표시 |
| AC39 | decision.history / baselineReason | D+I: 기준 변경 이유를 요구하는 새 기준 스냅샷, 과거 기준 보존 |
| AC40 | scope visual/behavior / held | D+B: 시각·동작·보류 분리. 실행 기록 없는 동작 완료 차단 |
| AC41 | entry → first tab / nextAction | D+B: 네 시작점 모두 실제 첫 입력과 구체적 행동으로 진입 |
| AC42 | next-banner / footer / handoff | B+V: 현재 상태·이유·결과·실제 행동 레이블 제공 |
| AC43 | unknown → example modal → original field | D+B+I: 모름에서 비교 예시를 보고 원래 작업으로 복귀 |
| AC44 | entry concept / add-concept | D+I: 기존 방향 한 개로 구체화, 재선택 강요 없음 |
| AC45 | issues → remedy / returnTo | D+B: 막는 이유와 관련 최소 보완 위치로 연결 |
| AC46 | 자유 탭 / same project data | D+B: 입력과 현재 가이드 맥락 유지 |
| AC47 | progress.returnTo/planDraft | B: 수정 계획 입력 → 스타일 보완 → 원래 검토 → 입력 이어쓰기 확인 |
| AC48 | SQLite / settings.lastProject / progress | S+B: 서버 재시작·새로고침 후 실제 위치와 다음 행동 복구 |
| AC49 | saveError / local draft / retry-save | S+B: PUT 요청 실패 주입, 입력 유지, 재저장과 재접속 후 값 확인 |
| AC50 | bundle / manual handoff / resultModal | S+B+I: 실제 자료·외부 전달 방법·결과 등록 위치 제공, 외부 진행률 없음 |
| AC51 | review → plan → revision-prompt | D+B: 선택한 차이에서 계획과 최신 통합본으로 직접 연결 |
| AC52 | result.snapshotId → plan → parentReview | D+B: 수정 결과에서 이전 기준과 문제로 연결 |
| AC53 | changed vs status / chooseConcept | D+B: 자동 저장은 확정 아님, 선택 후 갑작스러운 탭 이동 없음 |
| AC54 | 전체 가이드 UX | **확인 필요**: 실제 초보 사용자를 통한 독립 진행 관찰은 수행하지 못함 |
| AC55 | dependency-free startup | D+S+B: API 키·모델·계정 설정 없이 시작 |
| AC56 | assemble/review/plan local | B: 외부 요청 차단 상태에서 핵심 회차 완주, 외부 요청 0건 |
| AC57 | 명시된 일반 예시 provenance | D+B+V: 내장 문장을 이미지 자동 해석 결과로 표시하지 않음 |
| AC58 | conceptExamples / local samples | D+B+V: 외부 생성 없이 비교·편집·직접 확정 |
| AC59 | TEMPLATE_VERSION / assemble | D: 같은 확정 입력과 템플릿에서 같은 문서 재현 |
| AC60 | ReviewItem / manual verdict | D+B: 원본과 실제 결과, 판정·근거·수정을 직접 기록 |
| AC61 | app의 실제 실행 기능 | I+B: 바로 보내기·자동 피드백·API 키·연결 선행 조건 없음 |
| AC62 | manual result source / instruction | D+B: 직접 선택한 스냅샷과 실제 출처 기록, 내부 AI 응답 아님 |
| AC63 | local WOFF2/SVG / GUIDE_VERSION | S+B: 외부 네트워크 차단해도 필수 가이드·샘플·흐름 동작 |
| AC64 | contracts.d.ts / BOUNDARIES.md | I: 독립 조립·내보내기·수동 수신 경계, 미래 계약과 미확정 API 구분 |

## 읽어야 할 제한

자동 검증은 스타일의 적합성이나 실제 고객 의문 해소를 증명하지 않는다. UI 검증의 결과 이미지에는 이 앱의 화면을 **QA 픽스처**로 명시해 사용했다. 외부 제작 도구로 실제 게임·사진 서비스를 만들고 전문 디자인 리뷰를 수행한 것으로 해석하면 안 된다.

1.1에서는 명시한 문서·데이터·서체·SVG·ZIP·일부 게임 리소스의 원본 저장·내보내기·복원을 지원한다. 지원 목록 밖의 형식은 ZIP 또는 별도 제공 계획을 사용한다. 분기 검사와 관계 기반 변경 영향·범위 선별의 상세 근거는 [보완 기록](EXTENSION.md)을 확인한다. 실제 초보자 검토(AC54), 전체 보조기기·브라우저·OS 검증, 현실의 큰 데이터로 장기 운영 확인은 남아 있다.
