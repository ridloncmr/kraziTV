# Recommended And Automatic Collections

Status: Implemented

## Problem

Manual membership editing becomes a barrier when a catalog contains thousands of
episodes and movies. Users need collections that maintain themselves as media and
metadata change, while retaining control over which collections exist and which
qualifying items they include.

## Goals

- Separate manual and automatic collections into two grids in Collections.
- Prioritize useful TV series and movie franchise recommendations with previews.
- Require explicit acceptance before creating each collection.
- Maintain accepted automatic collections after catalog and metadata changes.
- Support user-tag collections and standard genre collections created on request.
- Support durable per-collection exclusions without ending automatic maintenance.
- Preserve manual creation, saved order, and ordinary programming consumption.

## Non-goals

- Creating collections merely because a scan completed or a tag was added.
- Recommending genres or filling the landing grid with unaccepted suggestions.
- Arbitrary queries, nested boolean filters, or a collection scripting language.
- AI or machine-learning interpretation of TMDB data.
- Forcing nonmatching items into automatic collections.
- Channel source selection, seasonal scheduling, or media acquisition.
- Additional collection types such as actor, director, studio, or decade.

## Dependencies And Spec Boundary

Depends on [content enrichment](0001-metadata-enrichment.md) for accepted metadata
and stable content identities. User-tag collections need no metadata provider.
Conservative catalog-structure suggestions can be offered without enrichment as
manual snapshots. Standard genre collections use the genres already supplied by
spec 0001. Descriptive keyword/theme matching is a spike and stretch goal below;
it is not a dependency for delivering automatic collections. Spec 0001 does not
import TMDB keywords, and this spec does not change its enrichment contract.

Recommendation acceptance, criteria, exclusions, and maintenance belong here;
metadata identification and programming policy remain separate. Metadata-derived
default order reuses spec 0003. Basic recommendations can use deterministic saved
order before that ordering capability is available.

## Established Behavior And Proposed Policy

Existing collections are explicitly ordered memberships consumed by programming
blocks. Membership changes already pass through schedule input-change orchestration.
The following UI, recommendation, exclusion, and maintenance behavior is proposed.

## User-Facing Behavior

### Landing And Creation

Collections opens with two tabs, each displaying a grid of created collections:

| Tab           | Contents and actions                                                                        |
| ------------- | ------------------------------------------------------------------------------------------- |
| **Manual**    | User-maintained collections; **New collection…** creates an empty collection                |
| **Automatic** | Accepted automatic collections; **New automatic collection…** and **Discover collections…** |

Cards show the name and included member count. Automatic cards also show their
matching basis and maintenance status, including failures. Every card is the
same height, each line cut to fit. Clicking a card opens its editor in
**Collection Properties**, a window of its own beside Collections, so the grid
stays in view and several collections can be open at once; a new collection
opens there as soon as it is created. Closing a window with unsaved changes asks
first. Empty grids offer creation actions; recommendations do not appear as
created collections until accepted.

**Discover collections…** opens recommendations within the Collections program.
Prioritize TV series and recognized movie franchises. Show why each was suggested,
its proposed members, and its member count. Never recommend genre collections.
Tag collections are created by selecting a user tag; adding a tag alone never
creates a collection.

### Automatic Collection Types

| Type            | Matching basis                    | Examples                                          |
| --------------- | --------------------------------- | ------------------------------------------------- |
| TV series       | One normalized series identity    | Lost, The Office                                  |
| Movie franchise | One normalized franchise identity | Harry Potter, Indiana Jones                       |
| User tag        | One explicit user tag             | Christmas movies and individually tagged episodes |
| Genre           | One accepted standard genre       | Action, Adventure                                 |

TV series and movie franchises share a creation flow but retain distinct criteria
and default ordering. A franchise and an individual series remain different
recommendations even when their media overlap.

Tag collections combine manual classification with automatic membership. Adding
or removing a tag updates every accepted automatic collection based on that tag,
subject to each collection's exclusions. Tags apply to media items: tagging an
episode does not tag its siblings. Whole-series bulk tagging is a separate UI
decision and must explicitly identify the affected items.

Genre creation starts with a user request: the user selects a supported standard
genre and previews matching catalog media before confirming creation. A
collection name alone is never a matching rule. Descriptive phrases such as
“Pulpy Action Adventure” are outside required delivery; the spike below evaluates
whether to offer them as a stretch goal. Until then, users can create a collection
based on an explicit user tag with that name.

### Acceptance And Editing

The user accepts a recommendation as either:

