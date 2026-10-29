# Atelier 통합 3단계 — 저장소·파일·WS·백업

2026-10-30, Windows / Node v22.20.0. 범위·위험도 **R2: 로컬 저장·입력·파일·WS 경계**. 시작 브랜치 `main`; 루트 AGENTS.md와 대상 경로 지침을 확인했다. 추가 AGENTS.md/AGENTS.override.md는 없었다. 기존 1·2단계 미커밋 변경을 보존했다.

## 구현한 범위와 파일

| 파일 | 책임 |
|---|---|
| server/atelier/store.ts | 별도 SQLite, schema user_version=1, WAL/FK/busy timeout, 프로젝트·과거 revision·파일·스냅샷·설정·파일 journal |
| server/atelier/paths.ts | 고정 private namespace, 디렉터리·파일 실경로/링크 검사, wx 파일, 단일 저장소 소유 잠금, 죽은 프로세스 잠금 복구 |
| server/atelier/files.ts, resources.ts | 실제 byte/size/hash/type, 프로젝트별 소유, 원본/크롭/결과의 이미지 역할, 파일 커밋·실패 정리 |
| server/atelier/schema.ts, validation.ts, mutations.ts | unknown JSON의 허용 필드·타입·enum·길이·중첩·참조·graph/영역 검사, 서버 소유 ID·버전·이력과 편집 명령 분리 |
| server/atelier/transfers.ts | 연결·목적·프로젝트별 전송, 정규 base64, 순서·총량·해시·만료·한도·디스크 예약량 검사, 임시 spool |
| server/atelier/bundle.ts | legacy JSON 백업 왕복, 새 프로젝트 복원, 실제 선택 파일 ZIP32와 CRC·handoff manifest, 큰 JSON download |
| server/atelier/handlers.ts, errors.ts | 명령별 엄격한 envelope/payload, 실제 지원 capabilities, 안전한 구조화 오류, 제한된 pagination |
| server/atelier/client.ts, worker.ts | SQLite·파일·대형 JSON·ZIP 처리를 별도 worker에 격리, 요청·전송 rate, 최소 변경 이벤트 |
| server/index.ts | 기존 WS에 atelier.* 분기, Host/Origin 검사, 승인·중단 우선 경로, 시작 중 중단 보존, CLI 오류의 새 연결 안내 |
| shared/atelier/types.ts, guide.ts, domain.ts | 실제 legacy의 `기타`, easyManaged/easyCustom/easyPalette, intent/handoff 시각·복원 provenance·returnTo 데이터 대응. 기존 예시·출력 의미 유지 |
| tools/check-node.mjs, package.json, package-lock.json, START_AUTO_CODEX.cmd | Node 22.13+와 실제 SQLite 기능 사전 검사. CLI 부재를 설계 저장소 부팅 실패로 취급하지 않음. 의존성 버전·새 패키지 변경 없음 |
| .gitignore | 기존 `.local-data/` 제외가 SQLite/WAL/소유 잠금/파일/전송을 모두 포함함을 확인·기록 |
| server/atelier/atelier.test.ts | 저장·파일·백업·경합·복구·거부 경로 12개 검사 |
| tools/verify-atelier-storage.mjs | 실제 빌드 bridge/worker/WS, CLI 부재·강제 종료·복구·byte 왕복·history/원본 DB 보존·rate/Origin·승인 거부 검증 |
| tools/fixtures/history-app-server.mjs, tools/verify-conversation-restart.mjs | 기존 합성 회귀에 지연된 turn 시작 중 중단 검증 추가 |

원본 `atelier/atelier/` 소스·DB를 통합 런타임에서 import하거나 열지 않는다. 기존 `.local-data/history.json` 형식과 ConversationStore는 그대로다. 새 저장 위치는 다음뿐이다.

```text
.local-data/atelier/atelier.sqlite         projects/revisions/files/snapshots/settings/operations
.local-data/atelier/atelier.sqlite-wal     SQLite 관리 파일
.local-data/atelier/atelier.sqlite-shm
.local-data/atelier/owner.lock             현재 브리지 PID와 서버 토큰
.local-data/atelier/files/<P>/<fileId>.<ext>
.local-data/atelier/transfers/<up_uuid>.tmp
```

외부 API·유료 서비스·배포·계정·새 HTTP CRUD endpoint는 추가하지 않았다. 디자인 편집 UI는 **4단계**다. 새 저장 기능은 현재 WS에서 제공하며 기존 셸의 디자인 메뉴는 준비 상태를 유지한다.

## 가이드·실제 원본의 차이와 처리

