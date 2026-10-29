# Atelier 통합 계약 v1 — 단계별 구현과 목표

상태: **0단계 목표 계약이며 전체가 구현된 것은 아니다.** 2단계 도메인, 3단계 저장소·수동 WS·legacy 백업/ZIP, [4단계 수동 React 작업실](STAGE4_IMPLEMENTATION.md), [5단계 읽기 전용 제안](STAGE5_IMPLEMENTATION.md)을 구현했다. 실제 지원 필드·한도·검증과 차이는 각 단계 기록을 따른다. 5단계는 brief/flow/concept/style과 기존 대상의 후보 편집/제외/명시 적용, proposalVersion과 ai.interrupt를 지원한다. review 목적·skillPath·binding/generation/artifact·통합 AI 백업·제작 어댑터는 계속 후속 제안이다. 기준선은 [0단계](STAGE0_BASELINE.md), 유지 대상은 [기능 보존표](FEATURE_PRESERVATION.md)에 있다.

가이드의 `atelier.file.begin/chunk/commit/read` 초안은 이 계약에서 **범용 `atelier.transfer.*`**로 정리한다. 파일뿐 아니라 90MiB 백업·ZIP·긴 snapshot도 같은 제한된 전송 경로를 사용하기 위해서다. 기존 메시지 이름은 변경하지 않는다.

## 1. 적용 순서와 소유 경계

| 결정 | 적용 단계 | 계약 |
|---|---|---|
| 공통 셸 | 1 | Atelier 디자인, 기존 일반 작업·결과·픽셀·활동·전역 승인 연결. 미구현 설계 메뉴는 준비 상태 |
| 순수 도메인 | 2 | shared/atelier TypeScript로 이식. DOM·DB·App Server에 의존하지 않음 |
| Node·저장·WS | 3 | 최소 Node 22.13+, 내장 SQLite, 별도 설계 저장소, bounded WS 전송. 실제 지원 버전은 기존 잠금 파일 제약도 충족 |
| 수동 설계 UI | 4 | 네 시작점·여덟 탭·확정·조립·내보내기·수동 검토 전체 완성 |
| 제안 실행 정책 | 5 | 서버 소유 readOnly 정책, 별도 후보·선택 적용 |
| 제작 실행 | 6 | 기존 실행 진입점·스케줄러·승인·이력 공유 |
| 결과·수정 | 7 | 실제 산출물 검증·원본 기준 검토·새 요청으로 수정 |

최종 프로세스는 `React → WS 127.0.0.1:4781/ws → Node bridge → App Server stdio`다. 개발 UI 4780, 프로덕션 정적 UI 4781을 유지한다. Atelier 4317이나 새 HTTP CRUD 서버를 실행하지 않는다. 기존 정적 파일/health는 유지하되 사용자 첨부·DB·history·생성 HTML을 public/dist에 두지 않는다.

기존 useBridge의 WS 연결을 공유하고 모든 일반/설계 실행에 하나의 서버 admission lock을 적용한다. 여러 창은 동일 로컬 사용자의 관찰 클라이언트이며 로그인/다중 테넌트 서비스를 새로 도입하지 않는다. 이 조건에서도 다른 프로젝트 ID·파일 소유·실행 귀속 검증은 필수다.

## 2. 식별자·버전·불변성

### 2.1 식별자

신규 서버 생성 ID는 `<prefix>_<uuid>`를 사용한다. 도메인에서 가져온 legacy ID는 기존 `validId` 규칙 `^[a-z]+_[a-z0-9-]{1,80}$`와 참조 검증으로 수용한다. 사용자 지정 파일명·경로로 ID를 만들지 않는다.

| ID | 용도 / 생성 주체 |
|---|---|
| designProjectId | 설계 프로젝트, p_ prefix, 서버 또는 검증된 legacy import |
| bindingId | 설계·코드 workspace·대화 연결, bind_ prefix, 서버 |
| proposalId / generationId | AI 후보 요청 / 실제 실행 추적, prop_ / gen_, 서버 |
| snapshotId / resultId / reviewId / planId | 기존 Atelier 식별자 의미 보존 |
| conversationId | 기존 Auto-Codex 대화 ID 그대로. 새 형식을 강요하지 않음 |
| runId/taskId/agentId | Team 스케줄러가 실제로 만든 값만 참조 |
| threadId/turnId | App Server가 실제로 반환한 값만 참조 |
| transferId / fileId | 임시 전송 / 커밋된 파일, up_ / file_, 서버 |
| clientRequestId / idempotencyKey | 클라이언트가 생성한 UUID. 요청 상관 / 실행 중복 방지 전용 |
| approvalId | 기존 서버 pending map 키. 위 식별자와 대체·공유하지 않음 |

binding에는 `designProjectId, canonicalWorkspacePath, conversationId, version, createdAt`를 저장한다. canonicalWorkspacePath는 기존 project.select와 브리지 realpath/stat 검증으로만 결정한다. browser patch/import로 cwd·writableRoots·승인 권한을 설정하지 못한다. binding 변경은 새 버전이며 진행 중 generation의 연결은 고정한다.

