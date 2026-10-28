# Channel Programming Setup In My Channels

Status: Implemented

## Problem

My Channels shows a channel's programming configuration as its data model.
One scrolling page stacks the identity form, every programming source
assignment as a fully expanded form, the channel's marathon settings, the
programming rules, the upcoming-programming preview, the rebuild action, a
backend schedule debug line, and specials. Five shows mean five complete forms
with no overview.

Specific problems in the current screen:

| Problem                     | What the owner sees                                                                                                                                        |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No overview                 | Every assignment is permanently in edit mode; there is no compact list of what the channel plays.                                                          |
| Marathons split in two      | **Allow marathons** and a marathon length live on each assignment; chance and cooldown live in a separate channel form with its own save button.           |
| Marathon trap               | Chance starts at 0%, so ticking **Allow marathons** does nothing until the owner finds and saves the other form.                                           |
| Many save models            | **Save identity**, **Save programming** per assignment, **Save marathon settings**, plus rule and special saves. What is saved versus drafted is unclear.  |
| Engine vocabulary           | "Assignment", "member", "Source type", "Programming source", "Turn length", "Ordinary rounds between marathons".                                           |
| Two-step source choice      | Each member row asks for a source type, then a collection select or an item picker.                                                                        |
| Advanced concepts up front  | Multiple members per assignment and rule-only participation sit in the main path, unexplained against simply adding more assignments.                      |
| Controls with little effect | **Move up/down** on assignments changes only the shuffle's deterministic input ([spec 0004](0004-kraziplan.md)), not what airs in a way the owner can see. |
| Debug output                | `Backend schedule: N entries · revision X`.                                                                                                                |

This works against the feature goal: configure once and mostly leave it alone.

## Goals

- Show at a glance what a channel plays, how much at a time, and whether it
  can marathon.
- Set up a working channel by picking shows, with no required settings beyond
  the server's suggestions.
- Configure marathons in one place, with no state where an owner turns them on
  and nothing happens silently.
- Give each editing surface exactly one save model.
- Keep every existing capability reachable; move advanced settings out of the
  main path rather than removing them.

## Non-goals

- Any change to kraziPlan policy, stretch resolution, marathon selection,
  rotation, rules evaluation, or reservations.
- Server changes beyond the bulk assignment create, the stretch
  suggestion's content kind, and the show name described under Technical
  Behavior.
- Exposing saved assignment order. It only feeds the deterministic shuffle
  ([spec 0004](0004-kraziplan.md)), so shows keep the order they were added.
- Redesigning the rule form or special editor internals beyond moving them
  into tabs and reusing the new per-sitting presets.
- Drag-and-drop reordering or a guide-grid editor.
- Changing the channel list on the left of My Channels, channel creation,
  enable/disable, deletion, or cleanup retries.

## Dependencies And Spec Boundary

Builds on [kraziPlan](0004-kraziplan.md), [recurring rules](0005-recurring-programming-rules.md),
[manual programming](0007-manual-programming.md), and the desktop shell in
[MVP spec 0008](../../001-mvp/specs/0008-web-admin.md). Owner-facing
behavior of those specs is unchanged; this spec changes only how the web app
presents and edits it. Window dialogs follow the existing `WindowDialog`
control.

## Vocabulary

UI labels change; code, API, and docs keep glossary terms, as **Special** does
for reservation.

| UI label         | Glossary term                                 |
| ---------------- | --------------------------------------------- |
| **Lineup**       | The channel's programming source assignments  |
| **Show**         | One programming source assignment (one row)   |
| **Per sitting**  | Ordinary stretch setting                      |
| **Can marathon** | The assignment has a marathon stretch setting |
| **Marathons**    | Channel marathon chance and cooldown          |

The implementing change adds these labels to the matching glossary rows, as
the **Reservation** row records **Special**. "Lineup" here is a UI tab label
only; the glossary's provider meaning of lineup is unchanged.

## User-Facing Behavior

### Channel property sheet

