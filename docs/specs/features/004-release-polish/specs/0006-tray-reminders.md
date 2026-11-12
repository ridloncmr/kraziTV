# Spec 0006: Tray Reminders And The Tray Assistant

Status: Implemented

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
  is outstanding when it was never looked up or its last lookup failed. A
  file never looked up counts only when a lookup would search for it: an
  episode with a series and episode number, or a movie title. A disc track
  before mapping, or a file naming no episode, is never outstanding, though
  the **Not looked up** filter still lists it.
- Account Settings then returns to its home page, which says how many files
  are being looked up: "kraziTV is looking up 1,234 files on TMDB. Keep
  working; the tray will tell you when it's done." ("1 file" for one). When
  the lookup started nothing, or could not start, it reads "Your TMDB key is
  saved." instead. The sentence stays until the owner picks another task.
- A root with a scan or lookup already running is skipped. A running scan
  that has not reached its lookup step yet uses the new key on its own; the
  outstanding-files reminder below catches anything else.
- While any lookup runs and no reminder shows, the tray icon shows, and its
  tooltip reads "Looking up files on TMDB: 340 of 1,234". Clicking it opens a
  status balloon with the same count as its title, Gregg's quip, the sentence
  "kraziTV is looking your files up on TMDB. Keep working; the tray will tell
  you when it's done.", and only a close button. ✕ and Escape close it
  without storing anything. No balloon opens by itself for progress.

### Tray reminders

A tray reminder is a condition the desktop shell watches, with a balloon that
explains it. Every reminder follows the same rules:

- **Shows, and holds.** A reminder shows while the tray icon carries it, and
  holds while its balloon may open by itself. For reminders 2 and 3 these are
  the same condition. Reminder 1 shows whenever no key is set, but holds only
  once a media root exists, so the setting is never lost even with nothing to
  look up yet.
- **One icon.** The tray shows the assistant's 16 px head while any reminder
  shows or a lookup runs, whatever the owner chose about balloons, so a
  reminder is never lost. Its accessible name and tooltip are the title of
  the balloon it would open.
- **One balloon at a time.** When several reminders show, the first in the
  table below leads. Clicking the icon opens that one.
- **Opens by itself at most once per desktop start.** A reminder's balloon
  opens by itself the first time it leads while it holds after the desktop
  starts, if the owner's stored choice says it is due. It may first hold
  mid-session, such as when lookups finish. Closing it never brings it back
  before the next desktop start, and a reminder that only shows never opens
  by itself.
- **The same three answers.** The main action, **Remind me later** (and ✕ and
  Escape), which waits 7 days, and **Don't remind me**, which stops it opening
  by itself in this browser. The main action snoozes like **Remind me later**.
  Reminder 3 adds a fourth, **Remind me after** a number of new ones,
  described below. Each reminder stores its own choice.
- **Never takes focus on its own.** As today, an automatic balloon never moves
  focus from the window the owner is using; one the owner opens focuses its
  main action.
- **A plain title and a plain sentence.** The assistant's quip is one extra
  line. The title and sentence alone always say what is wrong and what the
  button does.

| Order | Reminder            | Shows while                                                                                                                        | Title                                     | Sentence                                                                                           | Main action                                                     |
| ----- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 1     | TMDB isn't set up   | No key is set; it holds only once at least one media root exists                                                                   | TMDB isn't set up                         | kraziTV can only read titles from file names. Set up TMDB to look up series, episodes, and movies. | **Set up TMDB**: opens Account Settings on the Set up TMDB task |
| 2     | Files not looked up | A key is set, no scan or lookup runs, and some enabled root has outstanding never-looked-up files, those a lookup would search for | 312 files haven't been looked up on TMDB  | Look them up so kraziTV can name their shows and suggest collections.                              | **Look them up**: starts the same lookup a key save starts      |
| 3     | Collections ready   | A key is set, no scan or lookup runs, nothing is left to look up, and at least one collection recommendation is still to decide    | kraziTV found 14 shows and 3 movie series | Make them into collections, then put them on a channel.                                            | **Make collections**: opens Collections on Discover             |

- Reminder 1 is the existing TMDB reminder. Its words, condition, and stored
  choice carry over, so an owner who chose **Don't remind me** before this
  change is not asked again. Its icon still shows whenever no key is set, as
  spec 0001 has it. Like every reminder, it now opens by itself the first
  time it holds after the desktop starts, which can be mid-session, such as
  right after the first media root is added.
- Reminder 2 counts only files never looked up, not failed lookups, so a
  rejected key or a TMDB outage does not nag. Its action still retries failed
  lookups along with them. For one file its title and sentence read "1 file
  hasn't been looked up on TMDB" and "Look it up so kraziTV can name its show
  and suggest collections.", but its button always reads **Look them up**, so
  every page and piece of advice names one action.
- "Nothing is left to look up" means reminder 2's count is 0: failed lookups
  and disabled roots never keep reminder 3 away.
- Reminder 3 counts only recommendations still to decide: one already
  accepted or dismissed is never counted. Its title counts them by kind:
  series as "shows", franchises as "movie series", leaving out a kind with
  none ("kraziTV found 14 shows"; "kraziTV found 1 show"). With only one, its
  sentence reads "Make it into a collection, then put it on a channel." It is
  how a first-time owner learns kraziTV can make collections for them; the
  Discover dialog stays the place to choose them.