### 2.2 버전과 고정 입력

- project.version: 저장 성공마다 증가하는 optimistic concurrency 토큰.
- project.revision: 설계 의미 변경에 따라 증가, 사용자 의도 확인과 제안 입력의 기준.
- Decision.version / graph.version·reviewedVersion: 기존 변경 영향·사용자 확인 의미 유지.
- schemaVersion=1 / modelVersion=2 및 guide/template/common 버전: 도메인 버전으로 유지.
- SQLite `PRAGMA user_version`: 저장소 마이그레이션 버전. 위 버전과 구분.
- transport v=1 / 실행 manifest contractVersion=1 / 통합 백업 version=1: 새 계약별 독립 버전.

기존 PromptSnapshot의 `input/text/criteria/sections/decisions/selection/output/referenceFileIds`를 변경하지 않는다. hash 대상은 정규화 JSON(UTF-8, 객체 키 정렬, 배열 순서 유지, 생략값 제외)과 실제 파일 byte다. snapshot 텍스트 해시는 UTF-8 원문에 대해 계산한다. 실행 시 hash·참조 파일·범위를 다시 확인한다.

## 3. WS 프레임과 요청/응답 스키마

### 3.1 새 요청 envelope

다음은 명세용 TypeScript 표기이며 실행 코드가 아니다.

```ts
type AtelierRequest<T extends string, P> = {
  type: T;                   // 아래 허용 목록 중 하나
  v: 1;
  clientRequestId: string;    // UUID, 최대 64자
  payload: P;                // 타입별 엄격한 객체, 추가 필드 거부
};
type MutationTarget = {
  designProjectId: string;
  expectedVersion: number;   // >= 1 정수
};
type AtelierResponse = {
  type: 'atelier.response'; v: 1; clientRequestId: string;
} & (
  | {ok: true; result: unknown; projectVersion?: number}
  | {ok: false; error: {code: ErrorCode; message: string;
      retryable: boolean; currentVersion?: number}}
);
```

실제 result는 요청 type별 판별 union으로 구현한다. `unknown`은 wire 결과가 무검증이라는 의미가 아니다. projectVersion/currentVersion은 해당 프로젝트 값이며 오류에 내부 경로·SQL·스택·자료 원문을 넣지 않는다.

추가 서버 이벤트:

```ts
type AtelierEvent = {
  type: 'atelier.project.changed' | 'atelier.proposal.ready'
      | 'atelier.generation.state';
  v: 1;
  serverEpoch: string;       // 프로세스 부팅마다 새 UUID
  seq: number;              // epoch 내 증가, 권한·성공 증거로 사용하지 않음
  designProjectId: string;
  payload: unknown;         // 해당 ID·version·최소 상태만; 원본 파일/전체 대화 없음
};
```

`bridge.state`, `conversation.state`, `run.state`, `activity.event`, `approval.*`, `assistant.text`, `token.usage` 등 기존 이벤트는 그대로 유지한다. 새 UI는 기존 서버에 atelier 요청을 보내지 않고 `atelier.capabilities` 조회 성공 후 기능을 활성화한다. 구형 서버는 기존 unknown message 오류를 반환할 수 있으며 UI는 미지원으로 표시한다.

### 3.2 공통 검증과 오류

JSON UTF-8·추가 필드 거부·타입·정수·문자열 길이·배열 수·목적 enum·소유 관계를 서버에서 검사한다. payload가 array/null이면 거부한다. 문자열 byte 상한은 UTF-8 기준이다.

| 제한 | v1 기본값 |
|---|---|
| WS maxPayload | 1MiB. 기존 큰 결과도 잘라 보내도록 호환 경로를 구현한 뒤 적용 |
| 일반 제어 envelope | JSON 직렬화 전체 256KiB 이하 |
| ID 배열 | 요청당 256개 이하; 대량 읽기는 pagination |
| 한 화면의 텍스트 필드 | 32KiB 이하, 전체 제어 envelope 제한도 적용 |
| page limit | 기본 32, 최대 64; cursor는 서버 검증 opaque 값 |
| 제어 rate | 연결당 token bucket 60회/분, burst 20; 서버 전체 제한 병행 |
| 승인/중단 | 별도 우선 제어 경로, bucket 10회/초. 소속/pending 검증은 그대로 |

기존 assistant.text·conversation.state를 단순 1MiB 설정으로 끊으면 기능 손실이다. 큰 transcript·snapshot은 page 또는 transfer로 전달하고 기존 클라이언트 호환 방식을 검증한다. 정규화 이벤트에 대용량 byte를 넣지 않는다. 승인/중단을 파일/AI 장기 작업을 await하는 전역 queue 뒤에 묶지 않는다. 단, 이미 시작한 짧은 원자 저장을 강제로 깨지는 않는다.