| Choice               | Behavior                                                              |
| -------------------- | --------------------------------------------------------------------- |
| Manual collection    | Saves previewed membership; later scans and metadata do not manage it |
| Automatic collection | Saves a supported criterion and maintains ordered membership          |

Automatic creation is the primary action in the Automatic tab; a manual snapshot
is an explicit alternative. Dismissed recommendations do not repeatedly reappear
unchanged. Accepting one keeps discovery open so several can be accepted in
one visit. A recommendation an automatic collection already maintains leaves
the list; one saved as a manual snapshot stays listed as saved. Deleting an
accepted collection does not silently recreate it.

An automatic editor shows its criterion, members, and maintenance status.
Renaming does not change the criterion. Preview criterion changes before applying
them. Arbitrary member additions and direct saved-order edits require conversion
to manual; renaming and exclusions do not.

Conversion preserves current included membership and saved order, clears the
automatic criterion and exclusions, and ends maintenance. Manual membership is
changed only by the user, except existing catalog-removal policy, which removes
deliberately removed catalog items from every collection. Scans, tags, and
metadata changes never infer manual additions or removals.

### Persistent Exclusions

**Exclude from this collection** removes an item from that collection's included
membership without affecting the catalog or other collections. It remains
excluded until the user chooses **Restore inclusion**, even after rescans and
metadata changes. An Indiana Jones collection can therefore exclude its last
two movies while continuing to include future qualifying catalog media.

Keep excluded items accessible in the same editor through **Show excluded**.
Give each an **Excluded** label and distinct styling, which may include red text;
color alone must not convey the decision. Show whether it currently qualifies.
Restoration includes it only if it currently matches. Excluded items do not
count as included members and cannot enter programming through this collection.

## Technical Behavior

### Recommendation Identity And Criteria

Use normalized identities rather than display-name equality. Tags have stable
identities independent of their display names. Directory-based suggestions
disclose their uncertain basis and remain manual snapshots until reliable
metadata criteria exist.

Recommendation identity derives from its criterion, allowing repeat scans to
recognize acceptance and dismissal. User-created collections need not be merged
or renamed merely because they resemble a recommendation. Acceptance revalidates
the current catalog and prevents duplicate creation from concurrent requests.

Required criteria are one TV series, one movie franchise, one user tag, or one
standard genre. Matching uses accepted local catalog facts, not inferred meaning
from a collection name. Holiday collections require explicit relevant evidence
or user tags; do not infer Christmas from an unrelated genre.

### Descriptive Theme Spike And Stretch Goal

