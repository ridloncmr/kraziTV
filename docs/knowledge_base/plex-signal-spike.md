# Plex Signal Compatibility Spike

This disposable app exercises the retained `@krazitv/signal` manager, worker,
broadcaster, and FFmpeg session through one hard-coded HDHomeRun-compatible
channel. It does not replace the production Plex adapter or playout adapters.

## Prerequisites

- Node.js and npm versions supported by the repository.
- `ffmpeg` on `PATH`, or an explicit `KRAZITV_SPIKE_FFMPEG_PATH`.
- A Plex Media Server that can reach the spike's public base URL for the later
  manual compatibility run.

The app checks the FFmpeg executable and both media files before listening. It
reports the FFmpeg version and SHA-256 identities of the controlled assets.

## Generate Controlled Assets

From the repository root:

```powershell
npm run spike:assets
```

The command creates `data/signal-spike/video-a.mp4` and
`data/signal-spike/video-b.mp4`. Each 30-second file has a visible label and
running timestamp plus a distinct color and audio tone. The command prints the
environment values needed to launch the spike.

Set a custom executable or output directory when required:

```powershell
$env:KRAZITV_SPIKE_FFMPEG_PATH = 'C:\tools\ffmpeg\bin\ffmpeg.exe'
$env:KRAZITV_SPIKE_ASSET_DIRECTORY = 'D:\kraziTV-spike-assets'
$env:KRAZITV_SPIKE_FONT_PATH = 'C:\Windows\Fonts\arial.ttf'
npm run spike:assets
```

On Windows the generator defaults to `C:\Windows\Fonts\arial.ttf`. Override
`KRAZITV_SPIKE_FONT_PATH` when that font is unavailable. Other platforms use
FFmpeg's configured default font unless a path is supplied.

## Launch

Configure the generated asset paths and a URL reachable by Plex:

```powershell
$env:KRAZITV_SPIKE_MEDIA_A_PATH = (Resolve-Path 'data/signal-spike/video-a.mp4')
$env:KRAZITV_SPIKE_MEDIA_B_PATH = (Resolve-Path 'data/signal-spike/video-b.mp4')
$env:KRAZITV_SPIKE_HOST = '0.0.0.0'
$env:KRAZITV_SPIKE_PORT = '3000'
$env:KRAZITV_SPIKE_PUBLIC_BASE_URL = 'http://192.168.1.50:3000'
npm run spike:dev
```

Replace `192.168.1.50` with the development machine's LAN address. Do not use
`127.0.0.1` when Plex runs on a different machine or container.

The harness exposes:

- `GET /discover.json`
- `GET /lineup_status.json`
- `GET /lineup.json`
- `GET /device.xml`
- `GET /channels/69/stream`

The fixed playout alternates VIDEO A and VIDEO B continuously. Viewer requests
subscribe through the singleton `ChannelStreamManager`; they do not create a
separate worker or encoder implementation in the harness.

## Automated Verification

Run the environment-independent suite with:

```powershell
npm test --workspace @krazitv/plex-spike
npm test --workspace @krazitv/signal
```

The tests cover tuner response shapes, stream subscription cleanup, fixed
playout selection, transition coordination, prerequisite failures, and asset
generation arguments. They use injected fakes and do not silently claim real
FFmpeg or Plex compatibility.

After generating and configuring the assets, run the explicit real-FFmpeg
smoke suite:

```powershell
npm run spike:test:ffmpeg
```

This command is intentionally outside the normal unit suite. It fails with an
actionable prerequisite error instead of skipping when FFmpeg or either asset
is unavailable. It seeks into VIDEO A, commits VIDEO B through the retained
session, checks the fixed transport PIDs and packet alignment, and decodes the
captured MPEG-TS with FFmpeg.

### Retained Baseline Result

The real-FFmpeg smoke suite passed on 2026-09-29 with
`ffmpeg version 9.0.2-full_build-www.gyan.dev`. The generated fixture identities
were:

- VIDEO A: `6824346F4FB15F9FEC0040854C40DF6F315CB5CBCEC83FA8EF9C0BEDF5F152B4`
- VIDEO B: `91359A0740EE58A0E85C54ED7828AA02D9EEC17193CB58A0BC420C4C86662E04`

