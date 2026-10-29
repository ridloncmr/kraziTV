# Continuous Multi-Source Programming With kraziPlan

Status: Implemented

## Problem

A single looping block cannot mix several collections while preserving each
collection's playback progress. Users need an enduring channel configuration,
not a daily schedule they must author or publish. Fixed source order becomes
monotonous, while unconstrained random selection can overlook a source indefinitely.
Programming should provide dependable participation with varied order and occasional
longer stretches.

## Goals

- Continuously generate programming from several channel source assignments.
- Alternate useful stretches of whole programs with independent collection progress.
- Give every continuously eligible, usable source one turn per shuffled round.
- Separate source order, stretch size, and program playback order.
- Support variable stretches and optional marathons with frequency limits.
- Preserve single-source looping and operate without metadata enrichment.
- Make generation deterministic, bounded, and resumable across requests and restarts.

## Non-goals

- Calendar rules, exact clock boundaries, manual publishing, or filler.
- Weighted optimization, strict airtime quotas, arbitrary scripting, or viewer-specific programming.
- Guaranteed intervals between source appearances or guaranteed daily marathons.
- Replacing schedule entries as guide authority or placing programming policy in SignalPackager.

## Dependencies And Spec Boundary

Depends on existing blocks, schedule materialization, and progress restoration.
Integrates [playback ordering](0003-playback-ordering.md) when available, but basic
multi-source programming can ship with current modes and manually built collections.
This spec provides useful continuous rotation independently of calendar behavior.

Spec 0005 determines source eligibility and optional rule-specific stretch settings;
this spec determines turn order, resolves effective size, and enforces channel-wide
marathon limits. Its priority, fallback, timezone, and whole-program boundary
policies compose with the integration contract below.

## Established Behavior And Proposed Policy

ADR 0009 places kraziPlan inside kraziBrain and requires it to generate programming
blocks rather than schedule entries. The MVP's one-block constraint is a separate
unique index. The generation and source-assignment behavior below is proposed.

## User-Facing Behavior

The user assigns collections or single media items to a channel, chooses each
assignment's playback mode, and
sets its ordinary stretch size and optional marathon size. Source order, size,
and program playback mode are independent choices. For example:

| Source               | Playback mode | Ordinary stretch       | Optional marathon |
| -------------------- | ------------- | ---------------------- | ----------------- |
| The Office           | Episode order | 3 programs             | 8 programs        |
| Family Guy           | Random        | About 60 minutes       | Disabled          |
| Parks and Recreation | Episode order | Between 60–120 minutes | About 3 hours     |

kraziTV uses shuffled rounds. Each eligible source receives one turn per round,
with a freshly shuffled order. One round might be Office, Family Guy, Parks; the
next might be Family Guy, Office, Parks. Avoid repeating the last aired source
when another pending usable source exists. Saved assignment order supplies stable
configuration input, not a repeating broadcast sequence. Longer stretches increase
the wait for other sources; participation does not promise exact appearance times.

| Stretch setting         | End condition                                                        |
| ----------------------- | -------------------------------------------------------------------- |
| Fixed airtime target    | Finish whole programs until reaching or exceeding the target         |
| Fixed program count     | Finish exactly the chosen number of programs                         |
| Variable airtime target | Choose a target within a configured range once, then finish programs |

A 60-minute target with 22-minute episodes produces 66 minutes of programming;
a longer movie airs whole. The UI displays expected overrun rather than implying
an exact hour. Program counts may wrap through a collection and need not select
distinct members.

For movie collections, recommend one program per ordinary turn, with an optional
fixed two- or three-program marathon. These are editable assignment settings,
not automatic scheduling decisions based on media type. Each movie airs whole,
then the next source gets its turn after the configured count is satisfied.
This avoids a nearly two-hour movie causing another full movie to be selected
just to reach a two-hour airtime target. Movie collections may still use airtime
settings when the user deliberately chooses that behavior.

When adding a source, suggest one program for a movie collection and three programs
for an episode collection. These are editable setup defaults, not runtime media-type
branches; ask the user to choose for mixed or unclassified collections. Marathons
remain disabled initially. When enabled, suggest a 10% chance per eligible round
and two completed ordinary rounds between generated marathon opportunities.

