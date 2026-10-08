# Recommended And Automatic Collections

Status: Draft

## Problem

Manual membership editing is useful but becomes a barrier when a catalog contains
thousands of episodes and movies. Users need useful starting collections without
automatic creation of an unwanted collection list.

## Goals

- Recommend understandable collections with a preview and explanation.
- Require consent before creating each collection.
- Let accepted collections optionally follow newly enriched catalog media.
- Preserve manual collection creation, saved order, and ordinary consumption.

## Non-goals

- Creating collections merely because a scan completed.
- Arbitrary queries, nested boolean filters, or a collection scripting language.
- Channel source selection, seasonal scheduling, or media acquisition.
- Per-item inclusion/exclusion exceptions within automatic maintenance.

## Dependencies And Spec Boundary

Depends on [content enrichment](0001-metadata-enrichment.md) for accepted metadata
and stable content identities. Conservative catalog-structure suggestions can be
offered without enrichment. Recommendation acceptance and membership maintenance
belong here; metadata identification and programming policy remain separate.
Metadata-derived default order reuses spec 0003. Basic recommendations can use
deterministic saved order before that ordering capability is available.

## Established Behavior And Proposed Policy

Existing collections are explicitly ordered memberships consumed by programming
blocks. Membership changes already pass through schedule input-change orchestration.
The following recommendation and maintenance behavior is proposed.

## User-Facing Behavior

Collections shows recommendations such as one series, a recognized movie franchise,
a genre, or an explicit theme. Each shows why it was suggested and its proposed
members. A franchise collection and an individual series collection are different
recommendations even when their media overlap.

The user accepts a recommendation as either:

| Choice               | Behavior                                                                  |
| -------------------- | ------------------------------------------------------------------------- |
| Manual collection    | Saves the previewed membership; later scans do not manage it              |
| Automatic collection | Saves a supported metadata criterion and maintains its ordered membership |

Dismissed recommendations do not repeatedly reappear unchanged. Existing equivalent
accepted recommendations are shown as already created. A user can convert an
automatic collection to manual maintenance while retaining its current membership.
Direct membership editing requires that conversion; renaming does not.

## Technical Behavior

### Recommendation Identity And Criteria

Start with fixed criteria: one series, one franchise, one genre, or one explicit
tag/theme. Use normalized identities rather than display-name equality. Holiday
relevance requires accepted metadata or user tags; do not infer Christmas from an
unrelated genre. Directory-based suggestions disclose their uncertain basis and
are accepted as manual snapshots until a reliable metadata criterion exists.

Recommendation identity derives from its criterion, allowing repeat scans to
recognize acceptance and dismissal. User-created collections need not be merged or
renamed merely because they resemble a recommendation. Acceptance revalidates the
current catalog and prevents duplicate creation from concurrent requests.

### Automatic Maintenance

An automatic collection materializes ordered membership in the existing collection
membership representation. Programming never executes its criterion. Membership
includes cataloged matching items regardless of temporary availability; scheduling
continues to filter schedulable items. Removed catalog items are excluded.

Use a stable default saved order: supported episode order for a series, release
order for movie groups, and deterministic ties/fallbacks from spec 0003. This
initial saved order does not dictate a channel's playback mode.

After effective metadata or catalog membership changes, recompute affected
automatic collections. Reconcile membership through the existing schedule
input-change transaction boundary. No-op recomputation does not regenerate.
Retries are idempotent and report failures; a later recomputation converges from
current committed catalog facts. Revalidate facts before applying results so stale
recommendations or computations cannot restore removed members.

Corrections can add or remove members. Preview manual criterion changes before
applying them. An unavailable enrichment provider alone does not erase accepted
facts or empty collections. Collection changes preserve the currently airing entry
under existing regeneration policy.

## Data Model Impact

Add collection maintenance mode and a narrow criterion for automatic collections,
plus recommendation acceptance/dismissal identity. Keep collection IDs and ordered
membership rows. Deleting an accepted collection does not silently recreate it.
Recommendation storage should retain user decisions, not duplicate the catalog.

## Architecture Boundaries

| Area              | Impact                                                               |
| ----------------- | -------------------------------------------------------------------- |
| Schedule          | Membership changes use existing regeneration orchestration           |
| Playout timeline  | Continues consuming published entries                                |
| Channel state     | Current airing remains unchanged by membership maintenance           |
| kraziBrain        | Consumes ordinary ordered collections, never recommendation criteria |
| SignalPackager    | No changes                                                           |
| Provider adapters | No provider objects or naming assumptions in criteria                |

Server collection capabilities own recommendations, maintenance, persistence, and
status. Collections UI displays server previews and decisions rather than
reimplementing matching or schedulability.

## Open Questions

- Should automatic maintenance or a manual snapshot be the default acceptance choice?
- How should a user restore dismissed recommendations or request one again after deletion?
- What minimum evidence or member count makes a recommendation useful?
- Should acceptance be offered in batches with explicit per-recommendation selection?
- How should duplicate local files representing the same episode appear in a preview?

## Acceptance Criteria

- Scanning a large catalog offers recommendations without creating collections.
- Accepting one recommendation creates one ordinary usable media collection.
- Concurrent acceptance cannot create duplicate collections for the same decision.
- Dismissal survives rescans; unrelated manual collections remain editable.
- New matching episodes enter an automatic collection but not a manual snapshot.
- A metadata correction updates affected membership without interrupting airing media.
- Temporary missing status does not remove a matching member; catalog removal does.
- Converting to manual preserves membership and prevents later automatic edits.
- A no-op maintenance pass leaves the materialized schedule unchanged.
