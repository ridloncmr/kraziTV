# Catalog Removal

Status: Implemented

This spec lets a user remove a media root, with every media item under it, or
remove individual media items from the catalog. [0002-media-catalog](0002-media-catalog.md)
only ever adds roots and marks vanished files `missing`, and its implementation
plan deferred root deletion. This spec fills that gap. By default it leaves
what a channel is airing alone; the user can choose to interrupt it instead.

This spec uses **catalog removal** and **purge** as `GLOSSARY.md` defines
them.

## Problem

Nothing that enters the catalog can leave it. A root added by mistake, a drive
that is gone for good, or `missing` and `probe_failed` items that will never
come back all stay in the Media Library and the catalog picker forever.
Disabling a root only stops it from being scanned; its items stay listed and
stay in collections.

Deletion is more than a new route, because the schema and the playout code
assume catalog rows are permanent:

- `media_items.media_root_id`, `media_collection_items.media_item_id`,
  `programming_blocks.media_item_id`, and `schedule_entries.media_item_id` are
  foreign keys without cascade, so a plain delete fails while anything
  references the row.
- Schedule entries are never pruned, so every item a channel has ever aired is
  referenced by that channel's schedule history.
- The playout queries inner-join schedule entries to media items because
  "production never deletes media items"
  ([playout-repository.ts](../../../../../apps/server/src/playout/playout-repository.ts)).
- [ADR 0003](../../../../adrs/0003-materialized-schedule-entries.md) says
  configuration changes must not silently change what is currently airing,
  and that regeneration begins at the end of the current program.

## Goals

- Remove a media root and all of its media items in one action.
- Remove one or more selected media items in one action.
- Show what a removal will do before the user confirms it: how many items go,
  what is airing them, and which channels are left with nothing to play.
- Take removed media out of the catalog, its collections, and every channel's
  future schedule immediately.
- By default, let an entry that is airing removed media finish as scheduled,
  then purge the removed rows.
- Let the user choose instead to stop what is airing and rebuild those
  channels' schedules from now.
- Never interrupt a broadcast signal unless the user chose to.

## Non-goals

- Deleting files from disk. Removal only touches the catalog.
- Excluding paths from future scans. A removed item whose file still exists
  under an enabled root comes back on that root's next scan.
- Undo or a recycle bin.
- Removing a programming block's single media item automatically. The user
  changes or deletes the block first, as collection delete already requires.
- Keeping guide history for removed media. Ended schedule entries that point
  at a removed item are deleted with it.
