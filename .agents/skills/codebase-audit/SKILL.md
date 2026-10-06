---
name: codebase-audit
description: Repo-wide kraziTV audit of folder structure, file composition, and duplicate code against AGENTS.md. Run only when the user asks for a codebase audit or a layout/duplication sweep.
---

# Codebase Audit

Audit the whole repository against the source-layout, file-composition, and
no-copy rules in `AGENTS.md`. The audit has two layers:

| Layer      | Decides                          | How                                       |
| ---------- | -------------------------------- | ----------------------------------------- |
| Mechanical | Rules a parser can decide        | `npm run audit` (scripts/codebase-audit/) |
| Judgment   | Rules that need reading the code | This skill's checklist                    |

Use `code-review` instead for a single diff or PR.

## Authoritative Sources

- `AGENTS.md`: the rules. Quote the section a finding violates.
- Accepted ADRs in `docs/adrs/`: architecture policy. An accepted ADR can
  sanction what `AGENTS.md` would otherwise flag (ADR 0011 keeps one fake
  process per consumer, for example).
- `scripts/codebase-audit/audit-exceptions.json`: decided exceptions, each
  with a reason and source.
- Source and tests: what the system does today.

## Never

- Never report a finding that an accepted ADR or a recorded exception
  sanctions. Check both before reporting.
- Never add, change, or remove an exception without the user deciding it.
  Propose the entry; let the user accept it.
- Never fix findings during the audit. Report first; fix only what the user
  picks.
- Never report findings against paths in `excludedPaths`. Their imports still
  count as consumers of audited packages.

## Steps

1. Run `npm run audit -- --json`. Every `error` is a rule violation. Every
   `review` item needs the judgment in step 2. Treat the output as the
   baseline; do not re-derive what it already checks.
2. Resolve each `review` item by reading the code:
   - `grouping`: do the folder's files serve one capability or several?
   - `file-size`: does the class read as its transitions? Apply step 3.
   - `shared-type-placement`: is the type truly shared across the domain, or
     owned by the file that implements it?
   - `duplicate-code`: does sharing it remove a real maintenance risk, or add
     indirection KISS would reject?
   - `test-double-placement` in a test file: is it a reusable double, or a
     one-off stub that reads better inline?
   - `stale-exception`: confirm the code changed, then propose removing it.
3. Check what the script cannot see, file by file:
   - Stateful classes: a sequence repeated three or more times without a
     named helper; a chain of early-exit checks that is not one function
     returning the first failure; error factories, record types, or pure
     checks left inside the class file.
   - Duplication below the jscpd threshold: the same small helper, schema,
     or projection written in several files.
   - Package surface: whether used exports expose unnecessary policy or
     configuration. The `unused-package-export` rule checks named exports;
     namespace imports, literal dynamic imports, and star re-exports
     conservatively count as using the whole surface, so inspect those consumers
     manually. Computed import paths and unnamed star exports need manual review.
   - Why-comments that narrate the code instead of explaining why.
   - Vocabulary: names that use a synonym `GLOSSARY.md` lists under **Avoid**.
4. For every candidate finding, check accepted ADRs and the exceptions file.
   If an ADR sanctions it, drop it and say so once in the report.

## Report

Group findings, most severe first within each group:

1. **Folder structure and file composition**
2. **Duplicate code**
3. **Minor**

Each finding states the rule (quote `AGENTS.md`), the files as clickable
`path:line` links, and the concrete fix. End with a suggested fix order and
any proposed exceptions for the user to accept or reject.

## Verification

- `npm run audit` ran and its output is reflected in the report.
- Every reported finding cites an `AGENTS.md` rule or ADR.
- No finding contradicts an accepted ADR or a recorded exception.
- After fixes, rerun `npm run audit`; it must show no new errors.
