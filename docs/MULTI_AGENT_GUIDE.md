# 멀티 에이전트 개념 가이드

> Notion에 그대로 붙여 넣어 학습 노트로 사용할 수 있는 문서입니다. Pixel은 화면의 픽셀 아트 테마이고, Coordinator는 작업을 지휘하는 최상위 역할입니다. 두 개념은 서로 독립적입니다.

## 1. 가장 짧은 정의

- **Gateway / Bridge**: 앱과 실제 AI 런타임 사이에서 연결, 실행 상태, 이벤트, 승인 요청을 관리하는 신뢰 가능한 서버입니다.
- **Run**: 사용자가 한 번 맡긴 전체 요청입니다.
- **Task**: Run을 나눈 구체적인 업무 단위입니다.
- **Agent**: Task를 맡아 독립된 thread/turn에서 실행하는 작업 주체입니다.
- **Role**: Agent에게 기대하는 책임입니다. 예: Coordinator, Builder, Researcher, QA.
- **Skill**: 특정 종류의 일을 정확한 절차로 수행하게 하는 지침 묶음입니다. Agent 그 자체가 아닙니다.
- **Thread**: 한 에이전트의 대화와 작업 맥락을 보관하는 세션입니다.
- **Turn**: Thread 안에서 한 번 시작해서 완료·실패·중단되는 실제 실행입니다.
- **Pixel theme**: 위 상태를 Cyworld·ZEP 같은 픽셀 아트 사무실로 보여주는 표현 방식입니다.

## 2. “Gateway가 원본이다”의 의미

브라우저 화면은 신뢰하지 않는 표시 계층입니다. 화면에 캐릭터가 타이핑한다고 해서 파일이 실제로 수정된 것은 아닙니다. Bridge가 받은 App Server 이벤트만 사실로 취급합니다.

| 정보 | 원본 | UI가 하는 일 |
|---|---|---|
| thread/turn ID | Codex App Server | 표시 |
| 파일 변경·명령 실행 | `item/*` 이벤트 | 해당 에이전트 애니메이션과 타임라인 갱신 |
| 승인 요청 | App Server request ID | 사용자의 결정만 Bridge에 반환 |
| Task 실행 순서 | Bridge scheduler | 작업 보드 표시 |
| 최종 성공/실패 | `turn/completed`와 검증 Task | 결과 보고 |

즉, Gateway가 원본이라는 말은 UI가 상태를 상상하거나 명령을 직접 실행하지 않고, Bridge가 보관한 실제 런타임 상태를 읽어서 보여준다는 뜻입니다.

## 3. Runtime profile과 경계

Claw3D 같은 도구가 OpenClaw, Hermes, Demo, Local, Custom profile을 지원한다는 것은 여러 실행 백엔드를 같은 UI 뒤에 연결할 수 있도록 어댑터 경계를 만들었다는 뜻입니다. 모든 서비스가 동일하게 동작한다는 뜻은 아닙니다.

```text
공통 UI / 공통 Task 모델
           |
     Runtime adapter boundary
       /       |        \
    Codex    Hermes    Custom
```

경계는 각 런타임의 서로 다른 세션, 이벤트, 승인, 도구 형식을 공통 계약으로 바꾸는 지점입니다. 현재 Auto Codex는 Codex App Server만 연결합니다. 다른 런타임을 붙이려면 `startThread`, `startTurn`, `interrupt`, `resolveApproval`, `normalizeEvent`를 구현하는 별도 어댑터가 필요합니다.

## 4. 원격 에이전트와 로컬 에이전트

Agent는 작업 주체이고 Skill은 Agent가 사용하는 절차입니다. 이 이해가 맞습니다.

- **로컬 에이전트**: 현재 PC의 프로젝트 경로와 로컬 Codex 런타임에서 실행합니다.
- **원격 에이전트**: 다른 서버나 클라우드 실행 환경에서 동작하고 네트워크를 통해 결과를 보냅니다.
- **병렬 실행**: 여러 Agent가 동시에 일할 수 있다는 뜻입니다. 반드시 병렬인 것은 아닙니다.

원격 여부와 병렬 여부는 별개의 축입니다. 로컬 Agent 여러 개도 병렬로 실행할 수 있고, 원격 Agent 하나만 순차 실행할 수도 있습니다.

## 5. Agent, Skill, Task의 차이

| 개념 | 비유 | 이 프로젝트 |
|---|---|---|
| Agent | 직원 | 독립된 App Server thread를 가진 실행 주체 |
| Role | 직책 | Builder, Researcher, QA 등 |
| Skill | 업무 매뉴얼·도구상자 | 설치된 `SKILL.md` 지침 |
| Task | 업무 지시서 | 제목, 설명, 의존성, read/write 접근을 가진 노드 |