A movie marathon draws from one assigned collection in its playback mode. Release
order can preserve franchise sequence; random playback does not guarantee related
movies. A trilogy marathon therefore needs the relevant collection and ordering,
rather than inferring a franchise from a general movie collection.

An optional marathon extends a source's existing turn, then the next pending
source plays. It grants no extra turn, keeps the assignment's playback mode, and
continues its collection progress normally. Channel settings specify marathon chance per eligible round
and a minimum number of ordinary rounds between marathon rounds. At most one
marathon may start per round. Two ordinary rounds between marathon rounds, for
example, prevents consecutive marathons. Marathons are disabled until configured;
chance does not guarantee one every day or week.

### Occasional Marathons And Deliberate Full-Series Events

An occasional generated marathon resumes the assignment's saved playback progress.
Eight programs from a Harry Potter collection do not imply starting with the first
film: if the next film is Goblet of Fire, the turn starts there and may wrap.

For a deliberate full-series event, offer an explicit **Start from the beginning**
option through [manual programming](0007-manual-programming.md). For example,
select the eight-film Harry Potter collection in release order, preview all eight
films starting with the first, and publish the event. The event finishes after
the last selected film without wrapping or repeating to satisfy an airtime target.
Its placements leave ordinary collection progress unchanged, so later ordinary
turns resume where they would have before the event.

This is a deliberate programming override, not another randomly selected turn.
Spec 0007 owns selection snapshot, preview, publication, cancellation, and normal
programming resumption; spec 0006 owns reservation timing and fit. Generated
marathons retain the round/chance/cooldown behavior in this spec. A published
full-series event neither consumes nor resets generated marathon cooldown.

### What An Assignment Holds

An assignment holds one or more members. Each member is a collection or a single
media item; a single movie or special needs no one-item collection
([ADR 0009](../../../../adrs/0009-programming-blocks.md)). Most assignments hold
one member. Several members share one assignment when the owner wants them to
share one place in the rotation, such as twenty sitcoms, each its own automatic
series collection, assigned together as one source. Without this, a channel with
fifty one-show sources waits roughly fifty turns between appearances of any one
show. A Holiday assignment might hold a Christmas collection and _It's a
Wonderful Life_ as a single item, so the film airs once every few of that
assignment's turns rather than every round.

The assignment still takes one turn per round. Each of its turns goes to the
next usable member in the assignment's saved member order, wrapping at the end.

| Member      | Its turn                                                                                                                                        |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Collection  | Plays in the assignment's playback mode from that collection's own progress, for the assignment's stretch setting; a marathon extends this turn |
| Single item | Airs once, whole, then the turn ends. It has no playback mode or progress, ignores the stretch setting, and never becomes a marathon            |

A single-item turn can still hold a round's marathon opportunity; the opportunity
is then discarded without replacement, like any lost opportunity.

The user can inspect upcoming programming, its source, chosen size, and the reason
for a marathon. No daily publication is required. An empty or unschedulable
assignment is skipped with an explanation.
If every assignment is unusable, report the channel's unschedulable condition;
do not invent a guide program or spin indefinitely.

## Technical Behavior

### Inputs, Blocks, And Materialization

A programming source assignment is enduring channel configuration: one or more
members (collections or single media items) in saved member order, playback mode,
saved assignment order, ordinary stretch setting, and optional marathon setting.
Playback mode is required when the assignment holds a collection and absent when
it holds only single items. Channel configuration owns marathon chance and
cooldown. A collection or single item is a member of at most one assignment on a
channel; recurring rules later reference these assignments rather than
duplicating collection progress.

An assignment is usable when at least one of its members is schedulable: a
collection with a schedulable media item, or a schedulable single item. Persist
which member takes the assignment's next turn. Choosing it skips unschedulable
members without consuming their progress, and changes neither round order nor
any collection's playback progress. Adding, removing, or reordering an
assignment's members keeps its place in the current round.

Without recurring rules, all assignments participate in default rotation. Spec 0005
extends participation to distinguish default assignments from rule-only assignments,
so seasonal sources can be configured without airing year-round.

kraziPlan chooses the next assignment and produces a programming block with source,
resolved airtime target or program count, and decision provenance. The schedule
capability resolves whole programs, their exact durations, and the block's
resulting end, then continues the rotation.
Use explicit composition between these capabilities rather than two independent
simulations of media selection. kraziPlan never writes schedule entries directly.