ErrorCode 허용 목록: `INVALID_MESSAGE`, `UNSUPPORTED_VERSION`, `NOT_FOUND`, `PROJECT_MISMATCH`, `VERSION_CONFLICT`, `STALE_INPUT`, `IMMUTABLE_SNAPSHOT`, `INVALID_SELECTION`, `FILE_MISSING`, `HASH_MISMATCH`, `LIMIT_EXCEEDED`, `TRANSFER_EXPIRED`, `TRANSFER_SEQUENCE`, `BUSY`, `WORKSPACE_INVALID`, `READ_ONLY`, `CAPABILITY_UNAVAILABLE`, `IDEMPOTENCY_CONFLICT`, `RUNTIME_UNAVAILABLE`, `RUNTIME_OUTCOME_UNKNOWN`, `STORAGE_UNAVAILABLE`, `INTERNAL_ERROR`.

내용 오류는 보통 retryable=false, BUSY와 일시 연결/저장 오류는 조건에 따라 true다. true도 자동 실행 허가가 아니다. `VERSION_CONFLICT`는 최신 version과 입력 보존 안내만 반환한다. 기존 error/approval 오류와 새 code를 혼동하지 않는다.

### 3.3 요청 허용 목록

`P`는 designProjectId, `V`는 expectedVersion, `E`는 서버 생성 entity ID다. 별도 언급이 없는 mutation은 P/V를 필수로 받는다.

| type (atelier. 뒤) | payload의 필수/선택 필드 | 결과와 서버 제약 |
|---|---|---|
| capabilities | `{}` | v1 지원 operation·limit·AI 가능 여부. 실제 미구현은 false/목록 제외 |
| project.list | `{cursor?,limit?}` | 프로젝트 요약 page; 전체 JSON 미반환 |
| project.create | `{name,idea,entry,type}` | name 1~120자, idea 32KiB, entry=idea/image/concept/improve, type은 검증된 제품 유형. 서버가 초기 도메인 생성 |
| project.load | `{P}` | meta·revision/version·현재 progress/settings·각 entity 요약·counts |
| project.update | `{P,V,patch}` | name/idea와 허용된 output/settings/progress 필드만. ID·snapshot·결과·이력·generation 직접 patch 금지 |
| entity.list | `{P,kind,cursor?,limit?}` | kind=fields/features/contents/flows/screens/references/regions/concepts/styles/assets/results/reviews/plans/snapshots. snapshot은 요약만 |
| entity.mutate | `{P,V,kind,action,entityId?,value?,order?}` | 아래 도메인 명령에 한정; history·version·소유·서버 ID는 클라이언트 지정 불가 |
| intent.confirm | `{P,V,revision,choice:'match',reason}` | 해당 revision에 대한 사용자의 의도 확인. AI 요청이 호출할 수 없음 |
| snapshot.create | `{P,V,mode:'final'|'baseline'|'revision',reason?,planId?}` | final은 ready/intent 검사, baseline은 이유 필수·draft, revision은 confirmed plan 필수 |
| snapshot.read | `{P,snapshotId}` | 고정본 요약·hash·전체 JSON download transfer |
| binding.set | `{P,V,conversationId}` | 현재 선택한 검증 workspace와 같은 대화만 연결. 입력 path 없음; 실행 중 변경 거부 |
| file.list | `{P,cursor?,limit?}` | metadata·exists, 실제 경로는 반환하지 않음 |
| file.read | `{P,fileId}` | 해당 프로젝트의 실제 byte 존재/해시 확인 후 download transfer 발급 |
| backup.export | `{P,format:'atelier-backup'|'auto-codex-atelier-backup'}` | 일관된 snapshot의 byte download transfer |
| backup.import | `{transferId}` | 커밋된 restore-purpose byte를 완전 검증하고 새 프로젝트 생성; 원본 불변 |
| bundle.export | `{P,snapshotId}` | ID 명시 필수, 미존재 ID면 NOT_FOUND. 최신 버전 fallback 금지 |
| settings.get/update | `{}` / `{expectedVersion,patch}` | UI 공통 기본값만. 신뢰·네트워크·cwd·승인·실행 명령 설정 불가 |
| ai.propose | `{P,V,revision,purpose,targetIds,model?,effort?,skillPath?,idempotencyKey}` | purpose=brief/flow/concept/style/review; 서버 readOnly, targetId 검증; proposal/generation 반환 |
| proposal.apply | `{P,V,proposalId,candidateIds}` | 해당 프로젝트·요청 revision·대상 version을 재검증, 선택 값만 proposed로 반영 |
| generation.start | `{P,V,snapshotId,bindingId,purpose:'create'|'revise',planId?,executionMode,model?,effort?,skillMode,skillPath?,idempotencyKey}` | final/revision 고정본만 제작, 실제 선택 모델/스킬·잠금·경로 검사 |
| generation.get | `{P,generationId}` | 상태·실제 runtime IDs·입력/결과 manifest 요약 |
| generation.interrupt | `{P,generationId}` | 현재 active generation 일치 시 기존 interruptTurn 호출; 타 작업 중단 금지 |
| result.register | `{P,V,snapshotId,generationId?,fileIds?,execution?,source,environment,screen,note?,keep?}` | 파일 소유·실제 근거 검사. generation 있으면 스냅샷 일치; 없으면 수동 결과 |
| review.start/update/finish | `{P,V,resultId,scope}` / `{P,V,reviewId,patch}` / `{P,V,reviewId}` | beginReview, 항목별 관찰/근거/판정/의도만 patch, finishReview 규칙 적용 |
| plan.create/update/confirm | `{P,V,reviewId,fields}` / `{P,V,planId,fields}` / `{P,V,planId}` | createPlan의 선택 itemIds·change/keep/check 등 검사; 확인은 사용자 동작 |
| project.delete | `{P,V,confirmation:{projectId:P}}` | 기존 명시적 삭제 의미 보존. active generation/transfer 있으면 BUSY. 다른 코드 폴더·대화·공유 파일 삭제 금지 |

