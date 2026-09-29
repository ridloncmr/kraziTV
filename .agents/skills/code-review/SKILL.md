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
- Files with multiple independent classes or muddied responsibilities
- Growing flat or catch-all directories whose repeated prefixes or source-and-test
  clusters should be grouped by domain
- Accidental, unused, or overly broad exports
- Missing concise why-comments on methods
- Unclear domain names
- Provider-specific leakage into core logic
- FFmpeg/media details leaking into scheduling logic
- Incorrect active user, operator, or planning documentation

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