As in the lineup list, a click selects a channel, and double-click, Enter, or
**Properties** (under the list or in the row menu) opens it in **Channel
Properties**, a desktop window of its own beside My Channels, titled with the
channel's name. Each channel opens in a window of its own, and opening one
already open brings it forward. A new channel opens there as soon as it is
created. It holds an XP-style property sheet with tabs, replacing
the single scrolling page:

| Tab          | Holds                                                                                               |
| ------------ | --------------------------------------------------------------------------------------------------- |
| **General**  | Number and name, with **Apply**.                                                                    |
| **Lineup**   | The show list, **Add shows…**, **Properties**, **Remove**, and the channel's **Marathons** control. |
| **Rules**    | The existing programming rules editor. Shown once the lineup has a show.                            |
| **Specials** | The existing specials section.                                                                      |
| **Preview**  | Upcoming programming and **Rebuild the schedule…**. Shown once the lineup has a show.               |

The selected tab persists per window while the program stays open. A channel
with an empty lineup opens on **Lineup**, which shows the empty state and
**Add shows…**.

The backend schedule debug line is removed.

### Lineup list

The lineup is a read-only list, one row per assignment in saved order:

```text
Show                  Order      Per sitting     Marathons
Seinfeld              Episode    ~1 hr           up to 3 hrs
The Office + Parks    Episode    3 programs      —
Christmas Movies      Random     1 movie         —            Rules only
```

- **Show** is the owner's name for the show when it has one, such as
  `Adult Animation`. Otherwise it is the collection or item name, and an
  assignment with several members shows them joined with `+`, truncated with
  a count past two, such as `The Office + Parks + 1 more`.
- **Order** is the playback mode label, or `—` for single items only.
- **Per sitting** shows a preset name or the custom value in words.
- **Marathons** shows the marathon length, or `—`. When the channel's
  marathons are off, a marathon-capable row reads `up to 3 hrs (off)`.
- A rule-only assignment shows a **Rules only** badge, and an assignment with
  several members, a wheel, shows a **Wheel** badge.
- Selecting a row enables **Properties** and **Remove**; double-click or
  Enter opens **Properties**. The row menu offers the same actions.
- **Remove** confirms in a window dialog and names the show.
- There are no reorder controls.

### Add shows

**Add shows…** opens a window dialog with one search field that finds media
collections and single media items together, each labeled by kind. The owner
checks any number of results. Collections and items the lineup already plays are left
out of the results, since a member plays in one show at a time.

- **Add as** chooses what the checked results become:

  | Choice             | Result                                                                                                                                                                                                                     |
  | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | **Separate shows** | The default. Each checked result becomes its own assignment with its own turns.                                                                                                                                            |
  | **A wheel**        | Every checked result becomes a member of one assignment, in the order checked, sharing its turns, as a broadcast wheel series does. An optional **Wheel name** names it; blank names it by its members as the lineup does. |

- The dialog has two pages. The first holds **Add as** and the search;
  **Next** counts the picks. The second boxes every show it will add, one
  box each titled with the show's name, with **Play order** (collection order
  unless changed) and **Plays at a time** (the server's suggested
  per-sitting setting for its members unless changed). A show of single
  items alone shows neither; it plays one item each time it comes up.
  **Back** returns to the same search with every pick and choice kept.
- A show with no suggestion (mixed or unclassified media) asks for its
  per-sitting choice before **Add** is enabled, as spec 0004 requires.
- Every added show plays in normal rotation with marathons off, as spec 0004
  requires; **Allow marathons** and **Plays in normal rotation** are set in
  **Properties**.
- **Add** creates every show in one request, all or nothing, and
  closes the dialog; the lineup and preview refresh. On failure nothing is
  added, the dialog stays open with its choices, and the error names the show
  the server rejected.

### Show properties

**Properties** opens a window dialog titled with the show's name, with
**OK**, **Cancel**, and **Apply**. Nothing writes until **OK** or **Apply**.

Main section:

- **Name**: the owner's name for the show, with its member names as the
  placeholder. Blank clears it, so the show is named by its members again.
  Changing only the name changes no programming, so nothing regenerates.
- **Order**: playback mode select with its hint. Hidden for single items only.
- **Per sitting**: presets for the show's content kind, then **Custom…**
  revealing the three stretch kinds as today. The airtime overrun hint shows
  for airtime choices.

  | Content kind          | Presets                                                 |
  | --------------------- | ------------------------------------------------------- |
  | Movies                | `1 movie`, `2 movies`, `3 movies`                       |
  | Episodes              | `1 episode`, `3 episodes`, `~30 min`, `~1 hr`, `~2 hrs` |
  | Mixed or unclassified | `1 program`, `3 programs`, `~30 min`, `~1 hr`, `~2 hrs` |

  Movie and episode presets are program counts and airtime targets under the
  hood; only their labels differ. The lineup's **Per sitting** column uses the
  same labels.

- **Can marathon**: checkbox. When checked, the marathon length is derived from
  per sitting with the existing `suggestMarathon` rule and shown in words
  ("up to 3 hrs").
- If **Can marathon** is checked while the channel's marathons are off, an
  inline notice reads **Marathons are off for this channel.** with a
  **Turn on occasional marathons** button. The button writes the channel
  setting immediately and says so; it never happens implicitly on **OK**.

**Advanced** section, collapsed by default:

- **Members**: the member list with add, remove, and reorder, using the same
  combined picker as **Add shows…**. A short explanation: members share this
  show's turn and take it in order; add separate shows for separate turns.
- **Plays in normal rotation** checkbox, with the rule-only explanation.
- **Marathon length**: override the derived length with the stretch fields.
- **Collection preview** and **Restart from the beginning…** for a saved
  collection, as today.

### Marathons control

The **Lineup** tab footer holds one channel-wide control:

| Choice         | Chance per round | Ordinary rounds between |
| -------------- | ---------------- | ----------------------- |
| **Off**        | 0%               | unchanged               |
| **Occasional** | 10%              | 2                       |
| **Frequent**   | 25%              | 1                       |
| **Custom…**    | owner value      | owner value             |