원본 서버의 전체 프로젝트 PUT과 한 번에 생성하는 메모리 ZIP을 그대로 공개하지 않았다. 가이드대로 브리지 명령·소유·버전 검사를 두고, 큰 처리는 worker와 파일 spool로 옮겼다. ZIP은 원본과 같은 stored-entry/UTF-8/CRC32 포맷이며, 첨부를 하나씩 읽어 기록한다. 전체 ZIP을 Buffer.concat하지 않는다.

원본 fixture에는 2단계 선언에 빠진 legacy `기타` 유형과 easy 모드 메타데이터, 의도·수동 전달 시각이 있었다. 실제 `app.js/easy-guide.js`와 7개 백업을 근거로 명시적으로 보완했다. 신규 생성 UI 유형 목록은 원래 6개다. 범위별 과거 입력은 전체 프로젝트가 아니라 제외된 흐름의 맥락·근거를 포함할 수 있으므로, 현재 프로젝트 참조 검사와 고정된 과거 입력 검사를 구분했다. 파일 소유·바이트 검사는 과거 입력에도 적용한다. 과거 스냅샷 JSON은 재작성하지 않는다.

3단계의 추가 읽기 명령 `atelier.project.read`는 전체 JSON을 bounded download로 전달한다. 큰 항목을 잘라서 성공으로 표시하지 않기 위한 경로다. `project.load`는 요약·설정·count, entity.list는 page, snapshot.read는 요약 hash와 download를 반환한다. 전체 프로젝트를 다시 올려 덮어쓰는 명령은 없다.

## 현재 WS 계약과 후속 제안의 구분

요청은 `{type:'atelier.…',v:1,clientRequestId:<UUID>,payload:{…}}`, 응답은 `atelier.response`의 ok/result 또는 error(code/message/retryable/currentVersion?)다. 정확한 payload 허용 목록은 [requestRules](../../server/atelier/handlers.ts), entity 필드는 [mutations](../../server/atelier/mutations.ts)가 실행 기준이다. 타입 선언만으로 입력 검증을 대체하지 않는다.

| 현재 구현한 명령 | 동작 |
|---|---|
| capabilities | 실제 operations/limits, design AI=false/execution=false. 일반 Codex 실행 능력과 별도 |
| project.list/create/load/read/update/delete | 서버 ID·경로, expectedVersion 저장, 삭제 확인 ID 일치·전송 중 BUSY |
| entity.list/mutate | fields/features/contents/flows/screens/references/regions/concepts/styles/assets. 기존 field key만 편집; 명령별 add/patch/remove/reorder/confirm/exclude/graph 확인/컨셉 선택/내장 팔레트 |
| intent.confirm / snapshot.create/read | 해당 revision 의도, final/baseline/revision 규칙, 독립 스냅샷 테이블과 정규화 JSON hash·과거 내용/개수 불변 |
| file.list/read | 프로젝트 소유와 실제 파일 재검증, 실제 경로를 노출하지 않는 metadata/download |
| transfer.begin/chunk/finish/read/abort | 파일 수신·다운로드와 committed backup handle. 완료된 파일 등록은 결정 확정과 별도 |
| backup.export/import | `atelier-backup` version 1, 전체 byte/hash/형식/관계 검증 후 새 P·version=1로 복원. legacy 내부 ID와 과거 snapshot/판정 보존 |
| bundle.export | 명시한 snapshot만 허용, 현재 편집본/최신 snapshot으로 fallback하지 않음. prompt/decisions/실제 선택 파일/attachments/handoff ZIP |
| settings.get/update | 공통 UI 기준·밀도·마지막 설계 프로젝트만. cwd·신뢰·네트워크·승인·실행 명령 설정 없음 |
| result.register / review.start/update/finish / plan.create/update/confirm | 원본의 수동 이미지 또는 실행 기록·관찰·판정·수정 계획 저장. 실제 제작이나 AI 검토 실행을 의미하지 않음 |

수정 계획에 이미 연결된 스냅샷이 있으면 계획 자체 변경을 거부한다. 연결된 결정·화면을 제거해 참조를 끊는 명령도 거부하므로 먼저 연결을 편집해야 한다. 페이지 cursor는 연결·프로젝트 버전·목록 종류와 묶이며 변경/만료 시 STALE_INPUT이다.

아직 미구현: bindings/proposals/generations/artifacts·AI 제안·Codex 디자인 제작·통합 AI 백업 포맷. capabilities에 넣지 않았고 해당 명령은 거부한다. 기존 원본 DB 자동 migration, cloud, 동작하는 HTML 미리보기나 실행 권한 복원도 없다. 수동 handoff는 안내 이력으로 보존하며 실행 registry나 pending 승인에 등록하지 않는다.

## 제한과 신뢰 경계

