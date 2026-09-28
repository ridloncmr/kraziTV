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
- Architecture boundary violations
- Missing or weak tests
- Overly shallow modules
- Unclear domain names
- Provider-specific leakage into core logic
- FFmpeg/media details leaking into scheduling logic
- Documentation drift

## Spec Review

Compare the change to:

- User request
- README
- `docs/specs/`
- `docs/adrs/`
- `AGENTS.md`

## Output

Prioritize findings first, ordered by severity.

Use file and line references where possible.

If there are no findings, say so and mention residual risks or missing verification.