Choosing a preset saves immediately. **Custom…** opens a window dialog with
the two numeric fields and **OK**/**Cancel**. Saved values that match no
preset display as **Custom**. When no show can marathon, the control is
disabled with the hint **No show can marathon yet.**

### Rules and specials

The Rules and Specials tabs host the existing editors unchanged, except that
stretch fields in the rule form use the same per-sitting presets with
**Custom…**.

## Technical Behavior

- The web work lives in `apps/web/src/channels/`. Server routes and contracts
  are reused as they stand, apart from the two additions below: assignment
  create, patch, delete; stretch suggestion; marathon settings get and put;
  collection preview; progress reset; rules; programming preview; rebuild;
  reservations.
- **Bulk assignment create.** A new
  `POST /channels/:id/programming-assignments/batch` takes
  `{ assignments: AssignmentSettings[] }` (one or more) and validates each as
  the single create does. It writes them all in one transaction under write
  authority, appended to saved order in request order, and regenerates once,
  with the configuration and schedule revisions advancing as one write. Any
  invalid assignment rejects the whole request, naming its index. The single
  create stays for **Properties**-style callers and existing tests.
- **Content kind on the stretch suggestion.** The stretch suggestion response
  gains `contentKind: "movies" | "episodes" | null`, from the same
  `content_type` classification that already picks its suggested stretch;
  `null` means mixed or unclassified. The web asks it for a saved show's
  members to label presets, and for new picks as today.
- The combined picker composes the existing `MediaItemPicker` search with the
  collection list rather than adding a server search.
- Presets map to existing `StretchSetting` values; a saved setting matching a
  preset displays as that preset, any other as Custom.
- Marathon presets map to existing `MarathonSettings` values.
- The assignment-order endpoint stays in the server; the web app stops calling
  it. New assignments append in creation order.
- The capability folders under `apps/web/src/channels/` (`assignments/`,
  `programming/`, `rules/`, `specials/`) are regrouped as the source-layout
  rule requires once the new files land; for example a `lineup/` capability
  for the list, add dialog, and properties dialog.

## Data Model Impact

One nullable column, `programming_source_assignments.name`, holding a trimmed
name of 1 to 80 characters or null. Contract additions: the bulk create route,
the suggestion's `contentKind` field, and the assignment's `name`, which a
request may omit and the server saves blank as null.

## kraziTV Check

| Area              | Affected                                                                |
| ----------------- | ----------------------------------------------------------------------- |
| Schedule          | No policy change. A bulk add regenerates once instead of once per show. |
| Playout timeline  | No.                                                                     |
| Channel state     | No.                                                                     |
| kraziBrain        | No. Presets are UI shorthand for settings it already validates.         |
| SignalPackager    | No.                                                                     |
| Provider adapters | No.                                                                     |

## Architecture Boundaries

- The web app chooses presets and labels; it never decides scheduling. A
  preset is only a saved `StretchSetting` or `MarathonSettings` value, and the
  server remains the validator.
- Turning on channel marathons is always an explicit owner action, never a
  side effect of saving a show.
- Tab and collapsed-section state is desktop shell state and never affects
  broadcast behavior.

## Resolved Decisions

| Question                     | Decision                                                                |
| ---------------------------- | ----------------------------------------------------------------------- |
| Frequent marathon preset     | 25% chance, one ordinary round between.                                 |
| Atomic bulk add              | Yes: one all-or-nothing server request with one regeneration.           |
| Movie per-sitting presets    | Yes: labels follow content kind from the stretch suggestion.            |
| Names for multi-member shows | Yes: an optional name; blank falls back to joined member names.         |
| One show from several picks  | Yes: **Add as A wheel** in Add shows; **Separate shows** stays default. |
| Exposing saved order         | No. Shows keep creation order.                                          |

## Open Questions

None.

## Acceptance Criteria

- Selecting a channel shows General, Lineup, Rules, Specials, and Preview tabs;
  Rules and Preview appear only once the lineup has a show.
- The Lineup tab lists every assignment in saved order with show, order,
  per sitting, marathon, and rules-only columns, and no assignment is shown as
  an editable form.
- **Add shows…** adds several collections and items in one dialog, each as its
  own assignment with the play order and per-sitting setting its row shows,
  defaulting to collection order and the suggested per sitting, and requires
  a per-sitting choice only where there is no suggestion.
- **Add as A wheel** adds every checked result as members of one assignment,
  with an optional name, and the lineup badges it **Wheel**.
- The bulk create writes every assignment or none, regenerates once, and
  names the rejected assignment's index on failure.
- A show's optional name replaces its member names in the lineup, its
  Properties title, and the rule form; renaming alone neither regenerates nor
  advances the configuration revision.
- Per-sitting presets read in movies for a movie show, in episodes for an
  episode show, and in programs otherwise, in both Properties and the lineup.
- **Properties** edits one assignment in a window dialog that writes only on
  **OK** or **Apply**; **Cancel** discards every change.
- Members, rule-only participation, marathon length override, collection
  preview, and restart from the beginning are reachable under **Advanced**.
- Per sitting offers presets and **Custom…**; a saved custom value round-trips
  and displays as Custom.
- Marathon chance and cooldown are set from one Lineup control with Off,
  Occasional, Frequent, and Custom choices.
- Checking **Can marathon** while channel marathons are off shows the notice
  and its button; saving the show alone never changes channel marathon
  settings.
- A marathon-capable show on a channel with marathons off reads `(off)` in the
  lineup.
- The backend schedule debug line and assignment reorder controls are gone.
- No migrations; the only server additions are the bulk create route and the
  suggestion's `contentKind`.
- Existing web tests for assignments, marathons, rules, specials, rebuild, and
  progress reset pass after being moved to the new surfaces.