- 제어 요청·응답 256KiB, Atelier 프레임 1MiB, UTF-8 텍스트 필드 32KiB, ID 목록 기본 256, page 32/최대 64. 이름은 원본처럼 프로젝트 120자·파일 180자다. 과거 조립 본문은 더 큰 고정 텍스트로 검증한다.
- 파일 1byte~15MiB, 프로젝트 JSON/전체 백업 JSON 90MiB, chunk raw 256KiB. 백업 JSON 크기는 base64 팽창·메타데이터를 포함한다. ZIP은 90MiB 제한을 재사용하지 않고 파일 총량·실제 헤더/manifest·ZIP32 한계를 사전 계산한다.
- 전송 연결당 2개/전체 8개, worker 미완료 요청 최대 8개·연결당 1개. 제어 60회/분 burst 20, chunk/read 32회/초. WS 연결은 전체 32개까지다.
- 전송 무진행 60초·전체 15분 만료, 10초 주기 정리. chunk는 ACK 후 다음 index, 중복/건너뛰기/총량/해시/정규 base64 실패 거부. 연결 종료·강제 재시작 뒤 이전 handle 재사용 불가다.
- 디스크 예약량 합계와 여유 16MiB를 확인한다. 이는 논리 예약이며 OS의 물리 공간 보장은 아니다. 중간 disk/DB 실패는 journal로 보존·정리하고 성공으로 표시하지 않는다.
- 다운로드 bufferedAmount high 1MiB에서 멈추고 low 256KiB 이하에서 재개한다. 기존 큰 대화/결과 호환을 위해 공통 WS transport의 기존 수신 maxPayload는 그대로 두고, Atelier 프레임은 handler에서 별도로 제한했다. legacy 전체 스트리밍 프로토콜을 이번 단계에 변경하지 않았다.
- PNG는 chunk/CRC/종료/크기와 제한된 zlib 결과를 검사한다. JPEG/WebP와 문서·서체·미디어는 구조·서명/UTF-8 등 원본 의미를 보존한 형식 검사를 한다. 전체 코덱 해독·문서 안전성 보증·악성코드 탐지는 아니다. PNG 최대 64M pixel/해독 예산 128MiB다. 첨부를 실행하거나 부모 UI에서 미리보기하지 않는다.
- 서버가 이름을 정하고 디렉터리 realpath, symlink/junction, 파일 nlink·inode·경로를 다시 검사한다. 정리는 검증된 정확한 파일만 unlink한다. 파일을 임의 경로에 추출하거나 재귀 삭제하지 않는다.
- 새 UI/브라우저는 신뢰하지 않는다. Host/Origin을 고정 localhost로 검사하고 native Origin 없는 로컬 클라이언트는 기존처럼 허용한다. 모든 창은 같은 로컬 사용자 범위다. 다중 계정/테넌트 인증 서비스는 아니다.

## 검증 결과

최종 코드/빌드, skip 없음. 검사 데이터는 모두 원본의 합성 예제 또는 새 합성 입력이며 실제 모델·고객 프로젝트는 사용하지 않았다.

| 명령/검사 | 결과 |
|---|---|
| `npm run typecheck` | 통과. strict/allowJs=false 유지 |
| `npm test` | **23개 파일·153개 tests 통과**: 기존 141개 + 새 저장소 12개 |
| `npm run build` | 통과. 기존 UI 41개 모듈과 server/atelier worker·shared 모듈 포함, 검사 파일 제외 |
| `npm --prefix atelier/atelier run check` | 원본 14개 모듈 통과 |
| `npm --prefix atelier/atelier test` | 원본 53개 통과, 실패·skip 0 |
| `node tools/verify-atelier-storage.mjs` | 실제 빌드 bridge/worker/WS, CLI 부재, 파일 byte 왕복·ZIP, 새 프로젝트 백업 복원, SIGKILL 뒤 lock/전송 정리·영속 데이터 복구, history 불변·원본 DB sentinel 보존, Origin·rate 거부, 업로드 중 만료 승인 거부 응답 통과 |
| `node tools/verify-conversation-restart.mjs` | 기존 대화·thread resume·Team 복구·만료 승인 거부·network=false와 지연된 시작 중 interrupt 통과 |
| `node tools/verify-atelier-assets.mjs` | 기존 프로덕션 폰트·라이선스·아이콘 MIME/원본 byte 제공 통과 |
| `node tools/verify-atelier-domain.mjs` | 기존 도메인 빌드 검사와 원본 16개 SHA-256 일치 |
| `node --check` 변경된 mjs 도구/fixture | 통과 |
| `git diff --check`, `git check-ignore` | 통과. .local-data의 SQLite/WAL/files/transfers/owner.lock 제외 확인. 기존 CRLF 안내만 발생 |