`project.update.patch` 허용 경로: name, idea, output의 purpose/format/scope/selection/tech/extra/common/commonVersion/procedure/procedureSource/language, settings.density, progress의 tab/guideStage/returnTo 및 검증된 편집 초안. progress나 extra 속의 문장은 실행 권한이 아니다.

`entity.mutate.action`은 add/patch/remove/reorder/confirm/exclude/acknowledgeGraph/selectConcept/applyPalette. fields는 기존 key만 patch/confirm/exclude, 새 field key 생성 금지. 각 kind는 원본 도메인의 편집 필드 allowlist와 버전 있는 스키마로 검사한다. references/regions/flows의 파일·좌표·graph·선택 관계를 검증하고, 결과·검토·계획·snapshot은 전용 명령만 쓴다. 파일 업로드와 결정 확정은 분리한다. 명령 실행·권한·DB raw query·임의 JSON Patch path·history 직접 편집은 허용하지 않는다.

수동 스키마의 세부 entity 필드는 2단계 이식 시 원본 validateProject 및 실제 editor 필드와 일대일로 옮겨 명세/검증표를 완성한다. 이 표를 모든 entity patch가 이미 안전하게 구현됐다는 근거로 쓰지 않는다.

## 4. transfer/chunk 계약

### 4.1 요청과 소유

모든 전송은 같은 envelope를 사용한다. base64는 canonical 인코딩인지 검사하고 decoder의 관대한 잘못된 문자 허용에 의존하지 않는다.

| type | payload | 응답 |
|---|---|---|
| transfer.begin | `{direction:'upload',purpose:'file'|'backup-import',P?,fileRole?,name,totalBytes,sha256}` | transferId·chunkBytes·expiresAt·nextIndex=0 |
| transfer.chunk | `{transferId,index,dataBase64}` | 기록 완료 후 nextIndex·receivedBytes |
| transfer.finish | `{transferId}` | 실제 총량·해시·형식 확인 후 file metadata 또는 committed restore handle |
| transfer.read | `{transferId,index}` | download 전용 chunk·index·last·총량/해시; 요청은 1개씩 |
| transfer.abort | `{transferId}` | 임시 byte 정리·전송 만료; 사용자 원본은 보존 |

fileRole=image/reference/crop/result/asset/content. reference/crop/result/image는 실제 PNG/JPEG/WebP 검사, 나머지는 기존 resource-types의 허용 형식·원본 byte 검증을 사용한다. crop은 결정에 연결할 때 해당 원본과 유효 좌표를 추가 검사한다.

전송 handle은 **서버 메모리의 연결·프로젝트·목적·방향**에 묶인다. ID를 다른 소켓·프로젝트·용도에 사용하면 거부한다. 재연결은 새 전송으로 시작하고 이전 미완료 byte는 정리한다. 완료된 fileId는 정상 프로젝트 소유 검사 후 새 연결에서도 읽을 수 있다. file read/download handle은 별도 `file.read {P,fileId}` 요청에서 발급한다.

### 4.2 크기·순서·자원·오류