Server orchestration persists generated blocks, entries, continuation, and
collection progress coherently. Generate only bounded future coverage; keep the
existing horizon and request limits unless separately changed. Coverage extension
appends blocks and entries without rewriting covered windows. Cleanup must retain
all provenance or checkpoints still needed for progress restoration.

### Shuffled Rounds

A usable assignment is one that is currently eligible and has at least one
schedulable member.

Form each round from usable eligible assignments in saved order, then shuffle
deterministically. Give each assignment one turn without replacement. Playback
mode does not influence source order. Different rounds may coincidentally share
the same order; variety is not a promise of a different permutation every time.

If the first pending source equals the last source that actually aired, swap it
with the first different usable pending source. Apply this before each new turn,
including round boundaries and resumed rounds. If only one usable pending source remains,
allow the repeat rather than inventing a duplicate turn.

Persist round identity, pending order, served/skipped assignments, and last aired
source. Skip an unusable assignment without consuming collection selection and
reconsider it next round. Examine each candidate at most once per selection
attempt; report unschedulable instead of generating empty rounds indefinitely.

### Stretch Size And Marathon Selection

Require positive airtime targets or positive integer program counts. Variable
airtime has inclusive positive integer-minute endpoints, maximum at least minimum.
Choose uniformly within the range once per turn; equal endpoints behave as fixed
targets. Variable program counts are outside this slice.

At round creation, if channel-wide cooldown permits and usable marathon-enabled sources exist,
make one seeded chance decision using the channel's configured 0–100% probability.
On success, choose uniformly among those sources and reserve its existing turn
as the marathon opportunity. Do not roll per source or reroll after other turns.

Resolve ordinary size and any selected marathon size once at turn start. A
marathon supports the same three settings but must use the assignment's ordinary
size kind: counts extend counts, airtime extends airtime. Its fixed size or range
minimum must exceed the ordinary fixed size or range maximum. This guarantees a
longer turn without comparing counts to durations.

If the chosen source becomes unusable or ineligible before starting, discard the
opportunity without replacement. Recheck channel-wide cooldown when a reserved
opportunity's turn starts: another context may have started a marathon since this
round was created. If blocked, use an ordinary turn without rerolling.

Reset the channel's ordinary-round counter when the marathon's first program is
committed to generated programming. A started marathon ended by ordinary policy
or the finish-current-program option still counts and receives no replacement.
An explicit fresh rebuild clears this programming state under the edit policy
below. After that start, count completed rounds with no
started marathon across all rotation contexts, requiring at least one committed
program in a counted round. Empty or entirely skipped rounds do not advance
cooldown. The marathon-containing round itself
never counts. A minimum of two requires two such completed ordinary rounds before
another opportunity may start; zero permits the next round to be eligible. Completing
a round contributes once, even if it was suspended and resumed. Decisions follow
generated programming, not viewers or wall-clock time; rollback restores them.

### Determinism And Continuation

Each new source turn starts with zero accumulated airtime or program count and
its resolved ordinary or marathon size. For airtime, select the next whole
program in that source's playback order, add its scheduled duration, and continue
while accumulated airtime is below the target.
End the turn as soon as accumulated airtime meets or exceeds the target. Thus a
60-minute target with 22-minute episodes selects three episodes totaling 66 minutes;
an exactly 60-minute program ends the turn, and a 120-minute movie airs whole.
For a program-count stretch, stop after the resolved number of whole programs.

Targets are independent per turn. Do not carry surplus or deficit into another
turn, track airtime or program-count debt, or compensate for a calendar or reservation boundary
ending a turn early. Collection playback progress still continues normally.

Persist pending round order, chance outcome, marathon opportunity, cooldown,
resolved size, and unfinished turn's accumulated airtime or count. Chunk boundaries
cannot reshuffle sources, redraw sizes, or reroll marathons. Restore these decisions
and collection progress from retained entries and checkpoints when future entries
are deleted, including preceding state needed to reproduce a deleted round's start.
This restoration rule applies to ordinary regeneration. An explicit fresh rebuild
instead starts new round and marathon state as described below.

An unfinished size retained across generation chunks or restart belongs to the
same turn, not a balance across turns. Calendar features or reservations ending
a started turn discard its remainder; its source's next turn has a fresh size.

