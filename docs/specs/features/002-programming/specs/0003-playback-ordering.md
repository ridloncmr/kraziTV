# Collection Playback Ordering

Status: Implemented

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

## Established Behavior And Approved Policy

`chronological` currently walks persisted membership positions and wraps forever.
`random` uses a channel-and-collection seed and selection index, with replacement.
Progress is persisted per channel and collection, separately per current mode.

The ordering and identity-based continuation policies below are approved product decisions. [ADR 0009](../../../../adrs/0009-programming-blocks.md)'s progress contract was amended on 2026-10-13 to cover identity-based continuation for all ordered modes, including collection order, and per-mode progress; shared collection-progress ownership is unchanged.

## User-Facing Behavior

| Ordering         | Meaning                                                              |
| ---------------- | -------------------------------------------------------------------- |
| Collection order | Follow the collection's explicit saved membership order              |
| Episode order    | Follow accepted series, season, and episode metadata                 |
| Release order    | Follow accepted release dates or years                               |
| Random           | Use the existing reproducible selections, including possible repeats |

API playback modes are `chronological` (Collection order), `episode` (Episode order), `release` (Release order), and `random` (Random). Keep existing `chronological` and `random` values without a rename migration. Existing chronological configurations continue to select saved collection order; their continuation after changes follows the approved identity-based policy once the ADR is extended. Single-item blocks have no ordering control or progress.

The server provides an ordered preview that identifies unresolved metadata, series grouping, and duplicate files identifying the same episode. Different channels can consume the same collection with different ordering. Duplicate files remain independently selectable; the preview flags them without blocking playback or silently removing members. Users remove unwanted versions from the collection.

## Technical Behavior

### Resolving An Ordered View

Return an ordered projection of existing members; preserve saved membership rows. Episode order sorts identified series deterministically by normalized series identity, then season and episode. Normalized series identity is the effective TMDB series ID when the item has one; otherwise it is the effective series name, compared case-insensitively with surrounding and repeated whitespace collapsed. A series name the owner corrected away from the provider's series therefore groups by name, never by a guessed TMDB ID. Items without the required metadata follow resolved items in saved order. Resolve ties by saved membership position and stable media item identity.

Release order compares year first, then known month and day, without inventing missing values. Within the same year, year-only dates follow dates with a known month; within the same month, month-only dates follow dates with a known day. Items without a release year follow dated items in saved order. Equal release values and precision use the standard saved-position and media-identity tie-breakers.

Season zero sorts before season one. A multi-episode file sorts at its first identified episode and airs once as its complete file; ordering does not split files. Mixed-series collections group by normalized series identity, and the preview makes that grouping visible rather than presenting it as cross-series broadcast chronology. Cross-series interleaving belongs to a separate programming feature.

### Progress And Changes

Progress remains scoped to channel and collection, with independent continuation
for each ordering mode. Separate blocks using the same collection and mode share
continuation. Switching modes does not advance inactive modes.

For every ordered mode (`chronological`, `episode`, and `release`), store the last retained selected media identity and the consumed ordered position. On changed membership or effective ordering, continue after that identity in the new ordering, wrapping at the end. If it is absent, use the recorded position modulo the new member count as a deterministic fallback when the collection is nonempty. This rule may replay or skip content after a substantial reorder; show the resulting upcoming selections rather than claiming to track an entire watched set.

Schedule entries retain enough selection information to restore progress after
deleting future entries. Persisted progress can be ahead of actual airing because
the horizon is materialized; restoration must use retained schedule decisions.

### Explicit Progress Reset

Offer a confirmed reset for the selected channel, collection, and playback mode. For ordered modes, reset starts at the beginning; for random, it resets the selection index while retaining the existing seed scope. Preserve the currently airing entry and regenerate future entries from the regeneration boundary using the reset progress, rather than restoring the previous continuation from retained entries. Other collections and inactive modes are unaffected.

The confirmation warns that future schedule entries will be regenerated and that every programming block on this channel sharing the collection and mode shares the reset. Show the resulting upcoming selections in the preview.

### Availability And Metadata Changes

Random keeps the existing seed scope, selection-index arithmetic, and availability
filtering. Source changes may change future picks, but unrelated collection
selections must not advance its index. All modes skip unschedulable media and loop
when at least one member is schedulable.

Metadata corrections affecting active ordering are scheduling input changes,
regenerated after the airing entry. A metadata change with no effective order or
membership change must not cause unnecessary regeneration.

Every metadata write counts: corrections, match choices, refreshes, lookup
retries, and scan enrichment. After the write, resolve the ordered view of each
collection containing a changed item and compare it with the view before the
write. Regenerate only channels whose programming blocks play that collection in
`episode` or `release` order, and only when that view changed. Metadata never
regenerates `chronological` or `random` playback, which do not read it.

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

None. [ADR 0009](../../../../adrs/0009-programming-blocks.md) was amended on 2026-10-13 to cover identity-based continuation and per-mode progress.

## Acceptance Criteria

- Existing chronological channels retain saved-order playback after migration.
- One collection can air in saved order on one channel and episode order on another.
- Metadata ordering never rewrites saved collection positions.
- Missing metadata and tied values produce stable, explained ordering.
- Episode order groups series by normalized identity, puts season zero before season one, and airs each multi-episode file once at its first identified episode.
- Release order respects date precision, places less precise values after more precise values within the same year or month, and puts undated items last.
- Duplicate episode files remain selectable and are flagged in the preview without blocking playback.
- A collection resumes after other collections air, without consuming their progress.
- Mode changes preserve each inactive mode's continuation.
- Membership or effective ordering changes in every ordered mode resume after the retained selected identity, or use the recorded position modulo the new nonempty member count if that identity is absent.
- Chunked generation, restart, and regeneration restore equivalent selections.
- Confirmed progress reset affects only the selected channel, collection, and mode, preserves current airing, and regenerates future entries from reset progress for every block sharing that progress.
- Reset confirmation warns about future regeneration and shared blocks; the preview shows the resulting upcoming selections.
- Random still permits repeats and never calls unseeded randomness.
- Every nonempty schedulable ordering loops indefinitely and preserves current airing.
