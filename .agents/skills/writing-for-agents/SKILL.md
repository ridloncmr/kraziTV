---
name: writing-for-agents
description: Use when writing AGENTS.md, Agent Skills, agent roles, harness adapters, prompts, specs, ADRs, or docs intended for AI agents. Adapted from Matt Pocock's writing-for-agents skill.
license: MIT
---

# Writing For Agents

Adapted from Matt Pocock's `writing-for-agents` skill: https://github.com/mattpocock/skills

Write docs that make future agent work safer and faster.

## Rules

- Put durable project rules in `AGENTS.md`.
- Put product behavior in feature-scoped specs under `docs/specs/features/`.
- Put product and system decisions in `docs/adrs/`.
- Put AI harness and agent-infrastructure decisions in `.agents/adr/`.
- Put build sequencing in `docs/implementation_plan/`.
- Put researched facts in `docs/knowledge_base/`.
- Treat specs and plans as pre-implementation guidance and historical context
  after completion. Implemented source and tests are canonical for behavior.
- Do not require completed specs to mirror implementation unless the user needs
  them as an active product, user, or operator document.
- Prefer imperative, concrete instructions over vague preferences.
- Include trigger words in skill descriptions so agents know when to load them.
- Keep README high-level and approachable.

## Good Agent Docs

Good docs answer:

- When should this be used?
- What must never happen?
- What vocabulary should be used?
- What files are authoritative?
- What verification is expected?