Random uses its existing channel-and-collection seed, not a block ID or another
collection's airing count. Ordered collections resume their own mode's progress.
Repeated cycles require no manual reset, even when a collection contains one item.

Use a separate persisted channel programming seed and stable round/turn identities
for shuffling and size/marathon decisions. Separate decision streams for ordinary
size, source shuffle, marathon chance, marathon source, and marathon size keep
unrelated decisions from advancing one another. Programming randomness never
advances collection playback randomness. Block IDs, preview calls, and request
order are not entropy.

An explicit fresh rebuild advances a persisted rebuild counter used with the
programming seed, so it starts new random programming decisions rather than
reproducing the discarded round. Save that counter atomically with the rebuild;
retries of the same action must not advance it again. Restarts, previews, coverage
extension, and ordinary regeneration never advance it. Collection playback seeds
remain independent and unchanged.

### Recurring-Rule And Reservation Integration

Spec 0005's winning rule determines active sources before turn selection. Priority
selects the rule, not source frequency or extra turns. Integration:

- Join behavior shares the default round. Insert newly eligible sources once
  into seeded positions in the unplayed portion, preserving pending relative
  order. Served or skipped sources get no extra turn after leaving and rejoining.
  Remove ineligible pending sources, remembering their unserved status so a
  rejoining source may recover its one pending turn.
- Feature behavior suspends the default/mixed round and owns separate continuation
  per feature rule. Higher-priority features likewise suspend lower features.
  Resume eligible pending turns afterward; an interrupted turn counts as served
  and discards its remainder. Reconcile eligibility when resuming a context.
- Recheck rules after every program. Eligibility loss or feature takeover ends
  even a marathon at the next program boundary and marks the started turn served.
  A default source may finish its
  stretch when a join window ends if it remains eligible. A feature ceasing to
  apply ends its active turn. Never cut the airing program for a soft window.
- Calendar changes preserve retained pending order and collection progress.
  Joining mid-round does not trigger another marathon chance decision; newly
  joined sources enter marathon selection at the next round creation.

Default/mixed programming and each feature rule own separate shuffled-round
continuation, but share channel-wide marathon chance and cooldown policy. Switching
contexts cannot reset cooldown. A suspended round's opportunity must still pass
the channel-wide start check when resumed. Deliberate published events remain
exempt from generated marathon limits.

Resolve stretch settings at turn start from the winning rule's per-source overrides
in spec 0005, falling back to assignment settings. Overrides may replace ordinary
size and inherit, disable, or replace marathon size. Validate the resulting pair
using this spec's size-kind and longer-turn requirements. Record the rule and
resolved settings on the generated block. Rule transitions do not resize a retained
turn solely because its source remains eligible; apply effective settings to its
next turn. They may still end a turn under the boundary policies above.

Reservations in spec 0006 remain higher priority and retain their whole-program
fit policy. Deferring an uncommitted program consumes no collection progress.
A reservation ending a started turn discards its remainder and counts it as
served. If no program from a pending turn could start, retain that turn and any
resolved size/opportunity for afterward. Resume pending programming without debt
or redrawing retained decisions.

### Configuration And Migration

Migrate an existing collection-sourced loop to one enduring source assignment,
keeping its playback mode, schedule anchor, seed, and retained progress. Migrate an
existing single-item loop to one assignment whose only member is that item, so it
keeps looping one whole airing per turn; never convert it into a one-item
collection. After migration every channel's programming is assignments.

Assignment edits use existing scheduling input-change orchestration and preserve
the airing entry by default. New future blocks reflect the edit; block IDs are provenance,
not a source of random entropy. A preview uses the same domain decisions on copied
inputs without persisting blocks, entries, or progress.

Migration initializes programming randomness independently of the retained
collection seed. Edits retain pending order for unchanged assignments and reconcile
additions/removals like joins. Saved-order changes affect future round formation;
editing a served assignment grants no extra turn. Restore continuation from
retained programming before generating changed future blocks. Preview copies
round state and cooldown too, and persists no random decisions. Matching catalog,
configuration, and continuation snapshots produce matching preview and generation.
Retained-round behavior applies to ordinary edits and regeneration; an explicit
fresh rebuild deliberately replaces it.

