---
name: code-review
description: Use when reviewing kraziTV diffs, PRs, implementations, architecture changes, or missing tests. Adapted from Matt Pocock's code-review skill.
license: MIT
---

# Code Review

Adapted from Matt Pocock's `code-review` skill: https://github.com/mattpocock/skills

Review changes on two axes: standards and spec fit.

## Standards Review

Look for:

- Bugs or behavioral regressions
- Unnecessary complexity; KISS outranks SOLID and DRY purity
- Architecture boundary violations
- Missing or weak tests
- Overly shallow modules
- Files holding more than one primary thing (independent classes, several
  tables or migrations) or muddied responsibilities
- Files placed against the source layout rules in `AGENTS.md`: implementation
  at the `src/` root, nested `process/` or `testing/` folders, vague folders
  such as `utils/`, or a domain folder that meets the grouping rule but mixes
  capabilities flat. Capability subfolders and specific kind folders such as
  `schema/` or `types/` are correct, not findings.
- Accidental, unused, or overly broad exports
- Missing concise why-comments on methods
- Unclear domain names
- Provider-specific leakage into core logic
- FFmpeg/media details leaking into scheduling logic
- Incorrect active user, operator, or planning documentation
- A completed implementation-plan ticket without a recorded status (see the
  plan-status rule in `AGENTS.md`)

## Spec Review

Compare the change to:

- User request
- README
- `docs/specs/`
- `docs/adrs/`
- `AGENTS.md`

For implemented behavior, treat source and executable tests as canonical. Use
specs, plans, and ADRs as intent and historical context; report meaningful drift,
but do not demand code changes solely to match stale documentation.

## Output

Prioritize findings first, ordered by severity.

Use file and line references where possible.

If there are no findings, say so and mention residual risks or missing verification.
