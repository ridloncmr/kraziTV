---
name: writing-for-agents
description: Use when writing AGENTS.md, Agent Skills, agent roles, harness adapters, prompts, specs, ADRs, or docs intended for AI agents. Adapted from Matt Pocock's writing-for-agents skill.
license: MIT
---

# Writing For Agents

Adapted from Matt Pocock's `writing-for-agents` skill: https://github.com/mattpocock/skills

Write docs that make future agent work safer and faster.

## Rules

- Put durable project rules in `AGENTS.md`, and put each other kind of doc
  where **Documentation Rules** in `AGENTS.md` says.
- State a rule once. In a role, skill, or adapter, name the `AGENTS.md`
  section that holds the rule instead of paraphrasing it; paraphrased copies
  drift apart.
- When a rule can be checked by a tool, prefer adding the check to
  `scripts/codebase-audit/` or the lint config over adding more prose.
- Prefer imperative, concrete instructions over vague preferences. "Search
  `src/testing/` before writing a fake" beats "prefer reuse".
- Include trigger words in skill descriptions so agents know when to load them.
- Keep README high-level and approachable.

## Good Agent Docs

Good docs answer:

- When should this be used?
- What must never happen?
- What vocabulary should be used?
- What files are authoritative?
- What verification is expected?