- raw chunk 256KiB, base64 포함 envelope는 1MiB 이하. 일반 256KiB 제어 제한의 명시적 예외는 transfer.chunk와 해당 download 응답뿐이다.
- 파일은 1byte~15MiB. 백업 import/export JSON **전체 직렬화**는 90MiB 이하이며 내부 파일 각각도 15MiB 이하. base64 팽창을 포함해 계산한다.
- ZIP은 기존 선택 파일 기능을 줄이지 않도록 백업 90MiB 제한을 그대로 적용하지 않는다. 사전 산정한 manifest·파일 총량과 ZIP 포맷의 32bit 경계를 검사한다. 기존 ZIP writer의 한계를 넘는 요청은 생성 전 LIMIT_EXCEEDED로 설명한다. 전체 메모리 복사 대신 spool/stream을 쓴다.
- 연결당 전송 2개, bridge 전체 8개. 전송당 동시 미확인 chunk 1개, 기록 완료 ACK 이후 다음 index. index는 0부터 연속 정수다. 중복·건너뛰기·길이/총량 불일치면 거부하고 다시 시작한다.
- 전송은 무진행 60초·전체 15분에 만료한다. 만료·연결 종료·중단은 같은 handle을 재사용할 수 없다. 진행 중 byte는 서버가 생성한 전용 temp 위치에 `wx`로 쓴다.
- chunk rate는 연결당 32개/초, backpressure high-water 1MiB·low-water 256KiB. bufferedAmount가 줄기 전 다음 chunk를 전송하지 않는다. 승인/중단은 동일 byte queue에 오래 묶지 않는다.
- 시작 시 목적별 총량·여유 공간을 예약한다. 프로젝트의 기존 파일 총량은 임의로 줄이지 않되 신규 전송은 disk budget 부족 시 명확히 거부한다. 임시 총량 상한은 동시 handle의 검증된 예약량 합계다.
- raw 저장 성공 → 총량/hash/type 검증 → 파일 rename → DB file row 등록 순서다. 중간 실패 시 참조되지 않은 파일을 journal로 추적하고 정리한다. DB에 존재하지만 byte가 없는 결과는 성공으로 반환하지 않는다.

일반 file.transfer 완료는 파일 등록만 의미한다. 프로젝트 revision에 연결하는 동작은 별도 mutation/V 검사다. 전송 완료 사이 프로젝트가 바뀌어도 다른 프로젝트 파일로 등록하지 않는다.

## 5. SQLite·파일·기존 기록 계약

### 5.1 위치·논리 테이블

```text
.local-data/history.json                    기존 archive v1, 그대로
.local-data/atelier/atelier.sqlite          설계 저장소
.local-data/atelier/files/<P>/              커밋된 원본 byte
.local-data/atelier/transfers/<server-id>/   임시 수신/내보내기
<workspace>/.auto-codex/atelier-inputs/<G>/   제작 시 선택 파일 staging
```

경로는 서버가 결정한다. 심볼릭 링크/junction·canonical root 경계는 기존 ConversationStore 기준 이상으로 검증하고 파일 열기/rename/정리 시 다시 확인한다. staging은 사용자가 선택한 workspace 안에서만 만들며 기존 이름을 덮어쓰지 않는다. 생성한 파일 목록과 경로 검증을 거쳐서만 정리한다. 복원 데이터가 staging/transfer 디렉터리 위치를 지정하지 못한다.

| 테이블 | 주요 키·내용·무결성 |
|---|---|
| projects | id PK, version/revision/schema/model/updated/json. 원본 설계의 저장 단위 유지 |
| revisions | (project_id,version) PK, 이전 JSON. 과거 snapshot 불변 |
| files | (project_id,id) PK, name/mime/ext/hash/size, 검증된 원본 byte만 |
| settings | key PK, version/json. 공통 UI 기본값만 |
| bindings | id PK, project_id·canonical path·conversation_id·version |
| proposals | id PK, project_id·base_revision·target_versions·generation_id·후보/근거/state |
| proposal_applications | proposal/candidate/decision/version 연결. Decision.source는 external을 사용하고 구체 AI 출처는 별도 보존 |
| generations | id PK, project_id·binding/snapshot·purpose·state·idempotency·inputHash·runtime IDs·time/error |
| artifacts | (generation_id,id) PK, 상대경로 또는 file_id·hash·kind·생성/변경·검사 근거 |
| operations | id PK, 준비/외부 dispatch/commit 단계, 연결 복구·고아 파일 정리 journal |

SQLite에는 WAL·foreign_keys·busy timeout(5초)을 설정하고 짧은 transaction으로 변경한다. project mutation은 `UPDATE ... WHERE id=? AND version=?`가 1행인 경우만 성공한다. snapshot·결과·검토 관계와 기존 snapshot 불변은 클라이언트 전체 JSON 비교만으로 맡기지 않는다. 실행 중 생성 상태 업데이트와 사용자 편집의 version 충돌을 처리하고 상태 이벤트에 서버 version을 붙인다.

동기 SQLite는 제한된 짧은 쿼리에 사용한다. 파일 인코딩·압축·대형 JSON validation을 긴 DB transaction이나 WS 제어 큐 안에서 실행하지 않는다. 쿼리 지연·동시 쓰기를 테스트하고 필요 시 저장소 worker로 격리한다.

### 5.2 SQLite와 history의 연결

대화 archive v1을 수정하거나 임의 metadata를 끼워 넣지 않는다. 디자인↔대화 관계는 새 DB bindings/generations가 소유한다. 기록만 있고 연결이 없으면 일반 대화로 열고, 연결만 있고 대화가 없으면 `context unavailable`로 표시한다.

원자 커밋은 두 저장소에 걸쳐 존재하지 않는다. 실행 시작은 다음 순서를 따른다.