- Switching a running broadcast signal to new programming without
  disconnecting viewers. Interrupting stops the channel stream worker; see
  [Interrupting what is airing](#interrupting-what-is-airing).
- Offering the interrupt option anywhere other than catalog removal, such as
  collection edits or manual regeneration. The schedule capability is built so
  a later spec can expose it there.
- Changing a root's path. Paths stay immutable; remove the root and add a new
  one.

## User-Facing Behavior

### Starting a removal

The Media Library labels catalog removal **Delete**, as My Channels labels
channel deletion. The API, code, and docs keep the domain term **catalog
removal**.

- Each row in the Media Library's media roots table gains a **Delete…**
  action beside **Disable** and **Scan**.
- The cataloged media table gains row and range selection, using the controls
  collections already use (`row-click.ts`, `use-range-toggle.ts`). On the
  pager's line, right-aligned, a **Delete…** button is enabled while at least
  one row is selected, and **Clear selection** releases every selected row.

Either opens a **Delete media root** or **Delete media** window dialog, which
first asks the server for a removal preview and shows `Checking…` until it
answers.

### Confirmation dialog

The dialog shows, from the preview:

1. What goes: the root's path and its item count, or the selected item count.
2. Fixed notes: files on disk are not touched, and collections lose these
   items. For item removal: items whose files still exist return on the next
   scan of their root.
3. **Now airing**, only when removed media is on air. It lists each channel,
   for example `69 Reruns: Pilot, until 9:30 PM`, and offers a choice:

   | Choice                                   | Effect                                                                                                                                    |
   | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
   | **Let it finish** (selected by default)  | The program plays to its scheduled end. The channel's schedule changes after it.                                                          |
   | **Stop it now and rebuild the schedule** | The channel's schedule is rebuilt from now. Anyone watching these channels is disconnected and must tune in again to see the new program. |

4. **Channels left with nothing to play**, only when the removal leaves an
   enabled channel without schedulable media. It names each channel and says
   it goes off air after its current program, or right away when **Stop it
   now** is selected. The confirm button then reads **Delete anyway**.

**Delete** (or **Delete anyway**) sends the removal with the chosen airing
option. **Cancel** closes the dialog and changes nothing.

A refusal in the preview shows its message in place of the sections above,
and only **Close** is offered:

| Refusal                                    | Message                                                                            |
| ------------------------------------------ | ---------------------------------------------------------------------------------- |
| A scan of the root is running              | `This media root is being scanned. Cancel the scan or wait for it to finish.`      |
| A programming block plays one of its items | `Channel 69 plays an item from this media root directly. Change that block first.` |
| An item no longer exists                   | `Some of the selected media is no longer in the catalog. Refresh and try again.`   |

The block message lists every channel number involved.

### After confirming

- On success the dialog closes, the removed media leaves both tables, item
  selection is cleared, and the request feedback reports the result, for
  example `Deleted /media/tv and 1,204 media items.`
- With **Let it finish** and media still airing, the feedback adds
  `Channel 69 finishes its current program first.`
- With **Stop it now**, the feedback adds `Channel 69 restarted on its new
schedule.` If stopping a channel failed, it says
  `Channel 69 could not be stopped; it switches at the end of its current
program.`
- If the server reports that the removal now has a different impact than the
  preview showed (see the API), the dialog stays open, shows the new preview,
  and asks for confirmation again.
- Item removal is all or nothing: one refused item refuses the whole request.

## Technical Behavior

### Removal impact

One read computes a removal's impact from a target (a root, or a list of item
IDs). The preview route runs it in a deferred read transaction, and the
removal runs the same function inside its immediate transaction, so the two
never disagree about the rules.

The impact holds:

- the refusal, if any, in the order the API tables list;
- the item count;
- each channel whose airing entry points at a removed item, with that
  entry's title and `endsAt`;
- each enabled channel left unschedulable: its programming block draws from an
  affected collection that has schedulable members now and would have none
  after the removal;
- the affected channels (below).

### Removal

Removal is one schedule input change through
`ScheduleService.applyInputChange` with a new reason, `media_removed`. It runs
in one immediate transaction at one effective time and does the following in
order:

1. Compute the impact and return its refusal without writing anything. If the
   request did not set `allowUnschedulable` and the impact lists channels left
   unschedulable, return that refusal too.
2. Set `removed_at` to the effective time on every removed item, and on the
   root for a root removal.
3. Delete the removed items' collection memberships and rewrite each affected
   collection's positions as contiguous and zero-based, in their previous
   order.
4. Name the affected channels: every channel whose programming block draws
   from an affected collection, plus every channel with a schedule entry that
   ends after the effective time and points at a removed item.
5. Regenerate each affected channel:
   - With `airing: "finish"`, as any input change does: entries from the
     regeneration boundary on are deleted, playback progress is restored, and
     the airing entry stays.
   - With `airing: "interrupt"`, a channel whose airing entry points at a
     removed item is interrupted (below). Every other affected channel
     regenerates as with `finish`.

   A disabled channel loses its future entries and gets no new ones, as today.

6. Purge whatever is purgeable (below).

After the commit, the server stops the channel stream worker of every
interrupted channel (below).

Steps 2 and 3 use set-based statements keyed by root or by a JSON list of item
IDs, never one statement per item, so removing a root with thousands of items
stays a handful of statements.

Removing items from a collection changes membership positions exactly as a
membership replacement does today. Chronological progress keeps its position
number, so the open question in the
[programming feature](../../002-programming/README.md) about resuming after
the last aired item applies here too.

### Interrupting what is airing

Interrupting a channel is a new `ScheduleService` capability, used here only
for catalog removal:

1. In the removal transaction, delete the channel's airing entry along with
   every later entry, and restore playback progress from all of them, the same
   way regeneration restores progress from the entries it deletes.
