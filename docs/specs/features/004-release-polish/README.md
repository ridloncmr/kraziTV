# Release Polish Feature

Status: In Development

This feature takes kraziTV from "works" to "a non-technical first-time user,
with minimal prompting, builds channels and enjoys it", inside the Windows XP
desktop look. It comes from the release-polish audit of 2026-10-28 (commit
`d175cd2`), which walked the first-run path, read every desktop program beside
its screenshot, and checked the code and docs against `AGENTS.md`. The audit
report itself lives outside git under `data/polish-audit/`; everything a
contributor needs is restated in the specs and plans here.

This feature defines the bar for kraziTV 1.0.

## Decisions

Settled with the owner on 2026-10-28 before the work was split up. Tickets cite
these instead of re-deciding them.

1. Owner-facing words live in the web app. The server returns codes plus
   `details` and never embeds IDs or copy in `message`. Each web domain keeps
   one `*-words.ts` beside its screens, as `airing-words.ts`,
   `match-state-label.ts`, and `removal-messages.ts` already do.
2. Programs open other programs through the one `openProgram` callback the
   program host already supplies; no program grows its own.
3. There is no first-run wizard and no desktop reordering. First-run stalls
   are fixed where they happen.
4. Lineup writes on a channel with no airing program apply silently. The
   rebuild question appears only while a program is airing.
5. The source-layout count rule is decided once, in ADR 0010 and `AGENTS.md`,
   before folders are regrouped.
6. The Docker image is published before the quick start is rewritten around
   it.
7. Phone width is not a supported layout. Phone-only findings are closed.
8. Property sheets use the XP footer: OK, Cancel, Apply at the bottom right,
   Apply enabled only when something changed. Editors over long lists keep
   their save bar.
9. Contributor-only refactors are part of this release, not deferred.

## Related Specs

Specs are listed in delivery order. Each spec's status is the `Status:` line at
the top of the spec.

| Spec                                                        | Description                                                             |
| ----------------------------------------------------------- | ----------------------------------------------------------------------- |
| [0001-first-run-flow](specs/0001-first-run-flow.md)         | The first-run path without stalls, and the property-sheet footer        |
| [0002-owner-facing-words](specs/0002-owner-facing-words.md) | Every word the owner reads comes from the web app in owner vocabulary   |
| [0003-release-readiness](specs/0003-release-readiness.md)   | Published image, truthful docs, the audit rule, and contributor hygiene |

## Out Of Scope

- A setup wizard, a getting-started checklist, or a different desktop order.
- Phone-width layout, touch target sizing, and the TV picture on a phone.
- New programming features. Behavior changes here are limited to when a
  dialog appears and what words a screen uses.
