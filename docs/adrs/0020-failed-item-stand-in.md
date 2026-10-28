# 0020 A Failed Item Airs A Stand-In Instead Of Ending The Broadcast

## Status

Accepted on 2026-10-28. Amends
[ADR 0016](0016-prepared-ffmpeg-process.md), whose prepared process that
failed before its commit failed the session at that commit, and
[ADR 0008](0008-shared-active-channel-stream-workers.md), under which any
FFmpeg failure ended the worker and every viewer's stream.

## Context

A signal session serves one channel from successive FFmpeg processes, one
per playout item. Until now any of them failing ended the session: the
first process before readiness failed the tune, a prepared one failed its
commit at the boundary, and a committed one failing mid-program failed the
session at once. The worker then failed, the manager closed every
subscriber, and nothing restarted the channel; Plex showed an error until a
viewer tuned again, which failed again while the same item aired.

The commonest cause is a media file that went away after its catalog scan:
deleted, renamed, or on a mount that dropped. FFmpeg exits within a second
saying so. Corrupt media that FFmpeg cannot decode past some point fails the
same way mid-program.

## Decision

- **A failed item airs a stand-in.** When an item's FFmpeg process fails, or
  stays silent past its readiness timeout, the session starts a stand-in in
  its place: filler's card reading **Programming offline** over silence,
  so the splice keeps one stream layout. This covers the
  first process, a prepared one at its commit, and a committed one mid-item.
  The session's completion does not settle, so the worker, its subscribers,
  and its transition loop carry on.
- **An airing item that falls silent has failed too.** Once an airing
  process has produced usable output, five seconds without another chunk
  bring in its stand-in. That catches FFmpeg hung on a stalled read, and
  media shorter than its probe said, whose FFmpeg finishes cleanly before
  the boundary, both of which once left the output idle until then. A
  healthy process writes several chunks a second, and five seconds is
  shorter than the roughly ten seconds a viewer holds from the join backlog
  (ADR 0018), so the card arrives before the picture freezes. The watch
  moves with every commit, so a process that ends at its boundary is never
  replaced. A stand-in started while airing gets the readiness timeout, so
  one that never produces output, or later falls silent, fails the session.
- **A stalled item that recovers returns.** A silent process that is still
  running is set aside behind its stand-in rather than stopped, and its
  output is dropped until a clean entry point: a PAT, then a video
  keyframe. There the stand-in stops and the item cuts back in. FFmpeg
  paces itself afresh after a pause rather than bursting through what it
  missed, so the item resumes where it froze and runs late by the stall;
  the next commit still lands on time and cuts its last seconds. An item
  that never writes again is stopped at that commit, and one whose process
  has exited, as with short media, cannot return.
- **The stand-in lasts until the worker's next commit**, or until its stalled
  item returns. It is started for
  the failed item's whole airtime, an upper bound the next commit truncates,
  as it truncates every item. The worker's boundaries are unchanged: the
  next playout item airs at its scheduled start.
- **The session never decides what airs instead.** A stand-in is packaging
  continuity, like a black tail, not programming: it never retries, skips
  ahead, or picks another item. Its wording is one fixed string the owner
  chose; unlike filler's (ADR 0014) it names no time, because the session
  cannot know when programming resumes in the programming timezone.
- **One stand-in per item, and none for itself.** A stand-in that fails, or
  cannot start, fails the session as any process did before. A
  preparation that cannot start at all still rejects `prepare()`, and held
  output past its limit still fails the session.
- **A prepared program's media is checked before FFmpeg starts.** When the
  file is absent or unreadable, the preparation starts the stand-in
  instead and holds it like any prepared process, so the boundary into it
  is seamless. The check is asynchronous, so a stalled network mount never
  blocks the event loop, and one unanswered within 2 seconds lets FFmpeg
  start and find out itself. The first process of a session is not
  checked: the viewer's tune waits on it, and FFmpeg reports a missing file
  within a second, after which its stand-in airs.

## Consequences

- One bad or missing file no longer ends a channel's broadcast signal;
  viewers see **Programming offline** and hear silence until the next item.
- A tune during a failed item succeeds onto the stand-in instead of failing.
- Logs report `signal_item_replaced_by_stand_in` as a warning with the
  item's identity and the failure's code and reason, after FFmpeg's own
  error line, and `signal_media_missing` when the check found the file gone.
- A worker still fails on transition failures, a failed stand-in, and
  cleanup failures; those keep ADR 0008's behavior of ending subscribers.
- A hung or short item costs viewers up to five seconds of frozen picture
  before the card, logged as `signal_item_replaced_by_stand_in` with reason
  `output_stalled`. A hang that clears brings the item back, logged as
  `signal_item_resumed`, minus its last seconds at the boundary.
- `npm run test:ffmpeg` covers a missing file mid-schedule and at tune-in;
  an FFmpeg process killed with SIGKILL mid-program, while held before its
  boundary, and just after its commit; one frozen with SIGSTOP that never
  resumes and one that does; and a file shorter than its airtime.
