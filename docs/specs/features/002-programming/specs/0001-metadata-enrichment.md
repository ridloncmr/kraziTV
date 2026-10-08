# Content Metadata Enrichment

Status: Draft

## Problem

The catalog discovers local files and probes technical facts, but filename-derived
titles cannot reliably identify series, episode order, franchises, or themes.
Useful programming should not require users to classify thousands of files.

## Goals

- Enrich catalog media with normalized content metadata after technical probing.
- Support uncertain matches and durable user corrections.
- Keep local scanning and broadcasting useful without a metadata service.
- Provide facts that collections and playback ordering can consume independently.

## Non-goals

- Collection creation, channel rules, or schedule generation.
- Implementing Plex, Jellyfin, and external metadata integrations simultaneously.
- Dynamic provider registration, a plugin framework, or a universal matching engine.
- Cross-root file deduplication, media acquisition, or comprehensive artwork hosting.

## Dependencies And Spec Boundary

Depends on the existing catalog scan and normalized probe results. This capability
has its own matching, correction, and failure lifecycle; downstream programming
consumes accepted facts rather than performing lookups. Provider selection remains
an open product decision and requires research before implementation.

## Established Behavior And Proposed Policy

The scanner already composes discovery, probing, candidate validation, and atomic
persistence, with an explicit enrichment seam after probing. Media item identity
is its media root and normalized path; enrichment must not replace that identity.

The sections below propose enrichment policy. They do not claim these fields or
provider operations already exist, or supersede accepted architectural decisions.

## User-Facing Behavior

1. A user scans local media with enrichment disabled or a configured provider enabled.
2. Scan progress distinguishes technical probing from content enrichment.
3. Media Library shows accepted metadata and unresolved or ambiguous matches.
4. The user can choose a candidate, reject a match, correct a field, or clear a
   correction to allow provider updates again.
5. The user can retry enrichment for existing catalog items without reprobe.

A provider outage reports enrichment failures without turning technically usable
media into `probe_failed`. Unmatched media retains its filename-derived title and
remains eligible for ordinary collections and scheduling.

## Technical Behavior

### Normalized Facts

Represent content type as movie, episode, or unknown. Optional facts include title,
series identity/name, season and episode information, release date or year,
franchise membership, genres, editable tags/themes, description, and artwork
references. Unknown facts remain absent; filename guesses are not accepted facts.
Preserve date precision: a known year does not imply January 1 of that year.

Series and franchise identity must distinguish remakes and similarly named works.
Provider IDs are references attached to normalized identities, not scheduling IDs.
Multi-episode files must retain the information needed to explain their identity;
their initial ordering treatment is decided in spec 0003.

### Matching And Corrections

Use explainable match states: unmatched, ambiguous, matched, and rejected, with a
separate enrichment error when lookup fails. Record provider, external identity,
lookup time, and matching evidence. Keep provider-specific confidence separately
when supplied; do not compare unrelated providers' scores as a universal ranking.

Effective metadata uses user corrections ahead of provider facts. A rejected
association stays rejected on repeat scans unless the user explicitly retries
that association or clears the rejection. A transient failure preserves earlier
accepted facts. Rescanning must not overwrite corrected titles with filenames.

### Processing And Commit

Wire enrichment explicitly after probe and before candidate validation; operations
return normalized values and never write SQLite themselves. External calls use
bounded concurrency, timeouts, and cancellation outside database write authority.
Restore discovery order before the scan's atomic catalog commit.

Item lookup errors are optional failures. An unexpected processing or validation
failure aborts the scan and leaves the previous catalog unchanged. Extend the
scan's cancellable phase through enrichment; cancellation before commit settles
started work and commits no partial catalog. Commit remains non-cancellable.

Metadata-only retry revalidates item existence and correction ownership when it
commits, so delayed results cannot resurrect removed media or erase newer edits.
It does not reconcile missing files. Notify collection maintenance only after
committed effective metadata changes; availability changes alone keep the existing
published-schedule policy.

## Data Model Impact

Add content facts, normalized content identities where needed, provider references,
match decisions, user corrections, and enrichment diagnostics/timestamps. Keep
technical availability separate from metadata completeness. Exact table shapes
remain an implementation design decision; do not build a generic evidence graph.

## Architecture Boundaries

| Area              | Impact                                                                           |
| ----------------- | -------------------------------------------------------------------------------- |
| Schedule          | No direct writes; changed downstream collection inputs may require regeneration  |
| Playout timeline  | No selection changes; technical media facts remain authoritative for playability |
| Channel state     | Remains backend-derived from schedule and catalog snapshots                      |
| kraziBrain        | Receives normalized metadata projections only when ordering needs them           |
| SignalPackager    | No enrichment or matching responsibilities                                       |
| Provider adapters | Metadata lookup mapping stays isolated from scheduling and tuner exposure        |

`packages/media` owns persistence-free inspection and enrichment capabilities;
`apps/server` composes operations, stores results, and exposes administrative APIs.
Reuse the existing candidate, writer, scan job, and cancellation seams.

## Open Questions

- Which concrete provider ships first, and what credentials and optional setup does it require?
- What matching evidence is sufficient for automatic acceptance?
- Which metadata fields and artwork references are required in the first release?
- How should a changed file at an existing path invalidate an old match?
- Should filename/directory hints be displayed as suggestions before provider setup?

## Acceptance Criteria

- With enrichment disabled or unreachable, usable local media can still be scanned,
  manually collected, and broadcast.
- Ambiguous titles produce a visible choice rather than a silently accepted match.
- A corrected series, episode, or title survives rescans and metadata retries.
- A rejected match is not silently reapplied by a later scan.
- Lookup errors preserve accepted metadata and remain distinct from probe failures.
- Cancelled enrichment leaves the previous catalog unchanged and settles active work.
- A delayed retry cannot restore a removed item or overwrite a newer correction.
- Provider payloads never enter schedule generation, and metadata-only retry does
  not require ffprobe or change published guide entries directly.
