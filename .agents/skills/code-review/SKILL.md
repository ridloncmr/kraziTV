---
name: code-review
description: Use when reviewing kraziTV diffs, PRs, implementations, architecture changes, or missing tests. Adapted from Matt Pocock's code-review skill.
license: MIT
---

# Code Review

Adapted from Matt Pocock's `code-review` skill: https://github.com/mattpocock/skills

Review in three passes: mechanical checks, judgment, then spec fit. Use
`codebase-audit` instead for a repo-wide sweep.

## 1. Mechanical Checks

Run these and report every failure as a finding:

```sh
npm run typecheck
npm run lint
npm test
npm run audit:strict
```

- Do not hand-check what the audit decides: layout, one class per file,
  private methods that never read `this`, missing method comments, exports no
  other file imports, test-double placement, root-entry imports, and
  cross-package copies.
- Resolve each audit `review` item in a touched file by reading the code.
- If you cannot run commands, say so and continue with pass 2. Never claim the
  checks passed.

## 2. Judgment Checklist

No tool checks these. Check each one against the changed files:

- **Copied helpers.** For each new function, predicate, error factory, option
  check, or test double, search the repository for an existing one. A second
  copy is a finding even when jscpd misses it.
- **Inline test doubles.** A fake, stub, or fixture written inside a test file
  that another test could use belongs in `src/testing/`.
- **Package surface.** Each new `index.ts` export is needed by another
  package. The audit skips entry points, so this is yours to check.
- **Why-comments.** Each new comment explains purpose, policy, or invariant
  rather than narrating the code. The audit only checks that one exists.
- **KISS.** Flag indirection, layers, or types with one user. Do not demand
  abstractions for hypothetical reuse.
- **Stateful classes.** A sequence repeated three or more times without a named
  helper, or early-exit checks that repeat their failure handling (see the
  stateful-class rule in `AGENTS.md`). A long class whose transitions share
  state is not a finding.
- **Boundaries.** Anything that breaks **Core Architecture Boundaries** in
  `AGENTS.md`, plus database row shapes leaking past their repository.
- **Tests.** Missing or weak tests for changed behavior, or tests coupled to
  internals.
- **Vocabulary.** Names that use a synonym `GLOSSARY.md` lists under **Avoid**.
- **Docs.** Incorrect active documentation, or a completed plan ticket without
  a recorded status (see **Documentation Rules** in `AGENTS.md`).

## 3. Spec Fit

Compare the change to the user request, `docs/specs/`, `docs/adrs/`, and
`AGENTS.md`. Source and executable tests are canonical for implemented
behavior. Report meaningful drift from specs and plans, but do not demand code
changes solely to match a completed document.

## Output

List findings first, ordered by severity, with `path:line` references. Then
state which mechanical checks ran and their results. If there are no findings,
say so and name residual risks or missing verification.
