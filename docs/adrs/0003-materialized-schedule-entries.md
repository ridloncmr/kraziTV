# 0003 Materialized Schedule Entries

## Status

Accepted

## Context

kraziTV's guide, current playout state, and stream selection must agree on the same timeline. Regenerating schedule windows on demand can make overlapping queries disagree, especially once random playback is supported.

For example, a request for 12:00-18:00 and a later request for 15:00-21:00 must return the same programming in the overlapping period.

## Decision

kraziTV will persist generated `ScheduleEntry` records.

Schedule generation will extend a future horizon for enabled channels. Persisted entries are the authority for guide output, playout lookup, and stream selection.

Configuration changes must not silently change what is currently airing. Regeneration begins at the current program end; when nothing is airing, it begins at the first future entry or the persisted schedule anchor when no entries exist.

Catalog availability changes do not rewrite published schedule entries. Channel-state lookup reports unavailable media explicitly instead of silently selecting a replacement.

## Consequences

- Guide responses remain stable across restarts and overlapping API requests.
- Channel state and stream output can resolve against the same schedule entries Plex sees.
- Schedule regeneration needs explicit policy and logging.
- The database carries schedule data, not only channel configuration and media catalog data.
