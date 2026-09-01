# Team Auto 운영과 검증

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
```

시스템 npm shim이 손상된 개발 환경에서는 저장소의 로컬 실행 파일로 같은 검사를 수행할 수 있습니다.

```powershell
.\node_modules\.bin\tsc.cmd --noEmit
.\node_modules\.bin\tsc.cmd --noEmit -p tsconfig.node.json
.\node_modules\.bin\vitest.cmd --run
.\node_modules\.bin\vite.cmd build
.\node_modules\.bin\tsc.cmd -p tsconfig.server-build.json
```

## 수동 스모크 테스트

1. 프로젝트 폴더를 선택하고 필요하면 신뢰합니다.
2. Team Auto에서 작은 읽기 요청을 실행합니다.
3. 작업 보드에 plan → research → report가 표시되는지 확인합니다.
4. 서로 독립적인 read Task가 동시에 `running`이 될 수 있는지 확인합니다.
5. write Task 실행 중 다른 Task가 실행되지 않는지 확인합니다.
6. 승인 대화상자에 Task ID와 원본 명령·경로·권한이 표시되는지 확인합니다.
7. 작업 완료 후 QA와 Coordinator 보고가 표시되는지 확인합니다.
8. Activity feed의 수정·명령 상태가 실제 이벤트가 있을 때만 나타나는지 확인합니다.
