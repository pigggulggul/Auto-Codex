# Character routing

Auto Codex separates three concepts:

1. A Codex skill is the instruction bundle selected for a turn.
2. A role is the stable work category used for routing and presentation.
3. A character is the visual identity assigned to a role or an individual skill.

## Roles

| Role | Responsibility | Initial character |
|---|---|---|
| Coordinator | General requests and orchestration | Agumon |
| Generalist | Solo and unmatched work | Nao |
| Builder | Code and feature implementation | Jiji |
| Researcher | Browser, research, and sources | Frieren |
| Documenter | PDF, documents, spreadsheets, and slides | Anya |
| Visual Designer | Images, visualization, and sprites | Pika |
| QA Inspector | Tests, reviews, and verification | Nezuko |
| Integrator | MCP, external services, and deployment | 小八 |

The role is selected from the prompt and the skill description. If several capabilities are present, the concrete skill match wins; if no skill is safe or specific enough to select, the role remains active and the general agent continues the work.

## Manual behavior

Manual shows repository-scoped skills first. `Codex 스킬 전체 보기 <` expands the list to all enabled skills reported by App Server, including User, System, and Admin scopes.

월드에서 역할 공간이나 캐릭터를 누르면 해당 역할의 펫을 지정할 수 있습니다. 역할별 기본값은 다음과 같고, 프로젝트마다 선택값을 별도로 저장합니다.

```text
project role assignment > default role pet > CSS fallback
```

Assignments are stored in browser local storage under the selected project path. They are UI preferences only and do not grant permissions, change sandbox settings, or alter Codex configuration.

## Runtime sprites

`public/pets/catalog.json`에 등록된 Codex Pet v1/v2 atlas가 실제 캐릭터로 로드됩니다. Runtime states such as `thinking`, `reading`, `running`, and `waitingApproval` remain separate from character identity. 업무가 병렬이면 역할별 캐릭터가 각자 움직이며, 완료된 Task를 다른 역할의 종속 Task가 이어받으면 보내는 캐릭터가 받는 캐릭터의 공간으로 이동하는 인계 동작을 표시합니다.