For size or playback-mode edits during a started turn, end that turn after the
airing program by default, mark it served, and discard its remainder. If it was a
marathon, count it as a completed turn for rotation and cooldown purposes even
though its full target was not reached; this does not claim that all planned
programs aired. Rebuild future programming immediately from the airing entry's
existing end, applying new settings to subsequent turns. Do not wait for the old
stretch to finish. Automatic policy changes preserve continuation and started
marathon cooldown; they never choose a fresh slate for the user.

Offer the existing administrative choice **Let it finish** or **Stop it now and
rebuild the schedule**, defaulting to finish, only while a program is airing. A
write that changes what airs on a channel where nothing or filler is airing has
nothing to interrupt, so it applies silently and no dialog opens. The web app
decides from its polled read of the channel's now state, which can be stale at
write time; because the write has already applied as Let it finish, a stale read
only hides the Stop-now offer and never interrupts, and the Preview tab's explicit
**Rebuild the schedule…** remains, opening the choice whether or not a program
airs. Name the airing program in the dialog and word it for owners. Follow
accepted ADR 0003 and the catalog-removal lifecycle: explicit interruption removes
the airing entry, rebuilds from current time under write authority, commits, then
stops the shared channel worker. Viewers disconnect and must tune in again;
disclose that effect before submission.

The explicit stop-and-rebuild choice gives the user a fresh programming slate.
Clear the active turn, all default/featured round continuations, served/skipped
source state, pending marathon opportunities, and channel-wide marathon cooldown.
Treat the interrupted turn as never having happened for these programming decisions,
even if part of its stretch aired. Do not mark it served or carry its marathon
cooldown into the new programming. Evaluate current rules and form a new shuffled
round using the advanced rebuild counter; the same source may be selected again,
and a new marathon is eligible under the configured chance. No marathon is forced.
An explicitly requested fresh rebuild also resets this state when nothing is airing.

Keep historical entries that already ended. Restore collection playback progress
from retained entries after removing interrupted and future selections; a fresh
programming slate is not an implicit restart of every collection at its first
episode or movie. Because the interrupted entry is removed, its collection's progress
rolls back to before it, so the partly aired program airs again in its source's next
turn. A playback-progress reset remains a separate explicit action.
Preserve channel configuration, assignments, rules, and published reservations.
Ordinary finish-current-program regeneration keeps its round and cooldown state;
it does not use this fresh-rebuild exception.

An after-commit worker-stop failure is reported with retryable cleanup and does
not undo the committed schedule. Preserve unrelated published reservations and
reject any attempt to silently rewrite a running deliberate event; its editing
lifecycle remains owned by spec 0007.

## Data Model Impact

Add source assignments with their ordered members (collections or single items),
next-member position,
and ordinary/marathon settings, channel marathon controls
and programming seed with persisted rebuild counter, generated block timing/resolved size and decision provenance, and
restorable round/turn continuation and channel-wide cooldown. Record chosen size separately
from measured airtime and keep programming state separate from collection progress.
Remove the one-block index through a new migration. Extend the loader that
currently selects one block; simply dropping the index is not
sufficient. Keep channel identity, collection membership, and per-collection
progress ownership intact.

## Architecture Boundaries

| Area              | Impact                                                                       |
| ----------------- | ---------------------------------------------------------------------------- |
| Schedule          | Materializes entries from a bounded sequence of blocks                       |
| Playout timeline  | Consumes entries without choosing sources                                    |
| Channel state     | Backend-derived; edits preserve airing unless the user explicitly interrupts |
| kraziBrain        | kraziPlan owns source rotation; schedule capability owns entry generation    |
| SignalPackager    | No programming decisions or new per-viewer sessions                          |
| Provider adapters | Continue exposing the materialized guide and shared channel URLs             |

`apps/server` owns persistence, transactions, administrative routes, and triggers.
My Channels consumes backend previews and status. Reuse existing selection,
progress restoration, coverage, and transition-coordination capabilities.

## Open Questions

None for the source rotation, stretch, marathon, migration, and edit policies in
this spec. Calendar edge cases, reservation coverage, and manual publication
questions remain in specs 0005–0007.

## Acceptance Criteria

- Configure four collections once and generate weeks of programming without daily edits.
- Each usable source gets exactly one turn per stable eligible round with
  reproducible shuffling; coincidentally repeated permutations are allowed.
