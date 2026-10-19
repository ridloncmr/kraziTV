# 0017 The Series Folder Names A Show And Its Seasons Break Title Ties

## Status

Accepted on 2026-10-18. Amends the matching policy of
[programming spec 0001](../specs/features/002-programming/specs/0001-metadata-enrichment.md),
which keeps its other rules: weak hints never match, popularity never breaks
a tie, and TMDB is asked before any write
([ADR 0013](0013-metadata-provider-calls-and-stored-key.md)).

## Context

The first enrichment release read a show's series from the folder nearest
the file, matched a series only when exactly one same-titled TMDB result
agreed with any year hint and listed the hinted episode, and refused to tell
same-titled series apart by their episodes. Against a real library of 15,000
files this left a fifth of the catalog waiting on the owner, and most of
those waits were not choices at all:

- Season folders that name the show, such as `Survivor - Season 44`, became
  the series folder, so one show split into one search and one review step
  per season.
- A series whose TMDB season counts fewer episodes than TVDB, which the
  owner's files follow, was offered back as its own lone candidate; choosing
  it failed with the same episode check, a dead end.
- A folder year that TMDB assigns to a miniseries or a different entry, as
  `Battlestar Galactica (2003)`, kept the right series out of the results.
- Same-titled series the folder's own seasons could tell apart, as the only
  `The Office` with a season 9, were left for the owner.

The owner could not search for a title the automatic query never offered,
and could not correct a year.

## Decision

- **The series folder is the outermost naming folder below the media root.**
  It names the series and gives its year and country tag for every episode
  beneath it; inner folders only contribute a season or disc. A filename that
  agrees with the folder, naming it or a longer name containing it, defers
  to the folder's name and year; a filename naming something else is a loose
  file and keeps its own.
- **A series folder's own seasons break same-title ties.** Among same-titled
  results agreeing with any year, the one series listing every hinted season
  is matched, or, when several do, the one counting every hinted episode.
  Several that still tie stay ambiguous. When nothing agreeing holds the
  folder and the search was year-hinted, it is run once more without the
  year, and the one same-titled series holding the folder is matched: the
  folder's seasons are stronger evidence than TMDB's date for the show.
- **A settled series matches every file under its folder.** An episode TMDB
  lists takes TMDB's episode facts. One TMDB does not list is matched to the
  series with the file's own numbers and no episode title, flagged as
  unlisted, never offered back as a choice. A season folder numbered past its
  TMDB count throughout counts through the series from season 1; a single
  file past a season's end does not.
- **A lone dated result matches a movie or series.** A search constrained by
  a year hint that finds exactly one result of that year is a match even when
  TMDB spells the title differently.
- **The owner may choose any TMDB title.** The choice dialog searches TMDB in
  the owner's own words, and a chosen title needs no earlier offer; TMDB's
  details of it are the only check. A correction on an item that needs a
  choice settles it. The release year is correctable.

## Consequences

- A show is one search and one review step, whatever its season folders are
  called, and a choice resolves all of it.
- Review matches holds only real choices: same-titled series the folder
  cannot tell apart, and titles TMDB spells or dates differently with no
  year to go on. Everything else is matched, with unlisted episodes marked.
- A wrong folder name now misleads a whole show rather than one season; the
  owner fixes it once, with a search or a correction, rather than once per
  season.
- Checking a folder against several same-titled results reads each
  candidate's details, at most ten, so an ambiguous title costs a few more
  calls than before, once per series folder.
- The spec's acceptance criteria and the glossary carry these rules; no
  other ADR changes.
