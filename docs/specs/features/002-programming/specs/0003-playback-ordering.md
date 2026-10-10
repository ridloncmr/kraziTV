# Collection Playback Ordering

Status: Draft

## Problem

Current chronological playback means saved collection order. Content metadata
introduces episode and release ordering that must not silently redefine that
behavior or overwrite users' saved membership order.

## Goals

- Distinguish saved order, metadata episode order, metadata release order, and random.
- Keep ordering a collection-sourced programming block choice.
- Preserve deterministic continuation as membership or metadata changes.
- Keep the existing random behavior and existing configurations compatible.

## Non-goals

- Source alternation, programming rules, clock reservations, or manual publishing.
- Watch-history integration, alternate provider episode-order schemes, or no-repeat shuffle.
- Changing a collection's saved order just because a channel selects metadata order.

## Dependencies And Spec Boundary

Metadata ordering depends on [content enrichment](0001-metadata-enrichment.md).
Saved-order and random operation do not. Ordering deserves its own contract because
single-source and multi-source channels share the same continuation problems.

## Established Behavior And Proposed Policy

`chronological` currently walks persisted membership positions and wraps forever.
`random` uses a channel-and-collection seed and selection index, with replacement.
Progress is persisted per channel and collection, separately per current mode.

New ordering and identity-based continuation below are proposals. Before adopting
them, explicitly extend ADR 0009's progress contract. Do not silently rewrite its
accepted positional semantics or shared collection-progress ownership.

## User-Facing Behavior

| Ordering         | Meaning                                                              |
| ---------------- | -------------------------------------------------------------------- |
| Collection order | Follow the collection's explicit saved membership order              |
| Episode order    | Follow accepted series, season, and episode metadata                 |
| Release order    | Follow accepted release dates or years                               |
| Random           | Use the existing reproducible selections, including possible repeats |

Existing `chronological` settings retain collection-order behavior. Exact API mode
names and compatibility migration are implementation decisions; labels must explain
the distinction. Single-item blocks have no ordering control or progress.

The server provides an ordered preview and identifies unresolved metadata. Different
channels can consume the same collection with different ordering.

## Technical Behavior

### Resolving An Ordered View

Return an ordered projection of existing members; preserve saved membership rows.
Episode order sorts identified series deterministically, then season and episode.
Release order uses known date precision without inventing a month or day. Items
without the required metadata follow resolved items in saved order. Resolve ties
by saved membership position and stable media item identity.

Proposed defaults: season zero sorts before season one; a multi-episode file sorts
at its first identified episode and airs once as its complete file. Mixed-series
collections group series by normalized identity, with the preview explaining that
this is not a cross-series broadcast chronology. Product approval is required for
these defaults before implementation.

### Progress And Changes

Progress remains scoped to channel and collection, with independent continuation
for each ordering mode. Separate blocks using the same collection and mode share
continuation. Switching modes does not advance inactive modes.

For ordered playback, propose storing the last retained selected media identity
and the consumed ordered position. On changed membership, continue after that
identity in the new ordering. If it is absent, use the recorded position modulo
the new member count as a deterministic fallback. Explicit reset starts at the
beginning. This rule may replay or skip content after a substantial reorder; show
the resulting preview rather than claiming to track an entire watched set.

Schedule entries retain enough selection information to restore progress after
deleting future entries. Persisted progress can be ahead of actual airing because
the horizon is materialized; restoration must use retained schedule decisions.

Random keeps the existing seed scope, selection-index arithmetic, and availability
filtering. Source changes may change future picks, but unrelated collection
selections must not advance its index. All modes skip unschedulable media and loop
when at least one member is schedulable.

Metadata corrections affecting active ordering are scheduling input changes,
regenerated after the airing entry. A metadata change with no effective order or
membership change must not cause unnecessary regeneration.

## Data Model Impact

Extend playback mode validation, block settings, per-collection progress, and entry
selection bookkeeping. Migrate existing configurations without changing their
selected ordering. Keep saved collection membership separate from resolved views;
do not add a separate progress store per generated block.

## Architecture Boundaries

| Area              | Impact                                                         |
| ----------------- | -------------------------------------------------------------- |
| Schedule          | New ordering projections and restorable selection bookkeeping  |
| Playout timeline  | Consumes the resulting entries without choosing ordering       |
| Channel state     | Remains derived; current airing is preserved                   |
| kraziBrain        | Owns ordering, selection, continuation, and restoration policy |
| SignalPackager    | No changes                                                     |
| Provider adapters | Supply no ordering policy; normalized facts only               |

Server repositories assemble typed facts and persist decisions. The programming
editor renders backend previews. Reuse existing selection and restoration seams.

## Open Questions

- Approve identity-based continuation for saved order as well as metadata order?
- Approve season-zero, multi-episode, incomplete-date, and mixed-series defaults?
- Should duplicate files for one episode remain selectable or require manual review?
- Should the UI offer an explicit progress reset, and what warning should it show?

## Acceptance Criteria

- Existing chronological channels retain saved-order playback after migration.
- One collection can air in saved order on one channel and episode order on another.
- Metadata ordering never rewrites saved collection positions.
- Missing metadata and tied values produce stable, explained ordering.
- A collection resumes after other collections air, without consuming their progress.
- Mode changes preserve each inactive mode's continuation.
- Membership changes apply the chosen identity/fallback policy reproducibly.
- Chunked generation, restart, and regeneration restore equivalent selections.
- Random still permits repeats and never calls unseeded randomness.
- Every nonempty schedulable ordering loops indefinitely and preserves current airing.
