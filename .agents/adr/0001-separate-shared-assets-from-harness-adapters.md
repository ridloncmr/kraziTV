# ADR-0001: Separate Shared Agent Assets From Harness Adapters

## Status

Accepted

## Context

kraziTV is used with multiple AI coding harnesses. Skills and role instructions should remain consistent across those harnesses, while discovery paths, permissions, tools, hooks, and subagent metadata vary by framework.

Duplicating shared instructions in each harness directory would create drift. Treating product architecture decisions as agent configuration would also obscure decisions that belong to the kraziTV system itself.

## Decision

Use `.agents/` as the canonical home for shared agent infrastructure:

- `.agents/skills/` contains portable Agent Skills.
- `.agents/roles/` contains harness-neutral role instructions.
- `.agents/invocation.md` describes skill routing and workflow composition.
- `.agents/adr/` records decisions about AI harnesses and agent operations.

Harness-specific directories contain only thin adapters and configuration. Product and system architecture decisions remain in `docs/adrs/`.

Prefer configurable discovery paths over symlinks. If a harness requires generated copies, add deterministic synchronization and drift verification.

## Consequences

- Shared workflows and roles have one source of truth.
- Harness support can be added without reorganizing product documentation.
- Agent-infrastructure ADR numbering is independent from product ADR numbering.
- Harness adapters must explicitly reference shared roles when the harness cannot discover them natively.