1. 전역 admission lock 획득 → project/binding/version/cwd/capability 검증.
2. DB에 generation+inputManifest+idempotency reservation을 `preparing`으로 영속화한다.
3. 기존 대화 기록의 사용자 요청·해당 응답 자리를 생성하고 정상 저장을 기다린다. DB에 conversation/message 연결과 `dispatching` 의도를 기록한다.
4. App Server 요청 → 실제 thread/turn 반환 즉시 DB 연결 → 기존 이벤트 경로로 추적한다.
5. 종료 후 원래 대화 결과 저장과 generation 상태를 journal 단계별로 커밋한다. 일부 저장 실패 시 실행 결과와 저장 실패를 구분한다.

3~4 사이에 프로세스가 죽으면 App Server가 요청을 받았는지 불확실할 수 있다. **이 구간의 exactly-once 실행은 보장할 수 없다.** journal의 dispatching은 복원 시 `RUNTIME_OUTCOME_UNKNOWN`/interrupted로 표시하고 자동 재전송하지 않는다. 실제 지원 API로 상태를 확인할 수 있을 때만 조정한다. 사용자의 명시적 재시도는 새 generation과 키를 사용하며 이전 요청을 가리킨다.

idempotency key는 `{P,purpose,snapshotId/inputHash,bindingVersion,model/effort/skill 선택}`의 정규화 해시에 묶는다. 같은 키·내용은 기존 generation을 반환하고, 같은 키·다른 내용은 IDEMPOTENCY_CONFLICT다. 실행 중 누적 이벤트나 재접속은 새 작업을 만들지 않는다. key→generation 보존은 DB generation 기록의 수명과 같다.

## 6. 목적별 실행·승인 정책

현재 startTurn은 프로젝트 Solo=workspaceWrite이고 design task kind도 write다. 이를 제안 실행에 그대로 사용하지 않는다. 공통 시작/검증/이력 처리를 실행 서비스로 분리하되 기존 turn.start 동작은 유지한다.

| 목적 | sandbox·입력 | 동작 제약 |
|---|---|---|
| brief/flow/concept/style/review 제안 | readOnly, networkAccess=false, 필요한 설계 텍스트·선택 근거. outputSchema 지원 확인 | 단일 읽기 요청부터 구현. 계획에서 design kind로 변환해 write로 승격 금지 |
| create/revise 제작 | 검증 workspace의 workspaceWrite, networkAccess=false, 고정 snapshot/manifest/staging | 기존 Team/Solo·on-request 승인·스케줄러 공유 |
| Team coordinate/research/report | 기존 readOnly 정책 | 최대 8 tasks, 동시 read 최대 3 |
| Team design/implementation/verification/integration | 기존 workspaceWrite 정책 | 다른 active task와 쓰기/검증 독점 |
| 기존 폴더 없는 조사 | 기존 readOnly·명시적 network 선택 | 일반 작업의 기존 기능 유지. 설계 제안에 그 네트워크 설정을 자동 상속하지 않음 |

readOnly는 파일 쓰기를 제한하지만 모든 읽기 전용 명령 실행까지 금지한다는 뜻은 아니다. 첫 제안 MVP는 텍스트/구조화 응답만 요청하며, 불필요한 도구 사용을 제한할 수 있는 실제 App Server 기능을 확인한다. 지원하지 않는 no-tools 옵션을 만들어 전송하거나 “도구 사용 불가능”이라고 표시하지 않는다. 권한 확대 요청이 제안 목적과 충돌하면 서버 정책으로 거부하고 이유를 표시한다.

브라우저는 sandbox·command·permissions·writableRoots를 전달하지 못한다. 모델 출력·첨부·proposal.apply는 승인 resolver를 호출할 수 없다. 승인 UI는 기존 approvalId와 decision만 보내고 서버가 pending 요청·프로토콜·요청된 subset을 검증한다. 한 번 응답한 ID·다른 요청 ID·재시작 전 ID는 거부한다.

전역 잠금은 일반 turn.start와 신규 generation/ai.propose 모두의 admission을 보호한다. Team 내부 read 병렬만 허용한다. 준비 단계 실패 시 lock/reservation을 해제하고 명확한 오류를 남긴다. `waitingApproval`은 active이며 다른 실행을 시작하지 않는다. 탭 이동·모달 닫기·WS 재연결은 실행 명령이 아니다.

스킬은 현재 enabled 목록과 실제 사용자 선택/결정적 라우팅 결과로만 전달한다. 없으면 일반 에이전트다. 모델/effort/image modality/structured output 지원을 검사하고 지원하지 않으면 CAPABILITY_UNAVAILABLE로 설명한다. 별도 외부 이미지 API·임의 모델 fallback을 추가하지 않는다.

## 7. 제안·실행·결과 상태 계약

### 7.1 제안

AIProposal 필수값: `id,P,generationId,purpose,baseRevision,targetVersions,candidates,assumptions,createdAt,state`.