- Avoid same-source turns when another pending usable source exists, without
  inventing duplicate turns to prevent unavoidable repeats.
- Each collection resumes its own ordering after the others air.
- An assignment holding several members takes one turn per round and gives
  successive turns to its members in saved order, each collection resuming its
  own progress; an unschedulable member is skipped without consuming progress.
- A single-item member airs once, whole, per turn, ignoring the stretch setting
  and never becoming a marathon; no one-item collection is needed.
- A 60-minute target airs whole programs and explains any overrun.
- With 22-minute episodes and a 60-minute target, each uninterrupted turn airs
  three episodes (66 minutes); a later turn still targets 60 minutes.
- Exact target equality ends the turn without selecting an additional program.
- Program-count stretches select exactly that many whole programs, wrapping as needed.
- A movie assignment configured for one ordinary program airs one whole movie
  regardless of duration, then yields to the next pending source. A selected
  two- or three-program marathon airs that many whole movies from the same
  collection in its playback mode, without adding another movie to meet airtime.
- Variable airtime chooses once within inclusive bounds; equal bounds are fixed.
- Source and size randomness cannot change collection playback randomness.
- Marathons extend existing turns, keep the assignment's playback mode, and
  continue its collection progress normally.
- Generated marathons resume saved collection progress; a deliberate full-series
  event explicitly starting from the beginning selects the ordered series once,
  does not wrap, and leaves ordinary collection progress and marathon cooldown
  unchanged under spec 0007's override lifecycle.
- At most one marathon starts per round; a two-round interval requires two
  completed ordinary rounds before another eligible chance decision.
- Cooldown spans default and featured contexts. A previously reserved opportunity
  blocked at turn start becomes ordinary without rerolling; round completion is
  counted once, and the marathon-containing round does not advance cooldown.
- Rule-specific size settings override assignments for referenced sources, satisfy
  effective ordinary/marathon validation, and leave assignment configuration intact.
- Lost opportunities are not replaced; started marathons ended by automatic
  policy or finish-current-program regeneration retain cooldown.
- Joins preserve pending relative order, grant no served source an extra turn,
  and do not reroll marathon chance.
- Features suspend other rounds and resume eligible pending sources afterward,
  without replaying interrupted turns or resetting collection progress.
- Eligibility loss or feature takeover ends a marathon after its current program,
  discarding remainder without compensation debt.
- Reservations retain an unstarted pending turn's resolved choices without
  consuming playback progress; started interrupted turns yield to pending sources.
- An early-ended turn creates no airtime debt; the source's next turn starts with
  its full target and continues its collection playback progress.
- Unschedulable sources are skipped; an entirely unusable channel reports why.
- One source or one available member continues looping indefinitely.
- Single-source migration preserves existing ordering, random seed, and covered entries;
  a single-item loop becomes a one-member assignment and keeps looping.
- Restart and different transaction chunk sizes produce equivalent programming decisions.
- Preview changes neither published entries nor persisted progress.
- Preview explains source, size, marathon choices, skips, and interruptions,
  matches generation on copied inputs, and changes no round state or cooldown.
- Rollback, restart, and chunking preserve shuffled order, resolved sizes, and cooldown.
- Reordering assignments preserves the retained round and grants no duplicate turns.
- Setup suggests one movie or three episodes per ordinary turn, with marathons
  disabled; enabling them suggests 10% chance and two ordinary rounds of cooldown.
- A size/mode edit ends the started turn after its airing program by default,
  marks the turn served and retains marathon cooldown even if the stretch was
  shortened, regenerates from that boundary, and invalidates stale preparations.
- Explicit stop-and-rebuild follows ADR 0003: regenerate from now, then stop the
  worker after commit; report cleanup failure without rolling back committed changes.
- Explicit fresh rebuilding clears all round continuations and marathon cooldown,
  treats the interrupted turn as unserved, and creates new seeded programming
  choices. Repeating the same source is allowed; another marathon may be chosen.
- A fresh rebuild preserves ended-entry history, configuration, reservations, and
  collection progress restored from retained entries rather than resetting all
  collections. Rebuild retries advance the persisted counter only once.
- Automatic regeneration and the finish-current-program option never trigger a
  fresh slate; previews and restarts preserve the chosen rebuild's decisions.
- Neither edit path silently rewrites published reservations or a running manual event.