2. Generate new entries starting at the effective time, not at the deleted
   entry's end. The interval from the deleted entry's start to the effective
   time is left empty, in the past.
3. Advance the schedule revision once, as any regeneration does.
4. After the commit, stop the channel's stream worker through the same runtime
   stop that channel disable uses (`ChannelStreamManager.stopChannel`, with its
   deadline), with a new stop reason, `interrupted`. The stop takes the
   channel's lifecycle lock, so it cannot interleave with a disable, delete, or
   re-enable of the same channel.
5. Subscribers are disconnected. The next tune starts a new worker, which
   reads channel state from the new schedule and joins the new program at its
   offset.

A channel with no running worker is interrupted in the schedule only; there
is nothing to stop.

A failed or timed-out stop does not roll anything back. It is logged and
reported in the removal result. What the channel does next follows
[ADR 0008](../../../../adrs/0008-shared-active-channel-stream-workers.md):

| Stop outcome        | What follows                                                                                                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Failed              | The manager already closed the channel's subscribers and keeps the worker's cleanup; the next tune retries that cleanup before starting a worker on the new schedule.                                                    |
| Missed its deadline | The worker may still be running. It keeps playing the removed item's file (files are never deleted) until the deleted entry's original end, then gets the existing `stale_entry` result and recovers by fresh selection. |

The stop must reuse the existing stop-with-deadline logic in
`channels/routes/channel-runtime-stop.ts`, moved where both callers reach it
if needed, never copied. Unlike disable, removal does not answer a failed stop
with `channel_runtime_cleanup_failed`, because nothing needs to be retried.

### Purge

A removed item is purgeable when no schedule entry that points at it ends
after the purge time. Purging an item deletes every schedule entry that points
at it (all of them have ended) and then the item row. A removed root is purged
once it has no item rows left.

Each purge pass commits under write authority and advances the schedule
revision of every channel whose entries it deleted. Those entries have ended,
so no guide window or playout read that starts at or after now changes.

After an interrupt, nothing holds the removed items, so the removal's own
purge removes everything. Only **Let it finish** leaves rows waiting.

Purge runs:

- at the end of every removal transaction;
- after every completed scan commit;
- at startup, before `ensureAllEnabled`;
- inside `POST /media-roots` when the new path matches a removed root (below).

