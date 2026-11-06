# kraziMorph Spike: Mid-Broadcast Parameter Changes And Stream Copy

A throwaway harness, not product code. It answers the one question the
kraziMorph design hangs on before anything is specified:

> Can a channel's broadcast signal change resolution and frame rate at an
> item boundary, and carry stream-copied H.264, without Plex or the TV
> program losing playback?

It runs the real worker, session, splice, tuner routes, and TV program. The
only thing it changes is the FFmpeg argv the packager spawns, rewritten
in-process by a Node preload. No production file is touched, and removing
this folder removes the spike.

## What it does

`preload.mjs` patches `child_process.spawn`. For each FFmpeg command the
packager builds for a program, it probes the source once with ffprobe and
asks `encoding-plan.mjs`, the prototype of the real decision, which of three
strategies applies:

| Strategy | Meaning                                                                                                    |
| -------- | ---------------------------------------------------------------------------------------------------------- |
| `legacy` | Today's fixed 1080p30 H.264 argv, untouched                                                                |
| `encode` | H.264 at the source's size and frame rate, downscaled only above the ceiling, deinterlaced when interlaced |
| `copy`   | The source's H.264 video copied into the transport stream; audio still encoded to AAC                      |

`KRAZIMORPH_MODE` picks what is allowed: `off` is always legacy and is the
control, `native` allows encode, `auto` allows encode and copy.
`KRAZIMORPH_CEILING` is 480, 720, or 1080 (default 1080).

Copy is only ever chosen for a prepared process starting at media offset 0
with no burst, no zero-latency tuning, and no black tail. The first process
of a session and every mid-item start encode, because `-ss` with stream copy
lands on the nearest keyframe and would miss the schedule by up to a GOP.

Every decision is printed to stderr as a `krazimorph {...}` JSON line with
the source facts, the strategy, and its reasons. `KRAZIMORPH_LOG=<file>`
also appends them to a file.

## Run it

### 1. Local splice, no Plex, on the development PC

Needs a build first (`npm run build:node`; run `npm install` before it if
`@fastify/static` is reported missing).

```sh
KRAZIMORPH_MODE=off    node scripts/spikes/krazimorph/local-splice.mjs
KRAZIMORPH_MODE=native node scripts/spikes/krazimorph/local-splice.mjs
KRAZIMORPH_MODE=auto   node scripts/spikes/krazimorph/local-splice.mjs
```

Each run airs four 12-second clips through the production manager
(1080p30 encode, 720p24 copy, 480i MPEG-2 encode with deinterlace, 1080p60
copy), captures 46 seconds, decodes the capture, and prints the decisions,
the delivery gap at each splice, the frame sizes seen in order, and any
corrupt frames, backward timestamps, or silences. The capture lands in
`data/krazimorph/local/capture-<mode>.ts`; open it in VLC or ffplay and
watch the labels and clocks across the splices.

### 2. Plex and the TV program, on the Docker host

Plex and the real kraziTV run in Docker on the Ubuntu host, not on the
development PC (`docs/knowledge_base/plex-signal-spike.md`). The spike runs
there too, as a second container from the same image. Nothing is built on
the host; the image already holds the server.

1. On the PC, make the labeled clips, 90 seconds each, and copy them and
   this folder to the host:

   ```sh
   node scripts/spikes/krazimorph/make-fixtures.mjs
   scp -r data/krazimorph/fixtures  <host>:~/krazimorph/fixtures
   scp -r scripts/spikes/krazimorph <host>:~/krazimorph/spike
   ```

   (`--out DIR` and `--seconds N` change the clips. The host's own FFmpeg
   can also make them: `node spike/make-fixtures.mjs --out fixtures`.)

2. On the host, swap the real container for the spike one, control mode
   first. The script reads the real container's image, volumes, ports, and
   environment, so Plex sees the same tuner identity, `PUBLIC_BASE_URL`,
   and database, and adds the preload, this folder at `/spike`, and the
   clips at `/media/krazimorph`:

   ```sh
   cd ~/krazimorph
   KRAZIMORPH_FIXTURES=fixtures sh spike/docker-run.sh off
   ```

   If the real container is not named `krazitv`, set `KRAZITV_CONTAINER`.
   The server log, with the `krazimorph` decision lines, prints in the
   foreground.

3. In Media Library, add `/media/krazimorph` as a media root and scan it.
   Make a manual collection of the six clips in name order, and a channel
   whose lineup is that one show in chronological order. Plex already has
   the tuner and guide; the new channel appears on the next guide refresh.

4. Tune the channel in Plex and in the TV program, watch two full laps of
   the six clips, and fill in the table below. Then Ctrl-C and run the
   script again with `native`, then `auto`. Each restart ends the running
   broadcast; tune again.

5. When done, bring the real server back:

   ```sh
   docker start krazitv
   ```

   The channel, collection, and media root stay in the database; delete
   them from the web app afterwards if you do not want them.

To run from a source build instead, on any machine Plex can reach:
`npm run build:node`, then `KRAZIMORPH_MODE=off node scripts/spikes/krazimorph/start-server.mjs`
with the usual `.env`.

## The clips

| Clip                           | Source                                            | Expected in `auto`                | What it tests                                        |
| ------------------------------ | ------------------------------------------------- | --------------------------------- | ---------------------------------------------------- |
| KM-A 1080p30 H264              | H.264 1920x1080 30 fps, default GOP               | copy                              | The control: today's output shape, copied            |
| KM-B 720p24 H264 bframes gop5s | H.264 1280x720 23.976 fps, 3 B-frames, 5 s GOP    | copy                              | Resolution and frame-rate change; long GOP; B-frames |
| KM-C 480i MPEG2 anamorphic     | MPEG-2 720x480 29.97i, SAR 8:9, real field motion | encode 720x480, bwdif             | Deinterlace path; anamorphic SAR; small native size  |
| KM-D 1080p24 HEVC 10bit        | HEVC 1920x1080 23.976 fps yuv420p10le             | encode, yuv420p                   | Wrong codec and pixel format for copy                |
| KM-E 1080p60 H264              | H.264 1920x1080 60 fps                            | copy                              | 60 fps after 30 fps                                  |
| KM-F 2160p24 H264              | H.264 3840x2160 24 fps                            | encode, downscaled to the ceiling | Downscale only; no upscale anywhere                  |