- Reminder 3 is also due only when there are more recommendations than when
  the owner last answered it, which the browser stores with its choice.
  Recommendations the owner has already seen never bring it back on their
  own, so an owner who ignores them is not asked every week. This holds for
  **Make collections**, **Remind me later**, ✕, Escape, and **Don't remind
  me**, as decision 24 has it.
- Reminder 3's balloon also offers **Remind me after**, on a row of its own
  under the other answers: the button, a number field labelled "New ones to
  wait for" holding 5 at first, and the words "new ones". Choosing it closes
  the balloon and brings it back once that many new recommendations are
  waiting, with no 7-day wait. New ones are counted from the fewest still to
  decide that the browser has seen since the answer, so making collections
  out of the ones already shown never holds it back: answered "after 5" with
  17 waiting, then all 17 decided, it returns once 5 more are waiting. The
  field takes whole numbers from 1 to 99; anything else stores nothing and
  the balloon says "Enter a whole number from 1 to 99." under the row.
  Pressing Enter in the field chooses it, and Escape still closes the
  balloon as ✕ does. Its title, sentence, and Gregg's quip are unchanged,
  and opening by itself still never focuses the field.

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
- **Quips.** One line under the title, in his manner:

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
- The progress dialog every lookup opens, from **Look up on TMDB** or a
  file's or folder's retry, is titled **Looking up files on TMDB** and ends
  with **TMDB lookup completed.**, since it no longer only retries.

## Technical Behavior

### Server

- `RootMatchCounts` gains `notLookedUp`: available, non-extra items whose
  match state is `not_looked_up` and that a lookup would search for
  (`wouldSearch` in `catalog-scan/enrichment/group-lookups.ts`).
  `GET /media-roots` carries it with the other counts.
- The lookup retry scope `failed` becomes `outstanding`: items never looked up
  that a lookup would search for (`wouldSearch`), or whose last lookup failed,
  using the existing `isRetryable` and `isFailedLookup` predicates. Its
  `mediaRootId` is optional; without one,
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
  outstanding lookup, and Account Settings' home page shows its count. The
  key route does not start lookups itself: it stays a metadata-key route, and
  if the second request fails, reminder 2 offers the same lookup again.
- Set up TMDB reports the key changed only once its lookup has answered, and
  the shell then re-reads the roots before the key, so no reminder sees the
  new key beside roots read before the lookup started.
- The shell already reads `/media-roots`, which carries each root's job and
  counts, but only at desktop start and when the page is shown again.
  Whenever something starts a job, the shell refreshes that read: the Set up
  TMDB task's lookup, the tray's **Look them up**, and Media Library's **Look
  up on TMDB** or a scan. Programs reach it through a callback the shell
  passes down through the program host (`ProgramContents`), as it passes
  `onTmdbKeyChanged` to Account Settings; the tray,
  which lives in the shell, refreshes it directly.
- While any root's job runs, the shell polls `/media-roots` every few seconds
  so the tray count moves and reminders 2 and 3 can open when lookups end. It
  reads `/media-collections/recommendations` only while reminder 3's other
  conditions hold, and reads them again whenever Discover accepts, dismisses,
  or restores one, so reminder 3's count follows the owner's decisions.
- `tmdb-reminder/` becomes `tray-reminders/`: the reminder list (each entry a
  condition, words, and a main action), the stored choices, the balloon, and
  the assistant drawn as one SVG per file under `drawings/`. Words live in one
  `*-words.ts` beside them (decision 1). The TMDB reminder keeps its storage
  key `krazitv.tmdbReminder`; Files not looked up stores under
  `krazitv.notLookedUpReminder` and Collections ready under
  `krazitv.collectionsReadyReminder`. Each stores `{ remindAfter }` or
  `{ never: true }`, as the TMDB reminder always has, except that Collections
  ready's snooze also stores the count it was answered at,
  `{ remindAfter, answeredCount }`, for decision 24, and its **Remind me
  after** stores `{ afterNew, lowestSeen }`: the number chosen and the count
  still to decide when it was chosen. Whenever the shell reads fewer
  recommendations still to decide while that answer stands, it lowers
  `lowestSeen` to that count, and the reminder is due once the count reaches
  `lowestSeen + afterNew`. Only a read made for the library's latest settle
  counts, never a count of 0 taken while files are left to look up.
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
  each idle enabled root holding them, and Account Settings names the file
  count. A busy root is skipped and reported.
- After those jobs end with recommendations, the Collections ready balloon
  opens by itself once, and **Make collections** opens Collections on
  Discover.
- With outstanding never-looked-up files, those a lookup would search for,
  still left after jobs end, the Files not looked up balloon opens by itself
  once, and **Look them up** starts the lookup.
- An owner who chose **Don't remind me** on the TMDB balloon before this
  change does not see it open by itself afterwards.
- Each reminder's **Remind me later**, ✕, Escape, and **Don't remind me** are
  stored per reminder; one never silences another.
- Collections ready's **Remind me after** stores the number chosen with the
  count it was chosen at, and the balloon opens by itself again once that
  many new recommendations are waiting, counted from the fewest seen since,
  with no 7-day wait. A number outside 1 to 99, or not whole, is refused and
  stores nothing.
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
