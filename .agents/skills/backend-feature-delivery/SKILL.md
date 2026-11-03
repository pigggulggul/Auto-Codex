---
name: backend-feature-delivery
description: Implement or repair backend services, protocol handlers, data validation, permissions, and failure handling in an existing application. Use for server-side implementation and regression checks, not unrelated UI-only or deployment work.
---

# Backend feature delivery

Trace the actual entry point, trust boundary, authorization, processing, state changes, and response before editing. Respect explicit read-only and approval constraints; client or model input is not authority.

- Preserve public contracts and existing data unless the user authorizes a change. Validate inputs at the trusted boundary, default to least privilege, and handle failures without exposing secrets.
- Consider relevant malformed inputs, concurrency, retries, partial failures, stale state, path escapes, and resource limits. Use the project's established mechanisms rather than inventing security primitives.
- Reproduce the relevant failure safely where feasible. Add focused regression coverage for observable behavior and meaningful failure paths, using synthetic data and no production services.
- Run applicable project checks after the final change; report failed and unavailable checks honestly. Keep unrelated behavior unchanged.
- Optimize measured bottlenecks only when justified; compare representative cases and preserve correctness. Distinguish confirmed facts from assumptions and verify important handoff claims at their source.
