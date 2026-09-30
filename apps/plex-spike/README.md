# Plex compatibility spike

This disposable app exposes Channel 69 through the production `@krazitv/signal`
manager and FFmpeg packager. It does not contain a second streaming runtime.

Generate the two controlled, 30-second inputs from the repository root:

```powershell
npm run assets --workspace @krazitv/plex-spike
```

The command prints the absolute `KRAZITV_SPIKE_MEDIA_A_PATH` and
`KRAZITV_SPIKE_MEDIA_B_PATH` values. Configure those values, then start the
harness:

```powershell
$env:KRAZITV_SPIKE_MEDIA_A_PATH = "C:\path\to\data\signal-spike\video-a.mp4"
$env:KRAZITV_SPIKE_MEDIA_B_PATH = "C:\path\to\data\signal-spike\video-b.mp4"
$env:KRAZITV_SPIKE_PUBLIC_BASE_URL = "http://192.168.1.25:3000"
$env:KRAZITV_SPIKE_HOST = "0.0.0.0"
npm run dev --workspace @krazitv/plex-spike
```

If FFmpeg is not on `PATH`, also set `KRAZITV_SPIKE_FFMPEG_PATH` to its
executable. `KRAZITV_SPIKE_PUBLIC_BASE_URL` must be reachable from the Plex
server; it is never inferred from a request `Host` header.

At startup, the harness fails fast if FFmpeg or either input is unavailable. It
logs the FFmpeg version and SHA-256 identity of each input. Stream requests log
request, subscription-ready, and disconnect timestamps for the SIG-011 manual
measurement record.