WS 검사 결과는 [기계 판독 증거](STAGE3_WS_EVIDENCE.json)에 있다. 초기 원본 가져오기 검사는 미선언 legacy 필드·기준 ID와 선택 입력 관계 차이로 실패했으며, 원본 소스로 계약을 확인한 뒤 수정했다. 테스트 assertion을 지우거나 skip하지 않았다. 새 테스트의 파일 생성·rename/junction·loopback에는 필요한 로컬 도구 권한을 사용했다. 자동 승인 검토 거절은 없었다. Node 22.20은 SQLite ExperimentalWarning을 출력하며 이를 숨기지 않았다.

정상 외에 교차 프로젝트/연결, 프레임·목록·전송 초과, prototype 키, 오래된 저장·cursor, 중복 chunk, 잘못된 hash/이미지/영역, 없는 파일/snapshot, 수정된 스냅샷, 손상 백업/handoff, 높은 DB 버전, 단절 전송, pre/post-commit 실패와 journal 복구, 중복 worker·동시 writer를 확인했다. CRC32의 표준 벡터도 검사한다.

## 보존·R2 위협 분석·복구

일반 Codex 작업·대화·Team/Solo·스킬·모델·기존 셸/픽셀·토큰·승인 상관관계·네트워크 기본 차단은 유지한다. Atelier는 여전히 설계 기준이고 기존 브리지가 실행·pending 승인을 소유한다. 승인·중단은 디자인 worker/기존 장기 제어 큐를 우회하며, turn ID 수신 전의 중단 요청도 시작 직후 실제 interrupt로 이어진다.

보호 자산은 로컬 설계·원본 파일·이력·고정 기준과 실행 권한이다. 공격 표면은 renderer/변조 WS/백업·파일이며, 다른 P/file/transfer ID·경로·이력·권한을 끼워 넣는 입력을 브리지 검증/서버 ID·소유 검사/트랜잭션/경로 검사에서 거부한다. 원본 source·history 저장을 범용 PUT으로 노출하지 않고 SQL도 매개변수화했다. 큰 처리는 worker에 있어 기존 실행·승인 이벤트를 생성하거나 흉내 내지 않는다. 이는 자체 검토와 회귀 증거이며 독립 보안 감사는 아니다.

저장 순서는 검증 → 전용 파일 기록·sync → DB transaction → journal 정리다. commit 이전 실패는 새 파일만 제거한다. commit 이후 정리 실패는 커밋된 바이트를 보존한다. 시작 시 죽은 PID의 잠금과 미완료 전송·journal을 조정한다. 손상된 잠금이나 살아 있는 PID를 강제로 무시하지 않는다. 같은 앱 루트에는 브리지 하나만 저장소를 소유하며, 여러 UI 창은 그 브리지를 공유한다.

기존 DB migration/대화 변환은 없다. 새 스키마만 생성하고 더 높은 DB 버전은 수정하지 않는다. 파일·설계의 이식/복구는 실제 JSON 백업을 쓰고, WAL DB 본체만 복사하지 않는다. 파일 수준 백업이 필요하면 브리지를 정상 종료해 SQLite 연결을 닫은 후 **.local-data/atelier 전체**를 함께 보존한다. rollback은 앱 코드를 되돌리고 새 데이터 디렉터리를 보존하는 방식이며 자동 downgrade·history 덮어쓰기를 하지 않는다.

## 미검증·다음 단계

- 실제 Node 22.13.0 자체·다른 Windows/브라우저 조합, 전체 코덱, 90MiB 한도 부근 장시간 메모리/디스크 압박, OS 전원 손실·파일시스템 적대 경합은 미검증이다. OS 사용자/ACL 경계를 이 코드가 대체하지 않는다.
- SQLite 저장소 오류의 구조화 응답·worker 격리는 구현했으나 실제 운영 디스크 고장·모든 WAL 손상 유형의 복구를 보장하지 않는다. 손상 lock/PID 재사용은 보수적으로 차단할 수 있다.
- 새 화면이 없어 UI 크기·키보드·동작 축소의 추가 확인은 해당 없음이다. 실제 CLI/모델·생성물·AI 제안·배포는 실행하지 않았다.
- **4단계**에서 현재 capabilities와 명령·paging/download/버전 충돌을 사용해 수동 작업실을 연결해야 한다. 입력 보존, 실제 업로드/크롭 표시, 편집·검토·내보내기 UI와 키보드/화면 크기 검증이 다음 조건이다. 5~7단계 AI·제작·산출물 연결은 여전히 후속이다.
- 외부 실행·추가 승인 대기 없음.
