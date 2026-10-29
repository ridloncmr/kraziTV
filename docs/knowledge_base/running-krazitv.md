# Running kraziTV

Use this to install kraziTV, connect it to Plex, and configure it. The
README's quick start is the short version.

## Install With Docker

The image includes kraziTV, its web app, and FFmpeg.

```bash
docker build -t krazitv .
docker run -d --name krazitv -p 3000:3000 \
  -v krazitv-data:/data \
  -v /path/to/media:/media:ro \
  -e PUBLIC_BASE_URL=http://192.168.1.10:3000 \
  -e KRAZITV_PROGRAMMING_TIMEZONE=America/New_York \
  krazitv
```

- Set `PUBLIC_BASE_URL` to the address of the machine running kraziTV, and
  open kraziTV there. kraziTV only accepts changes from that address, so the
  logon screen links to it from any other. Left unset, it is
  `http://127.0.0.1:3000`, which works only on the machine itself.
- Set `KRAZITV_PROGRAMMING_TIMEZONE`. Containers usually report UTC, so
  time-of-day rules would otherwise follow UTC.
- Data lives in the `/data` volume. The server runs as the image's `node`
  user (uid 1000), so a host folder mounted there must be writable by it.
- Mount media read-only. kraziTV never changes media files.

## Install From Source

You need Node.js 22.13 or newer, npm 10 or newer, and FFmpeg 6.1 or newer,
with `ffprobe`, on your `PATH`. Older FFmpeg lacks
`-readrate_initial_burst`, which the join backlog needs
([ADR 0018](../adrs/0018-join-backlog.md)).

```bash
npm install
npm run build
cp .env.example .env     # then edit it; see Settings
npm start --workspace @krazitv/server
```

kraziTV serves the web app and everything else on one port, by default
`http://127.0.0.1:3000`
([ADR 0019](../adrs/0019-same-origin-web-app-and-container.md)). Set
`HOST=0.0.0.0` to reach it from other devices.

## First Steps

1. Open kraziTV and create your account.
2. In **Media Library**, add a folder of media. kraziTV offers to scan it
   right away; a folder you skip keeps a **Scan** button in its row. To match
   media with TMDB, add your TMDB API key when kraziTV asks.
3. In **Collections**, accept the automatic collections kraziTV suggests, or
   build your own.
4. In **My Channels**, create a channel and add shows to its **Lineup**.
   Add **Rules** for times and seasons and **Specials** for exact times.
5. Check **Program Guide** to see what will air.
6. Open **Plex Setup** for the two addresses Plex needs.

## Connect Plex

1. In Plex, open **Settings → Live TV & DVR** and add a device manually,
   using the **tuner base URL** from kraziTV's Plex Setup.
2. When Plex asks for a guide, choose an XMLTV guide and enter the **XMLTV
   guide URL** from Plex Setup.
3. Match the channels Plex lists, then tune one in **Live TV**.

If Plex runs on a different machine from kraziTV, `PUBLIC_BASE_URL` must be
an address that machine can reach. Plex Setup warns you when it isn't.

A newly tuned viewer receives about ten seconds of the channel at once, so
Plex starts playing quickly. Viewers therefore watch about ten seconds behind
the guide.

## Settings

kraziTV reads settings from environment variables, or from a `.env` file at
the repo root (copy [`.env.example`](../../.env.example)). Variables already
set in the environment win over the file. Restart kraziTV after changing
either.

| Setting                        | What it does                                                        | Default                   |
| ------------------------------ | ------------------------------------------------------------------- | ------------------------- |
| `PUBLIC_BASE_URL`              | The address Plex and your browser use to reach kraziTV              | `http://127.0.0.1:PORT`   |
| `HOST`, `PORT`                 | The address and port kraziTV listens on                             | `127.0.0.1`, `3000`       |
| `KRAZITV_DATA_DIR`             | Where kraziTV keeps its database; relative to the working directory | `data`                    |
| `KRAZITV_PROGRAMMING_TIMEZONE` | The timezone rules use, such as `America/New_York`                  | The host's timezone       |
| `KRAZITV_DEVICE_ID`            | The tuner ID Plex sees, eight hex digits                            | `4B5A5456`                |
| `KRAZITV_TUNER_COUNT`          | How many channels Plex may watch at once                            | `2`                       |
| `FFMPEG_PATH`, `FFPROBE_PATH`  | FFmpeg and ffprobe programs to use                                  | The ones on `PATH`        |
| `FFMPEG_FONT_FILE`             | The font for the "Programming resumes" screen                       | Arial, or the system font |
| `FFPROBE_TIMEOUT_MS`           | How long scanning one file may take                                 | `30000`                   |
| `FFPROBE_CONCURRENCY`          | How many files are scanned at once                                  | `4`                       |
| `CORS_ORIGINS`                 | Other web addresses allowed to call kraziTV, mainly for development | `http://127.0.0.1:5173`   |

## Reset The Password

kraziTV has one account. If its password is forgotten, run this on the
server, in an interactive terminal:

- From source: `npm run reset-password`
- Docker: `docker exec -it krazitv node apps/server/dist/reset-password.js`

It reads the same settings as the server, prompts twice without echoing,
replaces the password, and logs every browser out. kraziTV may keep running.

## Security

- Administration needs the account's password
  ([ADR 0012](../adrs/0012-first-party-session-auth.md)).
- The tuner, guide, and stream endpoints Plex uses are open, so anyone who
  can reach kraziTV can watch its channels and read its guide.
- kraziTV serves plain HTTP. Keep it on a trusted network, or put it behind a
  reverse proxy that adds HTTPS and set `PUBLIC_BASE_URL` to the proxy's
  `https` address.

## Current Limits

- Plex only; Jellyfin is planned.
- No playback in the browser yet.
- Every channel is re-encoded to 1080p, 30 fps, H.264 with AAC audio.
- If FFmpeg fails mid-program, viewers' streams end and they must tune again.
