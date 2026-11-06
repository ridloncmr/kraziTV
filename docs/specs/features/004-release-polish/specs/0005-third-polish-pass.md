# Spec 0005: Third Polish Pass

Status: Implemented

## Intent

The release-polish audit was run a third time on 2026-11-05 (commit
`555d895`) after spec 0004 shipped as waves 1 and 2. It found no blockers and
one major item: a channel whose show has nothing to air answers the Preview
tab, the "did my channel work?" screen, with the server's verdict and no next
step. Around it sit a dozen small items on the same first-run screens, three
residuals from spec 0004, and a short list of things a first-time owner
notices in the first ten minutes that are each a day's work. This spec closes
them so the audit's next run finds the first-run path clean and the
contributor path mapped. It extends specs 0001, 0002, and 0004; its first
round changes no programming behavior.

A second round, added on 2026-11-05 after the first merged (decisions 19
and 20), closes the leftovers that round's reviews found: about twenty small
items, most of them the same bug the first round fixed in one place still
present in another. It fixes each everywhere it occurs. It changes one
programming behavior: **Reshuffle…** starts a new random order.

## Behavior

### The Preview tab always answers

- When the server refuses a preview because the channel cannot air
  (`channel_unschedulable`), the Preview tab and the special editor's
  **Preview** say what to change, by the refusal's reason: with no shows,
  "This channel has no shows yet. Add shows on the Lineup tab."; with shows
  whose media cannot air, the channel's off-air words that Live Monitor and
  the empty Preview already use. The server's sentence never shows.
- A turn that is already under way reads as continuing, never as starting
  later: "continues at 7:35 AM · Suits · 1 more episode (43 min)". The time
  shown is when its next program starts, and the words say so.
- On a Random show, the Up Next tab's reset button and its confirmation say
  what a reset does for a random order: the button reads **Reshuffle…** and
  the question is "Start Monk's random picks over on this channel? What is
  airing now finishes; the schedule after it is rebuilt." Ordered modes keep
  **Restart from the beginning…**.

### Owner words, remaining cases (decision 1)

- The Add media root field is labelled "Folder on the kraziTV server", never
  "Absolute server path".
- Live Monitor describes itself as "See what each channel is airing right
  now" on the desktop, in Start, and in its status bar, never "channel
  state".