candidate 필수값: `id,targetId,field,value,rationale,evidenceIds`. 허용된 target/field만 받고 evidenceIds는 해당 프로젝트의 실제 결정·파일/영역을 참조한다. 출력 JSON을 eval·HTML·명령으로 실행하지 않는다. 자유 문장은 근거가 확인된 관찰과 모델 추론을 구분한다.

state는 pending → ready/failed/interrupted, ready → partiallyApplied/applied/dismissed/stale이다. 적용 전 baseRevision과 각 target version을 확인한다. 편집이 바뀌었으면 STALE_INPUT과 비교 화면을 주고 자동 병합하지 않는다. 선택 항목 적용은 updateDecision을 거쳐 proposed/source=external로 저장하고 별도 AI 출처를 연결한다. 사용자 confirm에서만 confirmed가 된다. 요청 실패 시 내장 예시를 AI 성공으로 대체하지 않는다.

### 7.2 generation

```text
preparing → dispatching → running ↔ waitingApproval
     │             │         ├→ completed
     └→ failed     │         ├→ failed
                   │         └→ interrupted
                   └→ interrupted + outcomeUnknown (복원 시)
```

정상 취소는 준비/전송/실행 상태에 따라 staging 취소 또는 기존 turn.interrupt로 처리한다. 터미널 상태를 다시 running으로 바꾸지 않는다. 재시도는 새 generation이다.

completed는 **실제 런타임 종료 완료**이며 산출물이나 품질의 보장은 아니다. 별도 verification 상태를 둔다.

- artifactStatus: pending / verified / partial / missing / unverifiable.
- checks: 명령·환경·대상 artifact hash·exitCode 또는 notRun·관찰 기록. 모델이 “테스트 완료”라고 적은 문장만으로 passed를 만들지 않는다.
- designReview: 기존 review.state와 visual/behavior 범위. AI 제안과 사용자의 판정을 구분한다.

진행 이벤트에는 generationId/P/snapshotId와 실제 runtime 연결을 사용한다. Solo에는 runId/taskId를 만들어 넣지 않는다. 현재 RuntimeRegistry의 Team 컨텍스트를 generation 연결 표와 결합하고 turn ID를 우선한다. 소속을 알 수 없는 이벤트는 진단/오류로 남기고 현재 화면의 최신 결과로 임의 귀속하지 않는다.

### 7.3 입출력 manifest와 검토

InputManifest는 `contractVersion,P,snapshotId,snapshotHash,decisionVersions,selection,files[{id,hash,size,role}],bindingVersion,model/effort/skill,createdAt`를 고정한다. 프로젝트 내 기존 자료를 의미상 필요한 범위만 선별하며 전체 대화·환경·설정 디렉터리는 첨부하지 않는다.

ArtifactManifest는 `generationId,P,snapshotId,files[{id,relativePath?,fileId?,hash,size,kind,change:'created'|'modified'}],checks,limitations`를 저장한다. 서버가 실제 path·root·byte/hash를 확인한 항목만 verified다. 파일을 썼다는 item 이벤트도 최종 내용·존재 검증의 대체가 아니다. Git 없는 프로젝트도 지원하고 결과 수집을 위해 무조건 git init을 실행하지 않는다.

Result는 원래 snapshotId/generationId에 연결한다. 기존 수동 image/execution 결과를 유지하면서 여러 실제 파일의 결과 근거를 별도 manifest로 확장한다. 이미지가 없으면 시안 이미지를 만들었다고 표시하지 않는다. 스크린샷은 동작 검증이 아니며 실행 근거 없는 동작 판정은 unverifiable이다.

revision 계획은 기존 result/review/snapshot/selection·변경 목표·유지 조건·재확인 기준을 고정한다. 새 generation 결과의 판정은 초기화하고 이전 match는 회귀 검사 대상으로 유지한다. 자동 반복 제작·배포를 추가하지 않는다.

## 8. 백업·가져오기·복구

### 8.1 호환 포맷

기존 백업 한 개는 설계 프로젝트 한 개다. handoff.json은 복원 백업으로 거부한다. 기존 `atelier-backup` version 1은 validateBackup·byte/hash/type/참조 검증 후 새 P로 가져오며 원본 DB를 열지 않는다.

신규 통합 포맷은 명시적으로 다음과 같이 구분한다.

```text
format: auto-codex-atelier-backup
version: 1
exportedAt: ISO UTC
legacy: {format: atelier-backup, version: 1, exportedAt, project, files}
integration: {proposals, proposalApplications, generations, artifacts}
```

legacy의 결정·스냅샷·결과 내부 구조와 파일 해시는 유지한다. integration의 참조는 원래 project ID와 실제 legacy entity ID에 일치해야 한다. 백업에 workspace path·대화 원문·pending 승인·trust·network grant·현재 App Server 세션 권한을 포함하지 않는다. history.json은 자체 보존/복구 대상이며 통합 설계 백업으로 덮어쓰지 않는다.

