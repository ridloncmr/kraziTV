# Plex Signal Compatibility Results

This record preserves the compatibility evidence gathered by the disposable
`apps/plex-spike` harness and the formal `apps/server` Plex adapter. The spike
was retired after the formal adapter passed Plex acceptance on 2026-10-05.

## Formal Adapter Acceptance

The formal adapter passed on 2026-10-05 with Plex Media Server
`1.43.4.10903-e5521bd8c` in a host-networked LinuxServer container. The server
used persisted `KRAZITV_DEVICE_ID=1234ABCD` and exposed Channel 69 from its
stable UUID-backed channel identity.

Plex automatically mapped the guide with a perfect match for Channel 69's UUID
XMLTV ID. The first viewer played successfully, and a second Plex client also
played the same broadcast signal. Plex opened exactly one upstream
`GET /channels/<uuid>/stream` request; kraziTV had exactly one live FFmpeg
process and one `ffmpeg_process_started` event. This confirmed that both Plex
clients shared one channel stream worker and FFmpeg pipeline.

The first guide-mapping attempt exposed an important deployment constraint.
Plex had retained the spike device identity `1234ABCD`, while the formal server
initially advertised its default `4B5A5456`. Plex requested channel mappings
for the retained identity and returned `404`, despite successfully downloading
the XMLTV document. Restarting the formal server with the persisted
`KRAZITV_DEVICE_ID=1234ABCD` restored identity continuity and allowed automatic
guide mapping. A replacement server must therefore preserve the device ID Plex
registered across setup attempts.

## Formal Adapter Direct Preflight

Before the Plex UI acceptance run, the production composition passed direct
preflight on 2026-10-05 with the same Plex server and FFmpeg/ffprobe
`6.1.1-3ubuntu5`. The formal server cataloged and probed all four files in
Survivorman Season 8 without failure, generated Channel 69's schedule, and
served the tuner and guide endpoints over its LAN address.

The Plex container fetched `discover.json`, `lineup.json`, and the 72-hour
XMLTV document. A direct eight-second stream capture returned
`200 video/MP2T`, contained 25,705 aligned 188-byte packets, and decoded as
H.264 video with AAC audio. Two overlapping direct subscribers received
decodable, packet-aligned captures while exactly one FFmpeg process was live
and only one `ffmpeg_process_started` event occurred for their shared worker.
The late capture produced transient missing-PPS warnings before its next
random-access point and then decoded successfully.

## Retained Spike FFmpeg Baseline

The real-FFmpeg smoke suite passed on 2026-09-29 with
`ffmpeg version 9.0.2-full_build-www.gyan.dev`. The generated fixture identities
were:

- VIDEO A: `6824346F4FB15F9FEC0040854C40DF6F315CB5CBCEC83FA8EF9C0BEDF5F152B4`
- VIDEO B: `91359A0740EE58A0E85C54ED7828AA02D9EEC17193CB58A0BC420C4C86662E04`

That run established the local executable baseline: the retained signal
session crossed the VIDEO A/B boundary with 188-byte packet alignment, the
expected transport PIDs, and a decodable capture. By itself, it did not
establish Plex client compatibility.

## Retained Spike Plex Result

The SIG-011 matrix passed on 2026-09-29 with:

- Ubuntu 24.04.4 LTS host;
- Plex Media Server 1.43.4.10903 in the host-networked
  `linuxserver/plex` container;
- FFmpeg 6.1.1-3ubuntu5;
- VIDEO A SHA-256
  `07aa537abc566ec89ec055b745478c1e81950221492469294875fa386330ba68`;
- VIDEO B SHA-256
  `166f16a5ff351cef6b4dfcaa29e6ccf2759500d26d317a6f4047ec25d5201cb3`.

| Measurement                | Result                                                                                                                                                                                                         |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Manual tuner setup         | Plex discovered the tuner and listed Channel 69                                                                                                                                                                |
| Corrected cold-start waits | 1,719 ms, 1,705 ms, 1,708 ms, 1,697 ms, and 1,730 ms                                                                                                                                                           |
| Initial tune drift         | Approximately 1.7 seconds behind schedule; below the 2,000 ms ceiling                                                                                                                                          |
| Pacing                     | `-re` remained approximately 1x through repeated 30-second items                                                                                                                                               |
| Boundary commit latency    | Within 9 ms of the scheduled boundary                                                                                                                                                                          |
| Boundary usable-output gap | 1,701-1,715 ms; Plex showed no playback interruption                                                                                                                                                           |
| Boundary strategy          | Sequential FFmpeg processes spliced on 188-byte packet boundaries                                                                                                                                              |
| Shared process count       | One kraziTV worker and FFmpeg process while two Plex clients played                                                                                                                                            |
| Plex late client           | Buffered still initially, then about one second behind Viewer A                                                                                                                                                |
| Direct late subscriber     | Attached in 5 ms and decoded a 165,064-byte, three-second capture                                                                                                                                              |
| Slow subscriber            | A 1 KiB/s client ran for 110 seconds without affecting Plex playback                                                                                                                                           |
| Idle shutdown              | Signal session stopped 5,261 ms after the final disconnect; no FFmpeg process remained                                                                                                                         |
| Active shutdown            | Stopping the harness settled the active worker and FFmpeg process                                                                                                                                              |
| Black-tail boundary        | Passed on 2026-10-03 with an approximately 10-second black and silent tail; after extended initial buffering, Plex continued into the next labeled video without further buffering, stopping, or disconnecting |

The first run exposed that replaying from the oldest retained PAT burst 4.3 MiB
to a late subscriber and produced missing-PPS decoder warnings. The retained
fix uses the newest valid PAT and a fixed one-second H.264 GOP (`-g 30`,
`-keyint_min 30`, `-sc_threshold 0`). The corrected direct late join delivered
165,064 bytes over three seconds and decoded successfully. Decoders can still
report transient missing-PPS warnings before the next random-access point; the
one-second GOP bounds that interval.

Selected defaults are a 2,000 ms startup timeout, 2,000 ms preparation lead,
4 MiB retention and per-subscriber limits, 5,000 ms idle grace period, and
5,000 ms process-termination grace. No startup burst or catch-up mode is
required.

The black-tail rerun used Plex Media Server
`1.43.4.10903-e5521bd8c` and FFmpeg `6.1.1-3ubuntu5`. The retained black-tail
command uses x264's `zerolatency` tune to stay within the startup ceiling; a
real-FFmpeg regression measured readiness below 2,000 ms before the manual run.
