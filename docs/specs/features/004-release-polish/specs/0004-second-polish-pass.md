# Spec 0004: Second Polish Pass

Status: Implemented

## Intent

The release-polish audit was run again on 2026-11-03 (commit `5d3c498`)
after specs 0001 to 0003 shipped. It found no blockers and three major
items, all on screens the first-run owner meets: a dialog footer that sits
below the fold at the size the window opens at, a browser error shown in
browser words, and developer vocabulary left in a few sentences and
refusals. This spec closes those and the smaller items around them, so the
audit's next run finds the first-run path clean. It extends specs 0001 and
0002; it changes no programming behavior.

## Behavior

### Dialog footers stay on screen

- A window dialog's action row (Next, OK, Cancel, Apply, Create, Save) stays
  visible at the bottom of the dialog while the dialog's body scrolls, as XP
  wizards and property sheets kept theirs. At the size Channel Properties
  opens at, Add shows shows **Next** and Show Properties shows its footer
  without scrolling.
- Channel Properties opens tall enough that the common Show Properties case
  needs no scroll.

### Unreachable server

- When a request fails before the server answers (connection refused, the
  request's timeout, a non-JSON gateway reply), every feedback box says
  "Can't reach kraziTV. Check that it is running, then press Refresh.", the
  sentence the tray and TV already use. The browser's own text never shows.

### Owner words, remaining cases (decision 1)

- My Channels' intro and empty state say shows and the Lineup tab, never
  "programming source" or "assign". The runtime-cleanup retry says what it
  retries in owner words.
- The removal refusal that names a channel playing an item says "as a show",
  never "programming assignment". The progress-reset dialog says the schedule
  after the airing program is rebuilt, never "schedule entry" or
  "regenerated".
- The special preview says **Off air** before, inside, and for the whole
  range, matching the guide, My Channels, and the special refusal.
- The scan dialog's live status says "Reading media files…" and "Last read",
  never "Probing".
- The web maps `media_collection_in_use`, `programming_member_assigned` (in
  Show Properties as well as Add shows), `programming_rule_stretch_invalid`,
  and `programming_rule_stretch_conflict` to owner sentences that say what to
  change.
- A marathon shorter than **Plays at a time** is refused in the sheet before
  it is sent, with a sentence that names the field; the server's "ordinary
  stretch" sentence never shows.
- Spec 0002's grep target holds: no user-visible string in `apps/web/src`
  contains assignment, reservation, regenerate, revision, or entry in the
  domain sense.

### Last empty states and the TMDB pointer (decisions 2 and 13)

- The collection editor's empty-catalog state ends with **Open Media
  Library**, through the host's `openProgram` callback.
- The Preview tab with no upcoming turns and no skips shows the channel's
  off-air words instead of a blank panel.
- Account Settings describes itself as name, picture, password, and TMDB on
  the desktop, in Start, and in its status bar. While no TMDB key is set,
  Media Library's intro line offers **Set up TMDB…**, which opens Account
  Settings on that task.

### Quiet saves and plain failure words

- A successful Apply, OK, or Rename shows no "Operation completed
  successfully." sentence; the disabled Apply is the confirmation, as on XP
  sheets. Actions that need a sentence (enabling or disabling a root) choose
  their own.
- A library row never shows ffprobe's text. The row's availability says
  **Could not be read**; Media details explains why in one sentence. Lookup,
  refresh, and automatic-collection failures read as one owner sentence each,
  with the stored text available only as a tooltip.

### Chrome and lists

- Every radio group's control sits beside its label (the Rebuild question and
  the series candidate list included).
- A poster that fails to load hides itself; the facts take the full width.
- Pressing Start or a window control is instant; only hover transitions.
- Start menu items move with the arrow keys, as XP's did.
- Single items in Add shows and Show Properties, and the Selected list under
  them, show the file name with the full path as a tooltip, like every other
  list.

### Contributor items (decision 9)

- The signal session's terminal failure releases every process through the
  same `ProcessBinding.release` helper the other transitions use.
- The browser suite's first-run walk runs once at 1280×800. The folder
  browser's narrow-window test stays and says it covers a narrow desktop
  window (decision 12).
- `apps/web/src/channels/lineup/` is pre-split: the picks files move into
  `lineup/picks/` and the Add shows dialog's pure derivations leave the
  component for a tested module (decision 11). Exception reasons name every
  file they cover.
- `program-host/` has a direct test for opening, focusing, and de-duplicating
  a program.

### Docs

- Spec 0003 and the feature README say Implemented once their targets hold.
- `.env.example` says `PUBLIC_BASE_URL` also governs which browsers may make
  changes.
- The media-engineer role names the exit gate instead of paraphrasing it.
- The glossary defines **Schedule preview** (decision 14).
- Spec 0001 records that the Rule dialog keeps OK and Cancel (decision 10).

## Acceptance Targets

- The browser suite's first-run walk clicks **Next** in Add shows and **OK**
  in Show Properties without scrolling the dialog, and asserts each button's
  box lies inside the dialog's visible box.
- A jsdom test fails a request with a `TypeError` and one with a
  `TimeoutError` and reads "Can't reach kraziTV" in the feedback box.
- A jsdom test for each of the four refusal codes reads its owner sentence;
  one for a marathon shorter than Plays at a time reads the sheet's refusal
  with Apply held.
- Grepping `apps/web/src` for the spec 0002 words in user-visible strings
  finds nothing.
- A jsdom test renders the Preview tab with no turns and reads the off-air
  words; one renders the collection editor with an empty catalog and opens
  Media Library through the fake host.
- A jsdom test applies a sheet and reads no success sentence.
- `npm run test:ffmpeg` passes with a test that a prepared process's held
  output is discarded when the session fails.
- `npm run audit:strict` reports no error and no review item after the
  lineup split, with the four exception reasons rewritten.
- The link check, `plan:status:check`, and `agents:check` pass.

## Out Of Scope

- Moving the TMDB task out of Account Settings (decision 13).
- An Apply button on the Rule dialog (decision 10).
- Raising the audit's eight-file limit; the other folders at eight files
  split when their ninth file arrives.
- Phone width (decision 7).
