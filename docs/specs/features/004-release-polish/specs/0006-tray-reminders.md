# Spec 0006: Tray Reminders And The Tray Assistant

Status: Accepted

## Problem

A first-time owner tried a fresh rc.5 install on 2026-11-08 and got through
logon, adding a media root, scanning it, and setting up TMDB without help.
Then they stopped. They wanted to build a channel next, but what they needed
was the TMDB lookups their first scan could not make: every file scanned
before the key existed stays **Not looked up**, so there were no series, no
collection recommendations, and nothing easy to put on a channel. Nothing on
screen said so, and nothing looked the files up for them.

The tray already has one reminder, the TMDB setup balloon from
[programming spec 0001](../../002-programming/specs/0001-metadata-enrichment.md#tmdb-setup-reminder).
It worked: the owner found TMDB through it. This spec makes the step after it need
no reminder at all, and grows the one balloon into a small set of tray
reminders written in the words of an original kraziTV character.

## Goals

- Saving a TMDB key looks up every file that was never looked up, with no
  further action from the owner.
- When those lookups finish, the tray tells the owner what kraziTV found and
  opens the next step: making collections.
- Lookups left over, because a root was busy, the server restarted, or the
  owner cancelled, are offered again from the tray in one click.
- One tray icon and one balloon system carry every reminder, so each new
  reminder is a list entry, not a new component.
- The tray assistant gives the reminders a face and a manner without ever
  hiding what to do.

## Non-Goals

- Reminders to probe files again after an upgrade, such as for the source
  facts a future broadcast profiles feature adds. That feature decides how its
  backfill happens (decision 23 in the [feature README](../README.md)).
- A notification center, history, or error toasts. Failures keep showing
  where they happen.
- Creating collections automatically. Accepting a collection recommendation
  stays the owner's explicit choice.
- Server-side reminder state. Reminder choices stay desktop shell state in the
  browser, as the TMDB reminder's do today.
- A setup wizard or checklist (decision 3).

## User-Facing Behavior

### Saving a key looks the library up

- When **Save** in the Set up TMDB task stores a valid key, kraziTV starts a
  lookup of every outstanding file on every enabled, idle media root. A file
  is outstanding when it was never looked up or its last lookup failed.
- The task's saved confirmation then says how many files are being looked up:
  "kraziTV is looking up 1,234 files on TMDB. Keep working; the tray will tell
  you when it's done." With nothing outstanding it says only that the key is
  saved, as today.
- A root with a scan or lookup already running is skipped. A running scan
  that has not reached its lookup step yet uses the new key on its own; the
  outstanding-files reminder below catches anything else.
- While any lookup runs, the tray icon shows, and its tooltip reads "Looking
  up files on TMDB: 340 of 1,234". Clicking it opens a status balloon with the
  same count and a close button. No balloon opens by itself for progress.

### Tray reminders

A tray reminder is a condition the desktop shell watches, with a balloon that
explains it. Every reminder follows the same rules:

- **One icon.** The tray shows the assistant's 16 px head while any reminder's
  condition holds or a lookup runs, whatever the owner chose about balloons,
  so a reminder is never lost. Its accessible name and tooltip are the title
  of the balloon it would open.
- **One balloon at a time.** When several reminders hold, the first in the
  table below wins. Clicking the icon opens that one.
- **Opens by itself at most once per desktop start.** A reminder's balloon
  opens by itself the first time its condition holds after the desktop
  starts, if the owner's stored choice says it is due. Its condition may first
  hold mid-session, such as when lookups finish. Closing it never brings it
  back before the next desktop start.
- **The same three answers.** The main action, **Remind me later** (and ✕ and
  Escape), which waits 7 days, and **Don't remind me**, which stops it opening
  by itself in this browser. The main action snoozes like **Remind me later**.
  Each reminder stores its own choice.
- **Never takes focus on its own.** As today, an automatic balloon never moves
  focus from the window the owner is using; one the owner opens focuses its
  main action.
- **A plain title and a plain sentence.** The assistant's quip is one extra
  line. The title and sentence alone always say what is wrong and what the
  button does.

| Order | Reminder            | Shows while                                                                                                           | Title                                     | Sentence                                                                                           | Main action                                                     |
| ----- | ------------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 1     | TMDB isn't set up   | No key is set and at least one media root exists                                                                      | TMDB isn't set up                         | kraziTV can only read titles from file names. Set up TMDB to look up series, episodes, and movies. | **Set up TMDB**: opens Account Settings on the Set up TMDB task |
| 2     | Files not looked up | A key is set, no scan or lookup runs, and some enabled root has files never looked up                                 | 312 files haven't been looked up on TMDB  | Look them up so kraziTV can name their shows and suggest collections.                              | **Look them up**: starts the same lookup a key save starts      |
| 3     | Collections ready   | A key is set, no scan or lookup runs, nothing is left to look up, and there is at least one collection recommendation | kraziTV found 14 shows and 3 movie series | Make them into collections, then put them on a channel.                                            | **Make collections**: opens Collections on Discover             |

- Reminder 1 is the existing TMDB reminder. Its words, condition, and stored
  choice carry over, so an owner who chose **Don't remind me** before this
  change is not asked again. Like every reminder, it now opens by itself the
  first time its condition holds after the desktop starts, which can be
  mid-session, such as right after the first media root is added.
- Reminder 2 counts only files never looked up, not failed lookups, so a
  rejected key or a TMDB outage does not nag. Its action still retries failed
  lookups along with them.
- Reminder 3's title counts recommendations by kind: series as "shows",
  franchises as "movie series", leaving out a kind with none ("kraziTV found
  14 shows"). It is how a first-time owner learns kraziTV can make collections
  for them; the Discover dialog stays the place to choose them.
- Reminder 3 is also due only when there are more recommendations than when
  the owner last answered it, which the browser stores with its choice.
  Recommendations the owner has already seen never bring it back on their
  own, so an owner who ignores them is not asked every week.

### The tray assistant

The assistant is Gregg, kraziTV's own character, drawn for this release. He
is not Clippy, not a paperclip, and borrows nothing from Microsoft's Office
Assistant: no paperclip, no wire eyebrows, no "It looks like you're…" line.

- **Look.** A small beige CRT television with rabbit-ear antennas. His screen
  is his face: half-lidded, tired eyes, a flat mouth. He wears a green
  accountant's eyeshade visor and a loosened tie, and a cigarette hangs from
  the corner of his mouth.
- **Personality.** A disillusioned tax man. He has seen every shoebox of
  receipts and expects nothing from anyone. He speaks in dry, weary office
  talk (forms, filing, audits, deadlines, paperwork) and he is never mean to
  the owner and never comments on what is in their library. He does the work
  anyway. His name is Gregg with two g's; the second is for glee, which he
  insists he has and nobody has ever seen.
- **Where he appears.** At 48 px beside the title of every balloon, and at
  16 px as the tray icon. He has no window of his own and never moves around
  the desktop.
- **Motion.** The balloon fades in as it does today. A thin wisp of smoke
  drifts from the cigarette while a balloon is open; with reduced motion it
  is still. Nothing else moves.
- **Quips.** One line under the title, in his manner. First drafts:

  | Reminder            | Quip                                                                       |
  | ------------------- | -------------------------------------------------------------------------- |
  | TMDB isn't set up   | Right now I'm reading titles off file names. Nobody should live like this. |
  | Files not looked up | Paperwork doesn't file itself. I've checked.                               |
  | Collections ready   | I sorted your whole library. No, nobody thanked me either.                 |
  | Lookups running     | It's being processed. Everything is always being processed.                |

### Media Library

- A root's **Matches** column adds "312 not looked up" beside its other
  counts while it has any.
- The root menu's **Retry failed lookups** becomes **Look up on TMDB**, which
  looks up the root's outstanding files, never-looked-up and failed alike. It
  is enabled while the root is enabled, has any, and a key is set.

## Technical Behavior

### Server

- `RootMatchCounts` gains `notLookedUp`: available, non-extra items whose
  match state is `not_looked_up`. `GET /media-roots` carries it with the
  other counts.
- The lookup retry scope `failed` becomes `outstanding`: items never looked up
  or whose last lookup failed, using the existing `isRetryable` and
  `isFailedLookup` predicates. Its `mediaRootId` is optional; without one,
  `POST /metadata/lookup-retries` starts a retry on every enabled root that has
  outstanding items and no running job, and skips the rest. Media Library's
  menu was the only caller of `failed`, so the old scope is removed, not kept
  beside the new one.
- The all-roots response reports how many items its started jobs will look up
  and how many roots it skipped as busy, so the Set up TMDB task can say how
  many files are being looked up. A server with no key refuses it as a single
  retry is refused today (`tmdb_key_missing`).
- Nothing else changes. A lookup retry already commits, asks collection
  maintenance for a pass, and runs the schedule pass when it ends; that is how
  recommendations appear.

### Web

- The Set up TMDB task, after a successful save, asks for the all-roots
  outstanding lookup and shows its count. The key route does not start
  lookups itself: it stays a metadata-key route, and if the second request
  fails, reminder 2 offers the same lookup again.
- The shell already reads `/media-roots`, which carries each root's job and
  counts, but only at desktop start and when the page is shown again.
  Whenever something starts a job, the shell refreshes that read: the Set up
  TMDB task's lookup, the tray's **Look them up**, and Media Library's **Look
  up on TMDB** or a scan. Programs reach it through a callback the shell
  passes down through the program host (`ProgramContents`), the way
  `onTmdbKeyChanged` carries `tmdbKey.refresh` to Account Settings; the tray,
  which lives in the shell, refreshes it directly.
- While any root's job runs, the shell polls `/media-roots` every few seconds
  so the tray count moves and reminders 2 and 3 can open when lookups end. It
  reads `/media-collections/recommendations` only while reminder 3's other
  conditions hold.
- `tmdb-reminder/` becomes `tray-reminders/`: the reminder list (each entry a
  condition, words, and a main action), the stored choices, the balloon, and
  the assistant drawn as one SVG per file under `drawings/`. Words live in one
  `*-words.ts` beside them (decision 1). The TMDB reminder keeps its storage
  key `krazitv.tmdbReminder`; each new reminder gets its own key in the same
  shape.
- `ProgramTask` gains a task that opens Collections with its Discover dialog
  open, beside `set-up-tmdb`.

## Data Model Impact

No database change. One new count in `GET /media-roots`, one renamed retry
scope, and browser `localStorage` keys for the new reminders' choices.

## Architecture Boundaries

| Area                | Affected                                                                            |
| ------------------- | ----------------------------------------------------------------------------------- |
| Schedule            | No. Lookups already regenerate what their metadata changes, unchanged               |
| Playout timeline    | No                                                                                  |
| Channel state       | No                                                                                  |
| kraziBrain          | No                                                                                  |
| SignalPackager      | No                                                                                  |
| Provider adapters   | No                                                                                  |
| Catalog scan        | One retry scope and its all-roots form                                              |
| Desktop shell (web) | Tray reminders, the assistant, Set up TMDB's confirmation, Media Library's root row |

Reminders are desktop shell state: they read server state and never decide
programming, enrichment, or what collections exist.

## Open Questions

None.

## Acceptance Criteria

- Saving a key on a catalog with never-looked-up files starts a lookup job on
  each idle enabled root holding them, and the Set up TMDB task names the
  file count. A busy root is skipped and reported.
- After those jobs end with recommendations, the Collections ready balloon
  opens by itself once, and **Make collections** opens Collections on
  Discover.
- With files still never looked up after jobs end, the Files not looked up
  balloon opens by itself once, and **Look them up** starts the lookup.
- An owner who chose **Don't remind me** on the TMDB balloon before this
  change does not see it open by itself afterwards.
- Each reminder's **Remind me later**, ✕, Escape, and **Don't remind me** are
  stored per reminder; one never silences another.
- No automatic balloon moves focus. The tray icon is labelled with the
  balloon it opens. Smoke is still under reduced motion.
- Media Library shows the not-looked-up count and **Look up on TMDB**
  replaces **Retry failed lookups**.
- Server tests cover the `outstanding` scope with and without a root, busy
  and disabled roots, and the refusal without a key. Web tests cover each
  reminder's condition, priority, once-per-start opening, and stored choices.
- The browser suite's first-run walk saves a key after scanning and reaches
  the Collections ready balloon and Discover.
- The wiki's First Run, Set Up TMDB, The Desktop, and Media Library pages
  describe the reminders, the assistant, and the new root menu item, with
  refreshed screenshots, and Troubleshooting's **Lookup failed** advice names
  **Look up on TMDB** instead of **Retry failed lookups**.