Every clip shows its name and a running clock and plays its own tone, so a
freeze, skip, or hole is visible and audible at the splice.

## What to record

Fill one row per mode per player. "Clean" means the picture changed clips
without freezing, the clock kept running, and no error was shown.

| Mode     | Player                | A to B (30 to 24 fps, 1080 to 720) | B to C (copy to 480 encode) | C to D | D to E (24 to 60 fps) | E to F | F to A | Late tune mid-B (copy) | Notes |
| -------- | --------------------- | ---------------------------------- | --------------------------- | ------ | --------------------- | ------ | ------ | ---------------------- | ----- |
| `off`    | Plex client 1         |                                    |                             |        |                       |        |        |                        |       |
| `off`    | TV program (Chromium) |                                    |                             |        |                       |        |        |                        |       |
| `native` | Plex client 1         |                                    |                             |        |                       |        |        |                        |       |
| `native` | Plex client 2         |                                    |                             |        |                       |        |        |                        |       |
| `native` | TV program            |                                    |                             |        |                       |        |        |                        |       |
| `auto`   | Plex client 1         |                                    |                             |        |                       |        |        |                        |       |
| `auto`   | Plex client 2         |                                    |                             |        |                       |        |        |                        |       |
| `auto`   | TV program            |                                    |                             |        |                       |        |        |                        |       |

Also note, from the `krazimorph` lines:

- `probeMs` per clip: what an extended ffprobe costs. The real feature would
  pay this once per scan, not per spawn.
- Whether KM-C shows combing in any player (deinterlace skipped) or looks
  stretched (SAR ignored).
- Server CPU with `auto` against `off` while KM-B or KM-E airs. Copy should
  drop the encode to near zero; the audio encode remains.
- For the late tune during a copied clip: how far behind the live edge the
  viewer lands, and whether Plex froze on its first frame as issue #30 did.
  The join point counts keyframes assuming one per second, so a copied 5 s
  GOP will show whether that assumption needs replacing with timestamps.

## Decisions this spike feeds

- Whether Auto mode can exist at all, or kraziMorph is limited to a fixed
  per-channel output (ceiling as the output size, always encode).
- Whether the join point moves from keyframe counting to timestamps before
  copy ships.
- Whether `field_order` is enough to drive deinterlacing or a sampled `idet`
  pass is needed at scan time.
- The shape of the real `planEncoding` in `packages/signal`, which this
  folder's `encoding-plan.mjs` prototypes, and of the source facts
  `packages/media` must probe and the server must persist.

Results go in `docs/knowledge_base/` beside the Plex signal spike notes, and
the decision into ADR 0023.

## Results so far

### Local splice, 2026-11-05, Windows 11, FFmpeg 9.0.2 (gyan full build)

All three modes aired the four clips through the production manager with
no corrupt frame, no silence, no DTS regression on either stream, and a
longest delivery gap of about 220 ms at every splice, which is the normal
chunk cadence. The decoder's only messages in `native` and `auto` were the
three expected filter-graph reconfigurations where the frame size changed.

| Mode     | Decisions                                          | Frame sizes seen                        | Corrupt | DTS regressions | Longest gap |
| -------- | -------------------------------------------------- | --------------------------------------- | ------- | --------------- | ----------- |
| `off`    | legacy x4                                          | 1920x1080                               | 0       | 0               | 214 ms      |
| `native` | encode x4 at native size and rate, KM-C with bwdif | 1920x1080, 1280x720, 720x480, 1920x1080 | 0       | 0               | 218 ms      |
| `auto`   | encode A (first process), copy B, encode C, copy E | 1920x1080, 1280x720, 720x480, 1920x1080 | 0       | 0               | 219 ms      |

Findings that change the design:

- **Copied H.264 from Matroska splices cleanly.** The source has no DTS;
  FFmpeg derives it on the way into MPEG-TS, and the session's timestamp
  shift kept both copied segments, one with B-frames and a 5 s GOP, on the
  forward timeline. FFmpeg inserted `h264_mp4toannexb` on its own.
- **The join backlog breaks under long GOPs, as predicted.** A viewer
  tuning mid-KM-B joined 16.8 s behind the live edge, and mid-KM-E 16.3 s,
  against ADR 0018's ten seconds, because the join point counts keyframes
  as seconds. Both replays began on a keyframe and decoded cleanly, so
  the fix is a timestamp-based join point, not a safety problem.
- **The frame-rate change fooled the analyzer, not the decoder.** Decoding
  a capture with `-f null` quantizes output timestamps to the first
  stream's rate, so the 60 fps segment reported hundreds of
  "non monotonically increasing dts" lines that were artifacts.
  `-fps_mode passthrough -enc_time_base 1/90000` removes them. The
  integration suites' `expectCleanDecode` will need the same change when
  mixed frame rates arrive.
- **Extended ffprobe is cheap.** Each probe of a local clip took 125 to 250 ms
  as a cold process on Windows; see the `probeMs` field in the `krazimorph` lines.

Still open, for the server run: Plex client behavior across the size and
rate changes, mpegts.js in the TV program, combing or stretch on KM-C, and
CPU in `auto` against `off`.
