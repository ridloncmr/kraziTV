# Release Polish Feature

Status: Implemented

This feature takes kraziTV from "works" to "a non-technical first-time user,
with minimal prompting, builds channels and enjoys it", inside the Windows XP
desktop look. It comes from the release-polish audit of 2026-10-28 (commit
`d175cd2`), its second run on 2026-11-03 (commit `5d3c498`), and its third
run on 2026-11-05 (commit `555d895`), which walked the first-run path, read
every desktop program beside its screenshot, and checked the code and docs
against `AGENTS.md`. The audit
report itself lives outside git under `data/polish-audit/`; everything a
contributor needs is restated in the specs and plans here.

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

Settled with the owner on 2026-11-03 after the audit ran again (commit
`5d3c498`):

10. The Rule dialog keeps OK and Cancel. Decision 8's footer stays on the
    channel General tab and Show Properties; a rule is created or edited
    whole.
11. `channels/lineup/` is pre-split now: the picks files move into
    `lineup/picks/`. The other folders at the eight-file limit split when
    their ninth file arrives.
12. The browser suite's first-run walk runs once, at 1280×800. The folder
    browser's narrow-window test stays as a narrow desktop window case, not a
    phone.
13. The TMDB task stays in Account Settings. Its description names TMDB, and
    Media Library offers **Set up TMDB…** while no key is set.
14. The glossary gains **Schedule preview** for the read-only "what would
    air" computation (code name `SchedulePreview`).

Settled with the owner on 2026-11-05 after the third run (commit `555d895`):

15. The owner's sentence for a bad marathon length and for a rejected TMDB
    key is chosen by a kind the server sends beside its message, never by
    matching another package's prose.
16. All seven first-run shortcuts in spec 0005 are in scope: Discover on both
    Collections tabs, the empty-scan sentence, Watch from Channel Properties
    and the guide card, TV keys, Live Monitor's remembered channel, the
    account in the Start header, and a confirmation before removing the TMDB
    key.
17. The browser suite's scan-progress scenario drops its 390-wide pass; the
    wide and reduced-motion passes stay.
18. Channel and collection names are capped at 120 characters on the server,
    refused with the existing too-long words.

Settled with the owner on 2026-11-05 after spec 0005's first round merged
(commit `69f61b8`):

19. **Reshuffle…** starts a new random order. A random show's progress reset
    counts into its random seed, so each reshuffle gives a fresh order that
    is still the same on every run with the same inputs. This amends
    programming spec 0003, whose reset kept the seed.
20. The leftovers the third pass's reviews found become a second round of
    spec 0005 (POLISH-054 to 062) rather than a new spec, and each is fixed
    everywhere the same bug occurs, not at the one place a reviewer saw it.

## Related Specs

Specs are listed in delivery order. Each spec's status is the `Status:` line at
the top of the spec.

| Spec                                                        | Description                                                                                                                                                     |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [0001-first-run-flow](specs/0001-first-run-flow.md)         | The first-run path without stalls, and the property-sheet footer                                                                                                |
| [0002-owner-facing-words](specs/0002-owner-facing-words.md) | Every word the owner reads comes from the web app in owner vocabulary                                                                                           |
| [0003-release-readiness](specs/0003-release-readiness.md)   | Published image, truthful docs, the audit rule, and contributor hygiene                                                                                         |
| [0004-second-polish-pass](specs/0004-second-polish-pass.md) | What the second audit found: dialog footers, unreachable-server words, the last developer words, and contributor items                                          |
| [0005-third-polish-pass](specs/0005-third-polish-pass.md)   | What the third audit found: a Preview tab that always answers, the last owner words, first-run shortcuts, kinds over prose, and the leftovers its reviews found |

## Out Of Scope

- A setup wizard, a getting-started checklist, or a different desktop order.
- Phone-width layout, touch target sizing, and the TV picture on a phone.
- New programming features. Behavior changes here are limited to when a
  dialog appears and what words a screen uses, apart from decision 19's
  reshuffle.