- The web maps the five server refusals an owner can still trigger to owner
  sentences that say what to do: `internal_error` ("kraziTV hit a problem it
  could not recover from. Try again; if it keeps happening, check the kraziTV
  log."), `schedule_busy` ("kraziTV is busy updating this channel's schedule.
  Try again in a moment.", reworded in the second round; see below),
  `programming_assignment_not_found` ("That show is
  no longer in the lineup. Refresh and pick again."), and
  `media_root_removal_pending` ("This folder was deleted while a channel was
  still airing from it. Add it again after 11/5/2026, 9:00 PM.", with the
  date and time in the browser's local time like every other time on screen,
  never an ISO timestamp). The folder browser's path refusal carries a field
  so the existing path sentence applies.

### Lineup and dialogs

- In the Lineup table, Play order, At a time, and Marathons stay on one line
  at the size Channel Properties opens at; the Show and Rules columns wrap
  instead.
- A dialog paragraph that prints a path or a name breaks it rather than
  scrolling the dialog sideways; the Delete media root and "Scan it now?"
  sentences stay readable for a scene-named folder.
- Every count an owner reads uses thousands separators: collection cards,
  the collection editor's save bar, and Discover collections say "1,284
  items" as the member list already says "Members (1,284)".
- Enter in the special editor's fields presses **Preview** while no preview
  is current and **Save special** otherwise, as Enter presses the first
  button in every other dialog.
- The desktop icons move with the arrow keys as Start's items do (Up and
  Down, Home and End).
- A channel or collection name longer than 120 characters is refused by the
  server, and the web's too-long sentence names each cap: 120 for a channel
  or collection, 80 for a show (decision 18).

### First-run shortcuts

Each of these is something a first-time owner notices in the first ten
minutes and a contributor can ship in a day. All seven are in scope
(decision 16).

- **Discover collections…** is offered on both Collections tabs, and the
  program's intro says it suggests one collection per series and franchise.
- A scan that finds no media says what kraziTV looks for: "No video files
  found. kraziTV looks for .mkv, .mp4, … in this folder and its subfolders.",
  with the list built from the server's accepted extensions.
- Channel Properties offers **Watch** beside its heading, and the guide's
  program card offers **Watch** while its program is airing; both open TV on
  that channel, as My Channels' Watch does.
- TV answers the keys every set taught: Up and Down change channel, M mutes,
  F toggles full screen, while focus is in the TV window and not in the
  channel select or the volume slider. Keyboard-driven, so nothing animates
  (spec 0008).
- Live Monitor opens on the channel it last showed, or the first enabled
  channel, instead of "Choose a channel", remembering its own channel
  beside TV's last channel in the browser's memory.
- The Start menu header shows the account's picture and name, as XP's did.
- Removing the TMDB key asks first, as every other removal does: "Remove the
  TMDB key? Matches already made stay; new lookups stop until a key is set."

### Contributor items (decision 9)

- The owner's sentence for a bad marathon length and for a rejected TMDB key
  is chosen by a kind the server sends, never by matching prose from another
  package (decision 15): the stretch problem carries `problemKind` (`shape`, `unit`,
  `shorter`) beside its message, and a failed TMDB lookup carries a `reason`
  kind (`key_rejected`, `unreachable`, `http`, `unreadable`) beside its text.
  A reword in kraziBrain or the media package cannot change what the owner is
  told to do.
- The browser suite's scan-progress scenario runs its wide and reduced-motion
  passes only; the 390-wide pass is dropped (decision 17).
- Exception reasons E33 (`content-metadata/match-choice/`) and E39
  (`media/metadata-matching/`) name every file they cover.
- `CONTRIBUTING.md` gives the web app the same map the server has: shell and
  chrome in `desktop/`, one folder per program, `program-host/` as the one
  way a program opens another, `controls/` and `http/` as shared, `testing/`.
  Its "Where Things Are Written Down" list names `wiki/` and says an
  on-screen change updates its page in the same PR, with screenshots from
  `scripts/live-app/wiki-screenshots.mjs` against the demo library.

### Docs

- The wiki pages for Collections (Discover on both tabs), My Channels,
  First-Run, and the Program Guide (Watch), TV (keys), Live Monitor
  (remembered channel), Set up TMDB (removal confirmation), and Media Library
  (the field label and the empty-scan sentence) change with their screens.
- This spec and the feature README say Implemented once the targets hold.

## Second Round: The Leftovers

Each item is fixed wherever the same bug occurs, not only where a reviewer
saw it (decision 20).

### Reshuffle starts a new order (decision 19)

- **Reshuffle…** on a random show gives the collection a new random order on
  that channel: the progress reset counts into the collection's random seed,
  so the picks after a reshuffle differ from the ones before it, and the
  same inputs still give the same order every time. Ordered modes are
  unchanged. Regeneration and restoration use the current count, so an
  earlier order never returns.
- The question reads "Reshuffle Suits on this channel? Its random picks
  start over in a new order. What is airing now finishes; the schedule
  after it is rebuilt." and the result "Suits plays in a new random order
  after what is airing now. Upcoming selections:". No sentence builds a
  possessive from a show's name.

### Keys go where the owner expects

- Enter in a search box inside a dialog never submits or advances the
  dialog: Add shows' search, the collection editor's catalog search and
  member filter, and any other search field inside a form, as the special
  editor's **Find media** already behaves. One shared way of doing it.
- **Save special** stays disabled while a new preview is loading, so Enter
  or a click never saves the preview that is being replaced.
- When TV opens or is brought forward, its picture has the keyboard, so Up,
  Down, M, and F work without a click first. Clicking TV's title bar still
  lets the arrow keys move the window.

### Screens that leave the owner guessing

- After **Discover collections…** creates any collection, Collections shows
  the Automatic tab, where they are, when the dialog closes.
- When Live Monitor cannot load the channel list, it shows the connection
  problem and **Refresh**, never an empty **Channel** list reading "Choose a
  channel".
- The empty-scan sentence is announced with the rest of the scan's status
  to a screen reader.

### Refusals the server words for the web

- A revoked or rejected TMDB key is named as such everywhere, never as TMDB
  being unreachable: a lookup that TMDB answers with 401 fails as
  `key_rejected`; a failed metadata refresh stores its kind beside its text,
  so Media details' **Refresh error** reads "TMDB rejected the key. Check it
  in Account Settings."; and a match decision refused for a rejected key
  answers `tmdb_key_rejected`, which the web words the same way. Logs name
  the failure text `message`, never `reason`.
- An invalid-request field carries what the web needs to word it: the limit
  for a too-long value, and the problem kind for a show's marathon against
  its Plays at a time. The web's too-long sentence names the limit the
  server sent ("Use a shorter name: at most 80 characters.") and holds no
  copy of the server's numbers, and Show Properties words the marathon
  problem by its kind; any other refusal shows as `refusalWords` gives it.
- The server refuses a rule name longer than 80 characters, as it does a
  show's.
- The busy refusal fits every write that can meet it: "kraziTV is busy
  saving another change. Try again in a moment."

### Contributor items

- TV's channel memory and its starting-channel choice, which Live Monitor
  also uses, live in a top-level folder of their own, and the `tv/` and
  `channels/lineup/picks/` exception reasons say what is true now. Row
  menus move focus with the same arrow-key helper the desktop and Start
  use.
- The browser walk's checks can fail: the Lineup row check uses a long show
  name, the Delete media root sentence is measured in real layout with an
  unbroken path, and the scan dialog's always-true box check is dropped.
  Stopping the demo library's `start.mjs` stops its server too. No test
  mock carries a copy of kraziBrain's prose.
- The wiki says where the kraziTV log is, Media Library's page names both
  of its add buttons as the screen does, and CONTRIBUTING's web map says
  everything `app.tsx` chooses between and what Media Library holds.

## kraziTV Check

- Schedule, playout timeline, channel state, kraziBrain, SignalPackager:
  unchanged. kraziBrain's stretch problem gains a kind beside the message it
  already returns; its decisions do not change.
- Provider adapters: unchanged.
- Data model: the failed-lookup reason kind is stored beside the lookup
  error text (one nullable column and its migration), so the web never
  derives it from prose. Nothing else changes.
- Second round: kraziBrain's random selection derives its seed from the
  reset count as well (decision 19); one column stores the count and one
  stores a refresh failure's kind, each with its migration. Schedule,
  playout timeline, and provider adapters are otherwise unchanged.

## Decisions

Settled with the owner on 2026-11-05 and recorded as decisions 15 to 18 in
the [feature README](../README.md): kinds over the wire rather than a
test-only contract; all seven first-run shortcuts in scope; the scan
scenario's 390-wide pass dropped; names capped at 120. Decisions 19 and 20
settle the second round: Reshuffle starts a new order, and leftovers are
fixed by kind of bug. Tickets cite those instead of re-deciding them.

## Acceptance Targets

- A jsdom test renders the Preview tab against a `channel_unschedulable`
  refusal for each reason and reads the owner sentence; one does the same for
  the special editor's Preview.
- A jsdom test renders a continuing turn and reads "continues at"; one
  renders the Up Next tab for a random show and reads **Reshuffle…** and its
  question.
- A jsdom test for each of the five refusal codes reads its owner sentence,
  with the removal-pending time in the browser's local time.
- Grepping `apps/web/src` for "Absolute" and "channel state" in user-visible
  strings finds nothing; spec 0002's grep target still holds.
- A jsdom test renders a Lineup row and asserts Play order and At a time have
  `white-space: nowrap`; the browser walk asserts no Lineup row is taller
  than two lines of text at the default window size.
- A jsdom test renders the Delete media root sentence with a 75-character
  unbroken path inside a 396px body and asserts the body does not scroll
  horizontally.
- A jsdom test renders a 1,284-member collection card and reads "1,284
  items".
- A server test posts a 121-character channel name and a 121-character
  collection name and reads the too-long refusal; a jsdom test reads the
  web's words for it.
- A jsdom test presses Enter in the special editor's Starts field and sees
  the preview requested; one presses Down on the first desktop icon and sees
  the second focused.
- A jsdom test sees **Discover collections…** on the Manual tab; one renders
  a finished scan with zero files and reads the extension sentence; one
  presses **Watch** on Channel Properties and on an airing program card and
  sees TV opened on that channel; one presses Up, M, and F in TV and sees the
  channel, mute, and full-screen handlers called, and sees them ignored while
  the channel select has focus; one opens Live Monitor twice and sees the
  second open on the first's channel; one renders Start and reads the account
  name; one presses **Remove** on the TMDB key and sees the question before
  the request.
- A kraziBrain test asserts `findStretchProblem` returns a kind with each
  message; a server test asserts the route forwards it and that a rejected
  key stores `reason: "key_rejected"`; the web tests choose by kind and hold
  no copy of the other packages' prose.
- The Browser job in CI passes with the scan scenario's narrow pass
  removed.
- `npm run audit:strict` reports no error and no review item; E33 and E39
  name every file.
- The link check, `plan:status:check`, and `agents:check` pass, and the wiki
  pages named under Docs match their screens.

Second round:

- A kraziBrain test reshuffles a random collection and sees a different
  order of picks after the reset than before it, and the same order on a
  second run with the same inputs; a server test regenerates after a reset
  and keeps the new order. A jsdom test reads the Reshuffle question and
  result sentences.
- A jsdom test presses Enter in each search field inside a dialog form and
  sees the dialog neither submit nor advance; one sees **Save special**
  disabled while a preview is loading.
- A jsdom test opens TV and presses Up with no click first and sees the
  channel change.
- A jsdom test creates a collection through Discover from the Manual tab and
  sees the Automatic tab when the dialog closes; one fails the channel list
  in Live Monitor and sees the problem and Refresh with no channel list; one
  finishes an empty scan and finds the sentence inside the status region.
- A media test answers a lookup with 401 and reads `key_rejected`; a server
  test fails a refresh with a rejected key and reads its stored kind, and
  one refuses a match decision with `tmdb_key_rejected`; a jsdom test reads
  the owner sentence for each.
- A server test posts an 81-character rule name and reads the too-long
  refusal with its limit; a jsdom test words a too-long refusal from the
  limit the server sent, and one words Show Properties' marathon problem by
  kind.
- The Browser job in CI passes with the stronger checks.
- `npm run audit:strict` reports no error and no review item, with no
  exception added.

## Out Of Scope

- Phone width (decision 7).
- A first-run wizard, a getting-started checklist, or a desktop order
  (decision 3).
- Moving the TMDB task out of Account Settings (decision 13) or giving the
  Rule dialog an Apply button (decision 10).
- Splitting the folders at the audit's eight-file limit before their ninth
  file arrives.
- Right-click menus, a menu bar, or other XP chrome spec 0008 defers.
- Live Monitor showing every channel at once (its description says "each
  channel"; it shows one at a time).