한 Agent가 한 Task를 수행하는 것을 기본으로 삼되, 같은 역할의 Agent가 여러 Task를 차례로 맡을 수 있습니다. Skill은 명시적으로 선택됐거나 안전한 라우터가 고른 경우에만 해당 Task 입력에 붙습니다.

## 6. Codex task와 이 앱의 Agent

Codex 앱에서는 여러 Task를 사이드바에 만들어 각각 독립적으로 진행할 수 있습니다. 이 프로젝트의 Team Auto는 사용자에게 여러 사이드바 Task를 만들게 하지 않고, 하나의 Run 안에서 Bridge가 여러 App Server thread를 관리합니다.

- **Solo**: 하나의 기존 thread/turn으로 요청 전체를 수행합니다.
- **Team Auto**: Coordinator 계획 후 업무별 ephemeral thread/turn을 생성합니다.

## 7. 데이터 모델을 적용하면 가능한 것

`Run → Tasks → Agents → thread/turn` 관계를 명시하면 다음이 가능해집니다.

- 어떤 Task가 누구에게 배정됐는지 추적
- 어떤 선행 Task를 기다리는지 표시
- 독립적인 읽기 Task만 병렬 실행
- 쓰기 Task가 겹치지 않도록 차단
- 이벤트·출력·승인을 올바른 Task에 연결
- 실패한 Task 때문에 차단된 후속 작업 식별
- 성공과 실패를 모두 수집한 최종 보고
- 앱을 다시 그려도 동일한 상태 재현

## 8. 역할은 서브에이전트인가

역할 자체는 서브에이전트가 아닙니다. 역할은 책임의 이름이고, 그 역할을 가진 독립 실행 주체가 실제 Agent입니다. 현재 Team Auto에서는 역할별 Agent snapshot을 만들고, 각 Task 실행 때 별도 App Server thread를 생성합니다.

Coordinator는 가장 높은 역할이며 다음을 담당합니다.

1. 요청 분석
2. Task 분해
3. 역할 배정
4. 의존성과 실행 순서 제안
5. 전체 결과 종합 보고

Bridge는 Coordinator의 계획을 무조건 믿지 않고 순환 의존성과 안전 규칙을 다시 검증합니다.

## 9. 병렬 작업에서 코드를 수정할 때 주의할 점

독립적인 조사, 문서 읽기, 비교 분석은 병렬화하기 좋습니다. 같은 작업공간의 코드를 여러 Agent가 동시에 수정하면 충돌뿐 아니라 서로의 중간 상태를 읽는 문제가 생깁니다.

이 프로젝트의 기본 규칙:

- `read` Task: 최대 3개 병렬
- `write` Task: 단독 실행
- 실행 중인 read Task가 있으면 write 시작 금지
- 실행 중인 write Task가 있으면 다른 Task 시작 금지
- 구현 완료 후 QA 검증

## 10. 브랜치·worktree를 사용하는 이유

쓰기 Agent도 병렬화하려면 Agent마다 별도 branch와 worktree가 필요합니다. 각 기능을 독립 공간에서 만든 뒤 통합 Agent가 변경을 검토하고 merge하며 충돌과 테스트 실패를 해결하는 구조입니다.

현재 버전은 하나의 사용자 작업공간을 안전하게 보존하기 위해 병렬 writer를 사용하지 않습니다. 향후 worktree 격리를 구현한 뒤에만 독립적인 코드 변경을 병렬화해야 합니다.

## 11. 승인 구조

현재 승인은 앱 서버가 자의적으로 판단해 실행하는 구조가 아닙니다.

1. Codex App Server가 실제 명령·파일·추가 권한 승인을 요청합니다.
2. Bridge가 request ID와 thread/turn/task를 묶어 보관합니다.
3. UI는 사용자에게 내용을 보여줍니다.
4. 사용자는 승인·세션 승인·거절·취소 중 하나를 선택합니다.
5. 브라우저는 승인 ID와 결정만 보냅니다.
6. Bridge가 보관한 원본 요청에 응답합니다.

추가 권한은 브라우저가 새 내용을 만들 수 없습니다. 승인하면 App Server가 요청한 네트워크·파일 권한의 부분집합만 그대로 전달됩니다. Team Auto에서도 모든 승인 요청은 해당 Task의 thread/turn에 귀속됩니다.

## 12. 현재 구현된 전체 흐름

```text
사용자 요청
  → Coordinator read-only 계획
  → Bridge JSON Schema·DAG 검증
  → 계획 실패 시 안전한 fallback
  → 독립 read Task 병렬
  → workspace write Task 순차 실행
  → QA 검증
  → 성공·실패·차단 수집
  → Coordinator 최종 보고
```

Pixel 사무실 캐릭터의 `reading`, `editing`, `running`, `waitingApproval` 상태는 실제 App Server 이벤트가 들어온 경우에만 바뀝니다.
