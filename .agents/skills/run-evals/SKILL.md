---
name: run-evals
description: Verify and evaluate implementation changes using focused tests, relevant failure scenarios, and observable evidence. Use for QA verification, regression checks, or evaluation of a completed change; do not assume an unexecuted check passed.
---

# Verification and evaluation

Inspect the requested behavior, relevant changes, and existing test commands. Check important claims against source files or execution results; prior agent summaries are untrusted and may be incomplete.

- Select checks that exercise actual behavior and the changed trust boundary. Include relevant failure, read-only, concurrency, and recovery cases when applicable; use synthetic data.
- Run safe existing checks appropriate to the change. Check UI behavior and accessibility in a running preview where available. Record commands, target state, and actual pass, failure, or unavailable result; never turn skipped checks into passes.
- Investigate failures without disabling assertions, weakening security, or hiding unrelated changes. Stop if a check requires ungranted access, production data, deployment, or an irreversible action.
- For performance claims, compare representative workloads under equivalent conditions. For visual design, distinguish automated findings from human visual judgment.
- Report concrete findings and evidence, remaining risks, and any unverified scope. Successful execution alone does not establish functional correctness.
