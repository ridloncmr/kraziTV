# Spec 0003: Release Readiness

Status: In Development

## Intent

A first-time user can install from a published image by following the README
alone, every operator and contributor document tells the truth about today's
code, the audit's layout rule is decided rather than excepted around, and the
contributor-only cleanups the audit found are done rather than deferred
(decision 9).

## Behavior

### Install

- A GitHub Release publishes the image to GHCR; the README's quick start pulls
  it (decision 6). `THIRD_PARTY_NOTICES.md` is regenerated with the image.
- The README says TV exists and that collections are suggested, not created.
  The running guide drops its stale limits, mentions TV in First Steps, and
  tells from-source installs to set `PUBLIC_BASE_URL` beside `HOST`.
- The README's four screenshots show today's desktop, including TV.

### Contributing

- `CONTRIBUTING.md` and the `AGENTS.md` exit gate list every check CI runs,
  including `agents:check` and `build`; say that the browser suite and
  `npm test` need built packages; say how to run one test; list every root
  script; and describe the server's domains rather than calling it wiring.

### Docs and vocabulary

- Spec statuses, plan tickets, the knowledge-base index, the research skill's
  filename advice, and the one broken link agree with the code.
- The glossary gains **Metadata refresh** and says that the verb `logIn` and
  the `/auth/login` route are allowed. `AGENTS.md` and the media-engineer role
  say signal session, not encoding session.

### The layout count rule (decision 5)

- ADR 0010 and `AGENTS.md` say whether kind folders (one file per table,
  migration, drawing, or API area) are exempt from the more-than-eight count.
  The audit implements that answer, and `migrations/` duplicate DDL is
  excluded by path rather than excepted pair by pair.
- `apps/web/src/controls/` and `apps/web/src/channels/assignments/` are
  regrouped; their exceptions are removed. `apps/web/src/tv/` gets a
  grouping exception. Stale reasons are rewritten.

### Contributor hygiene

- `FfmpegSignalSession` has one release helper and a `ProcessBinding` class;
  `packaging/` is grouped into argument construction and session running.
- Schedule previews leave `ScheduleService` for `schedules/preview/`.
- Media Library's dialogs are one union state rendered by one component.
- The small items: one `#readKeyAndWaiting` in the match-choice service, the
  dead `displayDay` export, `schedule-window-path.ts` beside its only caller,
  a named error from `programOf`, the `PreparationOwner` interface decided,
  and the six negative-wait sleeps replaced with deterministic settling.
- `useResource` and the media picker have direct tests.

## Acceptance Targets

- `docker pull ghcr.io/ridloncmr/krazitv` then the README's run command
  starts kraziTV on a clean machine.
- `npm run audit:strict` passes with no exception for `controls/` or
  `channels/assignments/` and no file-size review item.
- The link checker finds no broken relative link.
- Every command CONTRIBUTING names exists; every check CI runs is named.

## Out Of Scope

- Jellyfin, M3U, and anything the README lists as planned.
