# Content Metadata Enrichment

Status: Accepted

## Problem

The catalog discovers local files and probes technical facts, but filename-derived
titles cannot reliably identify series, episode order, franchises, or themes.
Useful programming should not require users to classify thousands of files.

## Goals

- Enrich catalog media with normalized content metadata after technical probing.
- Identify media whose filename lacks the title by reading its folder hierarchy.
- Support uncertain matches and durable user corrections.
- Keep local scanning and broadcasting useful without a metadata service.
- Provide facts that collections and playback ordering can consume independently.

## Non-goals

- Collection creation, channel rules, or schedule generation.
- Implementing Plex, Jellyfin, and external metadata integrations simultaneously.
- Dynamic provider registration, a plugin framework, or a universal matching engine.
- Cross-root file deduplication, media acquisition, or comprehensive artwork hosting.
- A project-supplied TMDB key, and providers other than TMDB (TVDB, `.nfo`
  sidecars, or Plex or Jellyfin as metadata sources). They remain later options.
- Using content metadata in guide output such as XMLTV episode titles or
  descriptions. This spec stores the facts; guide use is a separate decision.

## Dependencies And Spec Boundary

Depends on the existing catalog scan and normalized probe results. This capability
has its own matching, correction, and failure lifecycle; downstream programming
consumes accepted facts rather than performing lookups. The first provider is
TMDB (see [Provider](#provider)). TMDB's terms (last updated 2023-10-20) and
authentication docs were rechecked on 2026-10-08; recheck them before each
later provider ticket, because they can change without notice.

## Established Behavior And Proposed Policy

The scanner already composes discovery, probing, candidate validation, and atomic
persistence, with an explicit enrichment seam after probing. Media item identity
is its media root and normalized path; enrichment must not replace that identity.

The sections below propose enrichment policy. They do not claim these fields or
provider operations already exist, or supersede accepted architectural decisions.

## User-Facing Behavior

1. The user turns enrichment on by entering their own TMDB API key through a
   **Set up TMDB** task link in Account Settings, beside the name, picture, and
   password links. Without a key, enrichment stays off.
2. A user scans local media with enrichment disabled or a configured provider enabled.
3. Scan progress shows content enrichment as its own `enriching` phase after
   probing, and the completed summary counts matches and items needing a choice
   (see [Scan Progress, Retry, And Refresh](#scan-progress-retry-and-refresh)).
4. Media Library shows accepted metadata and unresolved or ambiguous matches.
5. The user can choose a candidate, reject a match, correct a field, or clear a
   correction to allow provider updates again.
6. The user can retry enrichment for existing catalog items without reprobe.
7. For a folder of ambiguous disc-track files, the user can map every track to an
   episode in one **Map tracks to episodes** dialog instead of correcting each file.
8. Without a key, the desktop reminds the owner that only generic probing
   happens: a TMDB icon in the system tray and, at most once per reminder
   period, a tray balloon offering **Set up TMDB** (see
   [TMDB Setup Reminder](#tmdb-setup-reminder)).

A provider outage reports enrichment failures without turning technically usable
media into `probe_failed`. Unmatched media remains eligible for ordinary
collections and scheduling. It shows a fallback title built from its path hints,
such as `Firefly – S01E05` for `Firefly/Season 1/s01e05.mp4`, instead of the bare
filename; with no usable hints it keeps the filename-derived title.

## Technical Behavior

### Provider

TMDB is the first and only provider in this spec. It covers movies and TV with
series, season, and episode structure, title-and-year search, artwork, and stable
IDs, and is free for non-commercial use.

- **The user's own key.** Each install uses a TMDB API key its user requests from
  their own TMDB account. kraziTV never ships a key, so no install runs under
  another person's identity and one revoked key affects only its owner.
- **Configured in Account Settings.** The **Set up TMDB** dialog has a key box,
  **Save**, **Remove**, and **Cancel**. The account-settings program hosts the
  dialog, but the key's route belongs to the metadata domain, not `auth/`.
- **Stored as a secret.** The server stores the key and never returns it. Reads
  report only whether a key is set; the dialog offers replace and remove.
- **API Read Access Token, sent as a Bearer header.** TMDB accepts either an
  `api_key` query parameter or the account's API Read Access Token in an
  `Authorization: Bearer` header, with identical access. Its docs make the token
  the default; kraziTV asks for the token, and the header keeps the secret out of
  request URLs and logs.
- **Validated on save.** Saving makes one test call, `GET /3/authentication`. A
  `401` means TMDB rejected the key: it is not stored and the dialog shows the
  error. An unreachable TMDB also stores nothing.
  A later save or removal supersedes an earlier validation still in flight; the
  earlier request returns a conflict and cannot restore or overwrite the key.
- **No key, no lookups.** Without a key the scan derives path hints and skips the
  lookup step entirely; nothing is reported as an enrichment error.
- **Attribution.** The Set up TMDB dialog, and Media Library wherever it shows
  TMDB facts, display an official TMDB logo and the notice the terms require:
  `This application uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB.`
  The logo is used unmodified, from TMDB's logos page, and stays less prominent
  than kraziTV's branding.
- **No AI use.** TMDB's terms forbid using its API with, or to train, an AI or
  machine-learning application. Matching stays rule-based, and TMDB data is
  never passed to a model.
- **Rate limits.** TMDB's soft ceiling is about 40 requests per second and may
  change. Every TMDB request goes through one shared in-memory queue that caps
  requests in flight and requests per second below that ceiling. Scans of every
  root, metadata-only retries, and background refresh all use it, so running
  more jobs never raises the request rate. A cancelled request leaves the queue
  without calling TMDB. HTTP `429` still backs off, as a fallback.
- **Six-month cache limit.** TMDB's terms forbid caching its data longer than six
  months. A background refresh keeps stored TMDB data inside that limit without
  user action or a catalog scan:
  - It runs on its own schedule, spreading work over time as items approach six
    months old, and never runs file discovery, ffprobe, or a new search.
  - It re-fetches by stored TMDB ID, one call per movie and one per TV season,
    so a large library costs a few hundred calls spread across months.
  - It replaces only provider facts. User corrections, rejections, and chosen
    matches are never touched; they are not TMDB data and never expire.
  - It never blocks or slows broadcasting, and commits through the same
    metadata-only path as a retry, revalidating item existence and corrections.
  - A failed refresh keeps the match and retries later. If data cannot be
    refreshed before six months, drop the expired provider facts and keep the
    match reference; the item shows its path-hint fallback title until a later
    refresh refills it.

### TMDB Setup Reminder

Without a key the catalog still scans, but titles come only from path hints.
The desktop shell says so where the owner will see it, without blocking any
program:

- **Tray icon.** While no key is set, the system tray shows a TMDB icon labeled
  `TMDB isn't set up`. It stays even after the owner turns the reminder off,
  so the setting is never lost. Clicking it opens the balloon.
- **Tray balloon.** At desktop start, the balloon opens by itself when no key
  is set, at least one media root exists, and the reminder is due. With no
  media root there is nothing to enrich, so it stays closed. It reads:
  `TMDB isn't set up` / `kraziTV can only read titles from file names. Set up
TMDB to look up series, episodes, and movies.` Its actions:

  | Action              | Effect                                                                    |
  | ------------------- | ------------------------------------------------------------------------- |
  | **Set up TMDB**     | Opens Account Settings on the Set up TMDB task; snoozes like Remind later |
  | **Remind me later** | Closes the balloon; it opens by itself again after 7 days                 |
  | **Don't remind me** | Closes the balloon; it never opens by itself again in this browser        |
  | Close (**✕**)       | Same as **Remind me later**                                               |

- **Reminder state is desktop shell state.** The browser keeps it in
  `localStorage`, so each browser reminds on its own. Unreadable or missing
  state counts as due. It never reaches the server or changes enrichment.
- **A saved key ends the reminder at once.** Saving a key removes the icon and
  closes the balloon; removing the key brings the icon back, and the balloon
  follows the stored reminder state.
- **Scan summary.** A completed scan without a key adds the line
  `TMDB isn't set up, so titles come from file names.` to its summary.

### Normalized Facts

Represent content type as movie, episode, or unknown. Unknown facts remain absent;
filename guesses are not accepted facts. Preserve date precision: a known year
does not imply January 1 of that year.

The first release stores the facts downstream specs consume, plus the cheap
display facts that arrive in the same TMDB response:

| Fact                      | Consumer                                         | Source                                                     |
| ------------------------- | ------------------------------------------------ | ---------------------------------------------------------- |
| Content type              | Every consumer                                   | TMDB or user correction                                    |
| Title (movie or episode)  | Media Library, display                           | TMDB or user correction                                    |
| Series identity and name  | Spec 0002 series collections, spec 0003 ordering | TMDB or user correction                                    |
| Season and episode number | Spec 0003 episode order                          | TMDB or user correction                                    |
| Release date or year      | Spec 0003 release order, remake distinction      | TMDB or user correction                                    |
| Franchise                 | Spec 0002 franchise collections                  | TMDB collection for movies; user correction for all others |
| Genres                    | Spec 0002 genre collections                      | TMDB or user correction                                    |
| Tags and themes           | Spec 0002 theme collections                      | User only; TMDB keywords are not imported                  |
| Description               | Media Library                                    | TMDB or user correction                                    |
| Poster reference          | Media Library, candidate choice                  | TMDB image path for a movie or series                      |

Artwork is one poster reference per movie or series. kraziTV stores only TMDB's
image path; the browser loads the image from TMDB, and kraziTV never downloads or
hosts image files. Episode stills, backdrops, and logos are out of scope.

Series and franchise identity must distinguish remakes and similarly named works.
Provider IDs are references attached to normalized identities, not scheduling IDs.
Multi-episode files must retain the information needed to explain their identity;
their initial ordering treatment is decided in spec 0003.

### Path Hints

Filenames often omit the title: `Firefly/Season 1/s01e05.mp4`, `Some Show/t_01.mkv`,
or `Alien (1979)/movie.mkv`. A persistence-free path-hint step reads the filename
and its parent folders up to the media root and returns path hints: series or
title, year, season, episode or episode range, disc and disc-track numbers, and
whether the file is an extra. It performs
no I/O beyond the already-discovered path and runs without a provider.

| Path                          | Path hints                                      | Hint strength |
| ----------------------------- | ----------------------------------------------- | ------------- |
| `Firefly/Season 1/s01e05.mp4` | series `Firefly` (grandparent), season 1, ep. 5 | Strong        |
| `Firefly (2002)/s01e05.mp4`   | series `Firefly`, year 2002, season 1, ep. 5    | Strong        |
| `Show/s01e05-e06.mkv`         | series `Show`, season 1, episodes 5–6           | Strong        |
| `Alien (1979)/movie.mkv`      | title `Alien`, year 1979                        | Strong        |
| `Some Show/t_01.mkv`          | series `Some Show`, disc track 1                | Weak          |
| `TV/Downloads/s01e05.mp4`     | season 1, ep. 5; no series                      | Weak          |

- Skip structural and generic folder names when looking for a series or title,
  using the built-in list below. Never treat a skipped folder, or the media root
  itself, as a series or title.
- Strip release tokens from folder and file names before extracting a title:
  bracketed text, resolutions (`480p`, `720p`, `1080p`, `2160p`), `4K`, `UHD`,
  `HDR`, sources (`BluRay`, `BDRip`, `BRRip`, `WEB-DL`, `HDTV`, `DVDRip`), and
  codecs (`x264`, `x265`, `HEVC`, `AC3`, `DTS`). `Firefly (2002) [1080p BluRay
x265]` yields series `Firefly`, year 2002.
- Take a title from the filename only when it carries more than episode
  numbering or disc-track tokens; otherwise use the nearest non-skipped folder.
- Keep a disc-track number distinct from an episode number. Rip track order
  often differs from broadcast order, so a track number never becomes an episode.
- A year in the folder or filename, such as `(2002)`, is a hint that helps
  distinguish remakes; it is not an accepted release date.
- Keep both numbers of an episode range so spec 0003 can order multi-episode files.

**Built-in folder list.** The list is fixed in code, not user-configurable: a
missed generic name yields an unmatched or ambiguous item the user resolves once
per folder, and new names join the list in code. Names match the whole folder
name, ignoring case, so `My Movies` is not skipped.

| Group          | Folder names                                                                                                                                                                                                                                                        | Effect                              |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Season         | `Season`, `Series`, `Staffel`, `Saison`, `Temporada`, `Stagione`, `Seizoen`, `Säsong`, `Sæson`, `Sezon`, `Kausi`, `Сезон`, `シーズン`, or `시즌` with a number; `S1`, `S01`                                                                                         | Skipped; season number hint         |
| Season zero    | `Specials`                                                                                                                                                                                                                                                          | Skipped; season 0 hint              |
| Extras         | `Trailers`, `Behind the Scenes`, `Deleted Scenes`, `Featurettes`, `Interviews`, `Scenes`, `Shorts`, `Clips`, `Sample`, `Samples`, `Extra`, `Extras`, `Other`                                                                                                        | Skipped; marks the file as an extra |
| Disc structure | `VIDEO_TS`, `AUDIO_TS`, `BDMV`, `STREAM`, `PLAYLIST`, `CERTIFICATE`                                                                                                                                                                                                 | Skipped                             |
| Disc numbering | `Disc`, `Disk`, `DVD`, or `CD` with a number                                                                                                                                                                                                                        | Skipped; disc number hint           |
| Quality split  | `4K`, `UHD`, `HD`, `SD`, `720p`, `1080p`, `2160p`, `Remux`                                                                                                                                                                                                          | Skipped                             |
| Catch-all      | `TV`, `TV Shows`, `Shows`, `Series`, `Movies`, `Films`, `Video`, `Videos`, `Media`, `Library`, `Downloads`, `Anime`, `Cartoons`, `Kids`, `Documentaries`, `Recorded TV`, `Recordings`, `DVR`, `Unsorted`, `Incoming`, `Completed`, `New Folder`, `Plex`, `Jellyfin` | Skipped                             |

A file under an extras folder, such as `Firefly/Featurettes/making-of.mkv`, is
bonus material, not an episode or movie: it is never automatically matched and
its content type stays unknown, but it stays in the catalog. A bare number is not
a season folder, because titles such as `24` and `1923` collide with it.

Path hints are evidence, not content metadata. They build the provider query and
are recorded with the match evidence; they become accepted facts only when a
provider match or a user correction confirms them. The fallback display title
uses them without accepting them.

### Matching And Corrections

Use explainable match states: unmatched, ambiguous, matched, and rejected, with a
separate enrichment error when lookup fails. Record provider, external identity,
lookup time, and matching evidence. Keep provider-specific confidence separately
when supplied; do not compare unrelated providers' scores as a universal ranking.

Weak path hints never yield an automatic match. A candidate found from weak
hints, such as a folder name plus a disc-track number, is recorded as ambiguous
for the user to resolve, even when the provider returns a single candidate.

Accept a match automatically only when exactly one sensible answer exists; a
silently wrong match costs more than one user choice. Compare titles after
normalization: ignore case, punctuation, diacritics, and a leading "The", and
treat `&` and `and` as equal.

| Case                                       | Automatically matched when                                                                                                      | Otherwise                                                     |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Episode with strong hints (series, SxxEyy) | Exactly one series has a matching title, its year matches any year hint, and the hinted season and episode exist in that series | Ambiguous; `Doctor Who/s01e01.mkv` matches 1963 and 2005      |
| Movie (title, optional year)               | Exactly one result has a matching title and its year matches any year hint                                                      | Ambiguous; `The Thing/movie.mkv` matches 1951, 1982, and 2011 |
| Weak path hints                            | Never                                                                                                                           | Ambiguous                                                     |
| No provider results                        | —                                                                                                                               | Unmatched                                                     |

Popularity never breaks a tie. Runtime is not acceptance evidence, because TMDB
episode runtimes are often missing and extended cuts differ; the candidate
choice shows each candidate's runtime beside the probed duration to help the
user decide.

**Shared series per folder.** The series folder is the folder an episode's series
hint came from, such as `Firefly/` for `Firefly/Season 2/s02e01.mkv`, so it spans
every season folder beneath it. Once one episode under a series folder has an
accepted series, automatically or by user choice, the other episode files under
that series folder use that series instead of searching again. Choosing a series for one ambiguous episode resolves
its siblings, keeps one show from splitting across series, and saves lookups. A
rejection or correction on one file applies only to that file.

Effective metadata uses user corrections ahead of provider facts. A rejected
association stays rejected on repeat scans unless the user explicitly retries
that association or clears the rejection. A transient failure preserves earlier
accepted facts. Rescanning must not overwrite corrected titles with filenames.

**Changed file at the same path.** Path hints come from the path, so re-matching
a replaced file at an unchanged path would find the same answer; a change never
resets a match automatically. Record the probed duration when a match is
accepted. When a later scan probes a duration more than 2 seconds away from it,
keep the match and corrections unchanged and flag the item in Media Library as
`File changed since it was matched`, with **Keep match**, which records the new
duration and clears the flag, and **Choose again**, which opens the candidate
choice. Size and modification time are not signals: copies and backups change
them, and a re-encode of the same episode needs no review. Playability still
follows the new probe result. A renamed or moved file is a new path and so a new
media item, matched from scratch; carrying corrections across paths is out of
scope.

### Disc-Track Mapping

Disc rips such as MakeMKV output name files by track (`t_00.mkv`, `t_01.mkv`),
restart track numbers on each disc, usually but not always follow episode order,
and often include a play-all track and short extras. When a TMDB key is set,
Media Library offers **Map tracks to episodes**, a window dialog, on any folder of
ambiguous disc-track files. The dialog needs TMDB for the series choice and
episode runtimes; without a key the user corrects each file's fields instead.

1. The user picks the series, or confirms the folder's shared series, and the season.
2. kraziTV proposes a mapping in disc-then-track order, continuing episode numbers
   across discs: Disc 1 `t_00` → E1, `t_01` → E2, and so on.
3. Each row shows the track's probed duration beside TMDB's runtime for the
   proposed episode, so mismatches are visible.
4. Rows that do not fit start as **Skip**: a play-all track whose duration is close
   to the sum of the folder's other tracks, and a track shorter than a third of the
   folder's median track duration.
5. The user changes any row to another episode or **Skip**, then chooses **Apply**.
   Nothing changes before Apply, and **Cancel** discards the proposal.
6. Apply commits each mapped row as a user correction of series, season, and
   episode, so the mapping survives rescans and refreshes. Skipped tracks become
   extras: they stay in the catalog and are never matched as episodes.

Runtime only shapes the proposal; it never accepts a match by itself, because
the user confirms every row. Apply commits through the metadata-only path and
revalidates each item, so a track removed while the dialog was open is skipped.

### Scan Progress, Retry, And Refresh

**Which items a scan looks up.** A rescan never searches again for an item whose
match state is settled, so a rescan of a matched library makes almost no calls.
A scan searches each movie title and year once, even when several files share
it.

| Item state                                 | Looked up on scan                                      |
| ------------------------------------------ | ------------------------------------------------------ |
| New, unmatched, or last lookup failed      | Yes                                                    |
| Matched, rejected, ambiguous, or corrected | No; state is kept, and ambiguous items keep candidates |
| Extra                                      | Never                                                  |

**The `enriching` phase.** A scan job's phases become
`discovering -> probing -> enriching -> committing -> completed`. Enriching starts
after every probe has settled, so lookups are grouped by series folder: one
search per series folder, not one per file. The phase is skipped when no TMDB key
is set or no item needs a lookup. A scan can be cancelled during enriching, and
cancellation leaves the catalog unchanged as it does during probing.

| Phase       | Status line                                                 | Progress bar                                     | Counts                |
| ----------- | ----------------------------------------------------------- | ------------------------------------------------ | --------------------- |
| `enriching` | `Looking up media on TMDB…`, then `Last looked up: <title>` | Determinate: settled lookups / items needing one | `86 of 240 looked up` |

The other phases keep their [spec 0009](../../001-mvp/specs/0009-background-catalog-scans.md)
status lines. The `Scan completed.` summary adds matched, ambiguous, unmatched,
and lookup-error counts; when any item is ambiguous it adds
`<n> need your choice. Review them in Media Library.`

**Metadata-only retry.** A retry runs as a scan job of the root with only
`enriching -> committing`, shown in the same progress dialog and subject to the
same one-job-per-root rule. Its scope is one item, one folder, or every item in
the root whose last lookup failed. A retry looks up the items in its scope
regardless of match state, except corrected fields and extras, which it never
changes.

**Background refresh visibility.** The six-month refresh has no dialog. An
item's details show `TMDB data refreshed <date>`; an item whose provider facts
expired before a refresh succeeded shows `TMDB data expired. It will refresh when
TMDB is reachable.` Refresh never runs on a root while a scan or retry job for
that root is active, so their commits never interleave.

### Processing And Commit

Path hints are derived first, so a scan without a provider still produces fallback
titles. Wire enrichment explicitly after every probe settles and before candidate validation; operations
return normalized values and never write SQLite themselves. External calls use
the shared TMDB queue (see Rate limits), timeouts, and cancellation outside database write authority.
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
match decisions, user corrections, and enrichment diagnostics/timestamps, including
when each item's provider facts were last fetched and the probed duration at
match time. Store the TMDB key as a
server-side secret outside the account row. Keep
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

None.

## Acceptance Criteria

- With enrichment disabled or unreachable, usable local media can still be scanned,
  manually collected, and broadcast.
- No route ever returns the TMDB key; a rejected key is never stored.
- Without a TMDB key, a scan makes no TMDB calls and records no enrichment errors.
- Without a TMDB key, the tray shows the TMDB icon; the balloon opens by itself
  only when a media root exists and the reminder is due, and **Remind me later**
  and **Don't remind me** hold for 7 days and for good in that browser.
- Provider-sourced facts are refreshed in the background or dropped before they
  are six months old, without a catalog scan; user corrections are kept.
- Lookups back off on HTTP `429` instead of failing the scan.
- A rescan looks up only new, unmatched, and failed-lookup items; matched,
  rejected, ambiguous, corrected, and extra items make no TMDB calls.
- A scan with a TMDB key reports an `enriching` phase between `probing` and
  `committing`; without a key, or with nothing to look up, it skips the phase.
- Cancelling during `enriching` leaves the catalog unchanged.
- The completed summary reports matched, ambiguous, unmatched, and lookup-error
  counts.
- A metadata-only retry runs as an `enriching -> committing` job scoped to an
  item, a folder, or a root's failed lookups, and never changes corrected fields.
- Background refresh never runs on a root while a scan or retry job for it is
  active, and each item shows when its TMDB data was last refreshed or that it
  expired.
- Ambiguous titles produce a visible choice rather than a silently accepted match.
- A title with several same-named results and no year hint, such as
  `Doctor Who` or `The Thing`, is ambiguous, never resolved by popularity.
- Choosing a series for one episode resolves every other episode under the same
  series folder, across its season folders, to the same series.
- A bare `Series` folder is skipped; `Series 1` is a season folder.
- Map tracks to episodes is offered only when a TMDB key is set.
- A file whose name lacks the title, such as `Firefly/Season 1/s01e05.mp4`, is
  queried and displayed using its folder hierarchy.
- A generic or season folder name, or the media root, is never treated as a
  series or title.
- Release tokens are stripped: `Firefly (2002) [1080p BluRay x265]` is queried
  as series `Firefly`, year 2002.
- A file under an extras folder is never automatically matched as an episode or
  movie.
- A file under `Specials` carries a season 0 hint.
- Map tracks to episodes proposes disc-then-track order, pre-skips play-all and
  very short tracks, changes nothing before Apply, and stores each applied row as
  a user correction that survives rescans; skipped tracks become extras.
- A disc-track file such as `Some Show/t_01.mkv` is never automatically matched
  to an episode, and its track number never becomes an episode number.
- A corrected series, episode, or title survives rescans and metadata retries.
- Tags and themes come only from the user; TMDB keywords are never imported.
- kraziTV stores a poster reference, never an image file.
- A rejected match is not silently reapplied by a later scan.
- A file whose probed duration moves more than 2 seconds from its match-time
  duration keeps its match and corrections and is flagged for review; a duration
  change alone never resets a match.
- Lookup errors preserve accepted metadata and remain distinct from probe failures.
- Cancelled enrichment leaves the previous catalog unchanged and settles active work.
- A delayed retry cannot restore a removed item or overwrite a newer correction.
- Provider payloads never enter schedule generation, and metadata-only retry does
  not require ffprobe or change published guide entries directly.