[COL-012](../../../../implementation_plan/002-programming/0002-automatic-collections.md#col-012-spike-descriptive-theme-collections)
closed this without the spike: descriptive themes are deferred to a later
feature spec. The text below records the original intent.

Investigate whether a phrase such as “Pulpy Action Adventure” can produce a useful,
explainable automatic collection. This is a feasibility spike, not a promised
feature or an acceptance gate for the required collection types.

The spike should answer:

- Do existing genres provide enough evidence, or would TMDB keywords be needed?
- Does the available metadata distinguish the intended theme from broad Action
  or Adventure membership? Evaluate The Mummy, Pirates of the Caribbean, and
  Indiana Jones alongside examples that should not qualify.
- What additional lookup, persistence, refresh, expiry, UI, and maintenance work
  would be needed, given that spec 0001 does not import keywords?
- Can a bounded, deterministic rule provide useful results with modest effort?

Record the evidence, proposed rule, matching limitations, effort estimate, and
recommendation to implement as a stretch goal or defer. The spike does not amend
spec 0001 or require production keyword ingestion. If the work is substantial,
defer it to a later feature spec; automatic collections can complete without it.

If the stretch goal is adopted, preview and confirm an explainable rule before
creation, store that rule rather than reinterpreting the phrase on each scan,
and never silently change it when phrase mappings change. Keep provider keywords
separate from user tags and preserve their movie/series scope. Series-level
keywords cannot establish holiday relevance for every episode. Only cataloged
media can become members, and TMDB data must never be passed to a model. Any
enrichment extension needs its own explicit scope and acceptance criteria before
implementation.

### Automatic Maintenance

Acceptance enables maintenance; an unaccepted recommendation is never maintained
as a collection. Materialize ordered membership in the existing collection
membership representation. Programming never executes criteria or interprets
exclusion records.

Included membership is cataloged matching items minus that collection's
exclusions, regardless of temporary availability. Scheduling continues filtering
schedulable items. Removed catalog items are excluded under existing policy.

Use a stable default saved order: supported episode order for a series, release
order for movie groups, and deterministic ties/fallbacks from spec 0003. This
saved order does not dictate a channel's playback mode.

After effective metadata, user tags, catalog membership, criteria, or exclusions
change, recompute affected automatic collections. Reconcile membership through
the existing schedule input-change transaction boundary. No-op recomputation
does not regenerate. Retries are idempotent and report failures; later
recomputation converges from current committed facts.

Before applying results, revalidate catalog facts, collection existence,
maintenance mode, criterion, and exclusions. Delayed work cannot undo a newer
exclusion, criterion edit, conversion, or deletion, or restore removed items.

Exclusions are scoped to collection ID and media item ID. Keep them across scans,
metadata corrections, criterion edits, and periods when the item no longer matches.
They are decisions, never positive membership rows. Renamed or moved files have
new media item identities under the catalog model; transferring exclusions across
those identities is outside this scope. Purging removed items may delete their
exclusion records.

An unavailable enrichment provider alone does not erase accepted facts or empty
collections. Provider-fact expiry follows spec 0001: distinguish unavailable
evidence from a confirmed mismatch, preserve the last included membership while
matching evidence is unavailable, and report incomplete maintenance. Explicit
catalog removals, exclusions, and confirmed criterion/tag changes still apply.
Restored evidence reconciles membership from current facts; do not retain expired
provider payloads for matching.

Collection changes preserve the currently airing entry under existing
regeneration policy. Both modes remain ordinary sources for programming blocks;
creation never assigns a collection to a channel or selects a playback mode.

## Data Model Impact

Add collection maintenance mode, a narrow saved criterion, per-collection media
item exclusions, recommendation acceptance/dismissal identity, and maintenance
diagnostics. Keep collection IDs and ordered membership rows. Store user decisions
rather than duplicating the catalog or persisting separate copies of matching
media. Excluded rows are decisions, not programming members.

## Architecture Boundaries

| Area              | Impact                                                               |
| ----------------- | -------------------------------------------------------------------- |
| Schedule          | Effective membership changes use existing regeneration orchestration |
| Playout timeline  | Continues consuming published entries                                |
| Channel state     | Current airing remains unchanged by membership maintenance           |
| kraziBrain        | Consumes ordinary ordered collections, never criteria or exclusions  |
| SignalPackager    | No changes                                                           |
| Provider adapters | No provider objects or naming assumptions in criteria                |

Server collection capabilities own recommendations, rule interpretation,
maintenance, persistence, and status. Collections UI displays server previews and
decisions rather than reimplementing matching or schedulability. Only
`packages/media` fetches provider facts, as required by ADR 0013.

## Open Questions

- Does the descriptive theme spike justify a modest stretch goal, or should its
  findings become the basis for a later spec?
- How should a user restore dismissed recommendations or request one again after deletion?
- What minimum evidence or member count makes a recommendation useful?
- Should acceptance be offered in batches with explicit per-recommendation selection?
- How should duplicate local files representing the same episode appear in a preview?
- Should a separate pause/resume control be offered? Acceptance enables
  maintenance and conversion ends it in this scope.

## Acceptance Criteria

- Collections lands on Manual and Automatic tabs with grids of created collections;
  discovery never populates either grid before acceptance.
- Scanning offers TV series and movie franchise recommendations without creating
  collections or recommending genres.
- Accepting one recommendation creates one ordinary usable media collection;
  concurrent acceptance cannot create duplicates for the same decision.
- Dismissal survives rescans; unrelated manual collections remain editable.
- New matching episodes enter an automatic collection but not a manual snapshot.
- Tag additions/removals update every affected automatic tag collection, never
  creating collections or inferring changes to manual membership.
- Christmas-tag collections accept movies and individually tagged episodes,
  without including untagged sibling episodes.
- Standard genre creation starts on request, previews matching catalog media,
  and requires confirmation; genre collections are never recommended.
- Required delivery does not depend on descriptive theme matching or provider
  keyword ingestion. A theme spike or its deferral does not block completion.
- Exclusions affect only their collection and persist through rescans, metadata
  corrections, criterion edits, and loss and return of matching status.
- Excluded items remain inspectable with a label and restore action; restoration
  includes only currently qualifying items.
- Pending computations cannot undo newer exclusions, criterion edits,
  conversions, or deletions, or restore removed catalog items.
- Metadata corrections update membership without interrupting airing media.
- Temporary missing status does not remove a matching member; catalog removal does.
- Unavailable or expired evidence reports incomplete maintenance without treating
  it as a confirmed mismatch or retaining expired provider payloads.
- Converting to manual preserves included membership and order, clears criteria
  and exclusions, and prevents later automatic edits.
- A no-op maintenance pass leaves the materialized schedule unchanged.
