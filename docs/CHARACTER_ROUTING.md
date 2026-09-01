# Character routing

Auto Codex separates three concepts:

1. A Codex skill is the instruction bundle selected for a turn.
2. A role is the stable work category used for routing and presentation.
3. A character is the visual identity assigned to a role or an individual skill.

## Roles

| Role | Responsibility | Initial character |
|---|---|---|
| Coordinator | General requests and orchestration | Coordinator |
| Builder | Code and feature implementation | Builder |
| Researcher | Browser, research, and sources | Researcher |
| Documenter | PDF, documents, spreadsheets, and slides | Documenter |
| Visual Designer | Images, visualization, and sprites | Visual Designer |
| QA Inspector | Tests, reviews, and verification | QA Inspector |
| Integrator | MCP, external services, and deployment | Integrator |

The role is selected from the prompt and the skill description. If several capabilities are present, the concrete skill match wins; if no skill is safe or specific enough to select, the role remains active and the general agent continues the work.

## Manual behavior

Manual shows repository-scoped skills first. `Codex 스킬 전체 보기 <` expands the list to all enabled skills reported by App Server, including User, System, and Admin scopes. Each row has a character selector.

Assignments use this precedence:

```text
individual skill assignment > role assignment > default role character
```

Assignments are stored in browser local storage under the selected project path. They are UI preferences only and do not grant permissions, change sandbox settings, or alter Codex configuration.

## Future sprites

The current catalog exposes `CharacterId` values and the renderer still has a CSS fallback. A future sprite catalog can attach a spritesheet URL and animation metadata to each character without changing routing. Runtime states such as `thinking`, `reading`, `running`, and `waitingApproval` remain separate from character identity.