구형 포맷 export는 새 데이터가 legacy로 손실 없이 표현되는 프로젝트에만 제공한다. 코드 중심 결과/다중 산출물/AI 연결 등 표현 불가능한 데이터가 있으면 누락 목록과 통합 백업 안내를 주고, 조용히 정보 일부를 버린 성공 백업을 만들지 않는다. 기존 프로젝트의 legacy export/import 기능은 계속 제공한다.

### 8.2 복원 절차

1. 제한된 byte 전송과 JSON/version/중복 ID/소유/관계/hash/type를 모두 검증한다.
2. 새 P와 비공개 temp 파일 영역을 만든다. legacy 내부 ID는 프로젝트 namespace에서 유지한다.
3. proposals/generations 등 bridge 전역 ID는 새로 발급하고 내부 참조를 매핑한다. 원래 ID는 비실행 provenance로만 남긴다.
4. 모델 출력·기록을 실행 지시로 재해석하지 않는다. runtime IDs는 역사 정보이고 active registry·idempotency 예약·승인에 다시 등록하지 않는다.
5. staging 완료 후 단일 DB transaction으로 프로젝트·관계·파일 row를 커밋한다. 실패 시 새 임시 영역만 검증 후 정리하고 기존 프로젝트는 보존한다.
6. binding은 detached로 시작해 사용자가 workspace·대화를 다시 연결한다. 진행 중 generation은 interrupted, 완료 기록은 historical로 표시하되 파일 검증 상태를 다시 확인한다.

### 8.3 스키마 마이그레이션과 복귀

- 앱 시작 시 Node 최소 버전·node:sqlite 기능을 실제 검사하고 실패 메시지를 제공한다. Node 22.13.0 자체 검증은 별도 필요하다.
- 설계 저장소 오류는 STORAGE_UNAVAILABLE로 격리한다. Codex/디자인 한쪽 실패가 다른 쪽 일반 UI 부팅을 차단하지 않게 한다.
- DB migration은 user_version 확인 → 실행/전송 정지 → 일관된 SQLite 백업+파일 보존 → transaction 적용 → FK/hash/참조 검사 → 새 기능 활성화 순서다. 지원하지 않는 더 높은 DB 버전은 수정하지 않는다.
- WAL DB 본체만 복사하지 않는다. 안전한 SQLite 백업 또는 연결 종료·체크포인트를 사용하고 실제 복원 fixture로 증명한다.
- 재시작은 transfers 정리·journal 조정·진행 상태 interrupted·pending/trust/network 미복원이다. 자동 resume/retry는 기존 Solo 대화의 새 사용자 요청 흐름 외에는 추가하지 않는다.
- UI 복귀는 기능 토글/이전 셸을 통해 제공한다. 데이터 downgrade를 자동 실행하지 않는다. 버전이 맞는 앱과 일관된 백업으로 복구하고 history와 사용자 코드 변경은 별도로 보존한다.

## 9. 위협 분석과 구현 시 필수 증거

| 입력/오용 | 방어 계약 | 구현 후 필수 검사 |
|---|---|---|
| 외부 페이지의 localhost 접근 | loopback·정확한 WS 경로·허용 Origin/Host, 필요한 세션 검증 | 외부/위조 Host·Origin 거부, 정상 개발/프로덕션 허용 |
| P/file/snapshot/transfer ID 변조 | 서버 소유·namespace·바인딩 검사 | 교차 프로젝트·소켓·미존재 snapshot 거부 |
| path traversal·junction·소실 | canonical root·파일 열기 직전 확인·서버 이름·wx | 입력/출력/staging/정리 단계의 경로 이탈·소실 거부 |
| chunk 자원 고갈·재전송 | byte/frame/count/time/rate/backpressure | 초과·중복 index·오순서·hash 불일치·종료 정리·제어 지연 |
| 오래된 제안·중복 제작 | revision/target version·durable idempotency | 편집 중 응답 도착·다중 창·동일 키 다른 내용·dispatch 중 종료 |
| 모델의 권한 확대 | 서버 목적별 sandbox·pending 승인·요청 subset | 제안 write 승격 거부·가짜/만료/재사용 승인 거부 |
| 악성 자료·생성 UI | 자료/명령 분리, React 텍스트, 부모 DOM/WS 미접근 | HTML/URL/SVG 입력·미리보기·외부 요청·원본 자동 실행 차단 |
| 부분 저장·손상 백업 | journal·FK/해시·원본 보존·새 프로젝트 복원 | DB/파일/history 각 경계의 강제 종료·손상·다른 스키마 거부 |

현재 단계를 통해 새 계약이 검증됐다는 주장은 하지 않는다. 추후 단계의 관련 실패 테스트는 필수이며, 기존 통과 81/53개 검사만으로 신규 경계의 안전성을 대체하지 않는다. 로컬 저장/bridge 제품이 완전 오프라인 추론을 뜻하지 않으며 실제 Codex 요청에는 선택한 자료가 모델 경로로 전달될 수 있다. 비밀·전체 환경·원문 민감 자료를 로그나 공개 산출물로 전송하지 않는다.