That run established the local executable baseline: the retained session
crossed the VIDEO A/B boundary with 188-byte packet alignment, the expected
transport PIDs, and a decodable capture. It did not establish Plex client
compatibility.

## Manual Plex Matrix

SIG-011 owns the empirical run. Add the spike's public base URL as a manual
Plex Live TV tuner, then verify two simultaneous viewers, late join, slow-viewer
isolation, the VIDEO A/B boundary, idle shutdown, and process sharing. Record
the observed FFmpeg version, asset hashes, startup wait, tune drift, pacing
drift, boundary gap, late-join result, buffer behavior, and encoder count.

### Black-Tail Boundary

SIG-016 reruns the boundary row for media shorter than its airtime, because
the black-tail arguments postdate the SIG-011 run. Launch as above with a
40-second slot, so each 30-second asset airs a 10-second black tail:

```powershell
$env:KRAZITV_SPIKE_AIRTIME_MS = '40000'
npm run spike:dev
```

Slots start when the harness starts. Tune Channel 69 in Plex, watch VIDEO A
end, then confirm that Plex shows about 10 seconds of black and silence and
keeps playing into VIDEO B without buffering or dropping. Record the result
under Retained Plex Result with the FFmpeg and Plex versions, then clear the
setting so later matrix rows air full-length slots again:

```powershell
Remove-Item Env:KRAZITV_SPIKE_AIRTIME_MS
```

## Retained Plex Result

The SIG-011 matrix passed on 2026-09-29 with:

- Ubuntu 24.04.4 LTS host;
- Plex Media Server 1.43.4.10903 in the host-networked
  `linuxserver/plex` container;
- FFmpeg 6.1.1-3ubuntu5;
- VIDEO A SHA-256
  `07aa537abc566ec89ec055b745478c1e81950221492469294875fa386330ba68`;
- VIDEO B SHA-256
  `166f16a5ff351cef6b4dfcaa29e6ccf2759500d26d317a6f4047ec25d5201cb3`.

| Measurement                | Result                                                                          |
| -------------------------- | ------------------------------------------------------------------------------- |
| Manual tuner setup         | Plex discovered the tuner and listed Channel 69                                 |
| Corrected cold-start waits | 1,719 ms, 1,705 ms, 1,708 ms, 1,697 ms, and 1,730 ms                            |
| Initial tune drift         | Approximately 1.7 seconds behind schedule; below the 2,000 ms ceiling           |
| Pacing                     | `-re` remained approximately 1x through repeated 30-second items                |
| Boundary commit latency    | Within 9 ms of the scheduled boundary                                           |
| Boundary usable-output gap | 1,701-1,715 ms; Plex showed no playback interruption                            |
| Boundary strategy          | Sequential encoders spliced on 188-byte packet boundaries                       |
| Shared process count       | One kraziTV worker and encoder while two Plex clients played                    |
| Plex late client           | Buffered still initially, then about one second behind Viewer A                 |
| Direct late subscriber     | Attached in 5 ms and decoded a 165,064-byte, three-second capture               |
| Slow subscriber            | A 1 KiB/s client ran for 110 seconds without affecting Plex playback            |
| Idle shutdown              | Session stopped 5,261 ms after the final disconnect; no FFmpeg process remained |
| Active shutdown            | Stopping the harness settled the active worker and encoder                      |

The first run exposed that replaying from the oldest retained PAT burst 4.3 MiB
to a late subscriber and produced missing-PPS decoder warnings. The retained fix
uses the newest valid PAT and a fixed one-second H.264 GOP (`-g 30`,
`-keyint_min 30`, `-sc_threshold 0`). The corrected direct late join delivered
165,064 bytes over three seconds and decoded successfully. Decoders can still
report transient missing-PPS warnings before the next random-access point; the
one-second GOP bounds that interval.

Selected defaults are a 2,000 ms startup timeout, 2,000 ms preparation lead,
4 MiB retention and per-subscriber limits, 5,000 ms idle grace, and 5,000 ms
process-termination grace. No startup burst or catch-up mode is required.