Rows waiting for purge are invisible to every user-facing read, so purging
them late changes nothing anyone can see. There is no purge timer; see
[Decisions](#decisions).

### Catalog reads and writes

- `GET /media-roots`, `GET /media-items`, `POST /media-items/search`,
  `POST /media-items/matches`, the collection catalog picker, and collection
  member reads ignore removed rows. `GET /media-items/:id` and every route
  addressing a removed root return the existing `404`.
- `POST /media-roots` for a path whose identity matches a removed root that is
  not yet purged runs a purge first, then creates the root. If an airing entry
  still holds one of the old root's items, it returns `409`
  `media_root_removal_pending` with `airingUntil`. The unique `path_key`
  constraint stays as it is.
- A scan that rediscovers a removed item's file treats it as newly discovered:
  a removed row that is not yet purged has its `removed_at` cleared and is
  updated like any rescanned item, and a purged one is inserted with a new ID.
  Either way it has no collection memberships.
- The scan writer treats a root removed before its commit like a deleted root:
  the job fails with `media_root_not_found`, as
  [0009](0009-background-catalog-scans.md) already defines.
- Playout queries keep their inner join. A row is purged only after every
  entry pointing at it has ended or been deleted, so the join still holds for
  every entry a worker can read as current or following. A worker whose cursor
  entry was purged or interrupted gets the existing `stale_entry` result.

### API

```text
POST /catalog-removals/preview   report what a removal would do; writes nothing
POST /catalog-removals           remove a media root or media items
```

Both take the same body. `preview` ignores `airing` and `allowUnschedulable`.

```ts
interface CatalogRemovalRequest {
  /** One media root with all its items, or one or more unique item IDs. */
  target: { mediaRootId: string } | { mediaItemIds: string[] };
  /** What happens to an entry airing removed media. Defaults to "finish". */
  airing?: "finish" | "interrupt";
  /** Remove even when enabled channels are left with nothing to schedule. */
  allowUnschedulable?: boolean;
}
```

`preview` returns `200` with the impact:

```ts
interface CatalogRemovalImpact {
  itemCount: number;
  airing: {
    channelId: string;
    channelNumber: string;
    mediaItemId: string;
    title: string;
    endsAt: string;
  }[];
  channelsLeftUnschedulable: { channelId: string; channelNumber: string }[];
  /** Channels whose schedules the removal regenerates, in ID order. */
  affectedChannelIds: string[];
}
```

The removal returns `200` with its result:

```ts
interface CatalogRemoval {
  removedItemCount: number;
  /** Channels still airing removed media under "finish", with end times. */
  finishing: { channelId: string; endsAt: string }[];
  /** Channels interrupted under "interrupt", in ID order. */
  interruptedChannelIds: string[];
  /** Interrupted channels whose stream worker did not stop in time. */
  stopFailedChannelIds: string[];
  /** Channels whose schedules regenerated, in ID order. */
  affectedChannelIds: string[];
}
```

Refusals, in check order, for both routes:

| Condition                                                                  | Response                                                       |
| -------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Body invalid, empty item list, or duplicate IDs                            | `400` `invalid_request`                                        |
| Root not found or already removed                                          | `404` `media_root_not_found`                                   |
| Any item ID unknown or already removed                                     | The existing unknown-media-items response with those IDs       |
| The root, or any item's root, is being scanned                             | `409` `scan_in_progress`                                       |
| A programming block's single item is removed                               | `409` `media_item_in_use` with `channelIds` and `mediaItemIds` |
| Removal only: channels left unschedulable and `allowUnschedulable` not set | `409` `channels_left_unschedulable` with the current impact    |

The scan check reads the scanner's in-memory registry; the scan writer's own
commit check covers a scan admitted afterwards. The web client answers
`channels_left_unschedulable` by showing the returned impact and asking again,
which is how a change since the preview reaches the user.

A removal that cannot take write authority fails with the existing `503`
`schedule_busy`, like any schedule input change.

## Data Model Impact

One migration adds a nullable integer `removed_at` to `media_roots` and to
`media_items`, with the same safe-integer checks as the other timestamps, plus
an index on `media_items.removed_at` for purge.

No foreign key changes. Purge deletes entries, then items, then roots, so the
existing constraints stay the final guard against deleting anything still in
use. `schedule_entries.media_item_id` stays non-null.

## Architecture Boundaries

### ADR 0003 amendment

Interrupting conflicts with ADR 0003's original rule that regeneration begins
at the end of the current program. That rule exists so configuration changes
never _silently_ change what is airing; an interruption the user explicitly
chose is not silent. ADR 0003 was amended on 2026-10-07 to allow it, and the
**Regeneration** entry in `GLOSSARY.md` changed with it.

### Placement

- Removal gets its own server domain, `apps/server/src/catalog-removal/`,
  holding its routes, the impact read, the removal change, and purge. It
  reaches into `media-roots/`, `media-items/`, and `media-collections/` only
  through their existing exports or new narrow ones.
- Removal reuses `applyInputChange`, regeneration, and progress restore. The
  interrupt is a `ScheduleService` capability, because only the schedule
  service writes schedule entries. Removal never writes schedule entries
  itself, apart from purge deleting ended entries.
- Stopping an interrupted channel's worker is the server's job, through the
  existing channel runtime. The schedule service never touches workers, and
  `packages/signal` needs nothing new beyond the `interrupted` stop reason.
- kraziBrain does not change. Removed items leave collections and future
  entries before generation runs, and blocks that play a single removed item
  are refused, so generation never meets a removed item.
- `MediaItemRepository` stops being the scans' read-only view. Its comment
  that scans are the only writer changes in the same change.
- The web client's dialogs, airing choice, and selection are transient desktop
  shell state. The server's response decides every outcome.

### kraziTV check

| Area              | Affected? | Notes                                                                                                                     |
| ----------------- | --------- | ------------------------------------------------------------------------------------------------------------------------- |
| Schedule          | Yes       | Removal regenerates affected channels; interrupt deletes the airing entry; purge deletes ended entries                    |
| Playout timeline  | Yes       | Future items change through regeneration; interrupt replaces the current item                                             |
| Channel state     | Yes       | Unchanged with "finish"; with "interrupt" the current program and offset change at the effective time                     |
| kraziBrain        | No        | Generation never sees a removed item                                                                                      |
| SignalPackager    | Indirect  | Interrupt stops a channel stream worker through the existing stop; a running FFmpeg process reads the file, never the row |
| Provider adapters | Indirect  | Guide output reflects the new schedule; past programs for purged items disappear; interrupted viewers retune              |

## Decisions

Resolved on 2026-10-07:

- **No purge timer.** Purge runs at removal, after scan commits, at startup,
  and when a removed root's path is added again. A timer set for the end of
  the last airing program would change nothing a user can see, because rows
  waiting for purge are hidden from every read and re-adding the path purges
  first. It would add a timer to arm, reset, clear, and test, and one more
  writer that needs write authority. Add one only if something later needs
  waiting rows gone on a schedule.
- **Interrupting disconnects viewers.** Stopping the channel stream worker is
  the only way to switch programs before a boundary today. A switch that keeps
  viewers connected is separate stream worker and FFmpeg work for a later
  spec.
- **Channels left unschedulable warn but do not block.** The preview lists
  them and the user can proceed with **Delete anyway**.

## Acceptance Criteria

Server:

- `POST /catalog-removals/preview` returns the item count, airing channels,
  channels left unschedulable, and affected channels, and writes nothing.
- A removal of a root removes the root and all its items from every catalog
  read in one commit.
- Removed items leave every collection, and the remaining members' positions
  are contiguous and zero-based in their previous order.
- Every affected channel regenerates once, logged with reason
  `media_removed`. No future entry on any channel, enabled or disabled, points
  at a removed item after the commit.
- With `airing: "finish"` (and by default), the airing entry is unchanged,
  stays readable through the playout queries until it ends, and its worker
  plays it to its scheduled end.
- With `airing: "interrupt"`, the airing entry holding removed media is
  deleted, new entries start at the effective time, progress is restored from
  the deleted entries, and the channel's running worker is stopped with
  reason `interrupted` after the commit. A new tune joins the new program at
  its offset.
- A failed or timed-out interrupt stop is logged, listed in
  `stopFailedChannelIds`, and rolls nothing back. A worker the stop never
  reached moves to the new schedule at the old entry's end; one whose stop
  failed is cleaned up on the next tune, as ADR 0008 defines.
- Without `allowUnschedulable`, a removal that leaves an enabled channel
  without schedulable media writes nothing and returns `409`
  `channels_left_unschedulable` with the impact; with it, the removal
  proceeds.
- A removal with an unknown, already removed, scanning, or block-sourced item
  writes nothing and returns its refusal; checks run in table order.
- Purge deletes a removed item's ended entries and row once no entry holding
  it ends after the purge time, and a removed root once it has no items. It
  runs at removal, after a scan commit, at startup, and on re-add of a removed
  root's path.
- `POST /media-roots` for a removed root's path succeeds once nothing airs its
  items, and returns `409` `media_root_removal_pending` with `airingUntil`
  while something does.
- A scan that rediscovers a removed item's file returns it to the catalog with
  no collection memberships.
- A scan job of a root removed before the commit ends in `failed` with
  `media_root_not_found`.
- Removing every item of a 10,000-item root runs a fixed number of catalog
  statements, independent of item count, apart from per-channel regeneration.

Web:

- **Delete…** on a root, or **Delete…** with catalog rows selected, opens
  the dialog and shows the preview.
- The **Now airing** section appears only when removed media is airing, with
  **Let it finish** selected by default.
- The unschedulable warning appears only when the preview lists channels, and
  the button then reads **Delete anyway**.
- A preview refusal shows its message with only **Close**.
- A `channels_left_unschedulable` response keeps the dialog open with the new
  impact.
- Success closes the dialog, refreshes both tables, clears item selection, and
  reports finishing, interrupted, and failed-stop channels.
