# Install

kraziTV runs on one computer on your home network, next to your media. It
needs to see your media files and to be reachable by Plex and your browser.

The easiest way is Docker. Building from source works on any machine with
Node.js and FFmpeg.

## What you need

Each channel being watched is a full 1080p video conversion, so a computer
with a recent multi-core processor handles a few channels at once. A
low-power device such as a Raspberry Pi will struggle with even one. A
channel nobody is watching costs nothing.

## With Docker

Run the newest release:

```bash
docker run -d --name krazitv -p 3000:3000 \
  -v krazitv-data:/data \
  -v /path/to/your/media:/media:ro \
  -e PUBLIC_BASE_URL=http://192.168.1.10:3000 \
  -e KRAZITV_PROGRAMMING_TIMEZONE=America/New_York \
  ghcr.io/ridloncmr/krazitv:v0.9.0-rc.2
```

Three things to change:

- **`/path/to/your/media`** is the folder holding your movies and shows. It
  is mounted read-only; kraziTV never changes your files.
- **`PUBLIC_BASE_URL`** is the address other devices use to reach this
  computer. Use its network address, not `localhost`. kraziTV builds every
  Plex address on it, and only accepts changes from it.
- **`KRAZITV_PROGRAMMING_TIMEZONE`** is your local timezone, such as
  `America/New_York` or `Europe/London`. Docker needs it, or a rule for
  8 PM fires at 8 PM UTC. See [Settings](Settings#the-timezone).

Your settings and catalog live in the `krazitv-data` volume. To keep them
in a normal folder instead, mount that folder at `/data`. kraziTV runs
inside the container as user 1000, so that folder must be writable by user
1000, for example after `sudo chown 1000 /path/to/folder`.

Then open `PUBLIC_BASE_URL` in a browser. You will see the welcome screen.

The [releases page](https://github.com/ridloncmr/kraziTV/releases) lists
every version. A pre-release such as `v0.9.0-rc.1` has to be named
exactly; once a full release is out, `ghcr.io/ridloncmr/krazitv:latest`
always gets the newest one.

## From source

You need Node.js 22.13 or newer, npm 10 or newer, and FFmpeg 6.1 or newer
with `ffprobe`, all on your `PATH`.

```bash
git clone https://github.com/ridloncmr/kraziTV.git
cd kraziTV
npm install
npm run build
cp .env.example .env
npm start --workspace @krazitv/server
```

Before starting, edit `.env`:

- Set `HOST=0.0.0.0` so other devices can reach kraziTV.
- Set `PUBLIC_BASE_URL` to this computer's network address, such as
  `http://192.168.1.10:3000`.
- Set `KRAZITV_PROGRAMMING_TIMEZONE` if the computer's clock is not in your
  local timezone.

kraziTV serves everything on one port, by default 3000. Open
`PUBLIC_BASE_URL` in a browser.

[Settings](Settings) lists every setting and its default.

## Updating

With Docker, pull the new version, remove the old container, and run the
same `docker run` command again with the new tag. Your data is in the
volume, so nothing is lost:

```bash
docker pull ghcr.io/ridloncmr/krazitv:v0.9.0-rc.2
docker rm -f krazitv
docker run ...   # the same command as before
```

From source, run `git pull`, `npm install`, and `npm run build`, then start
kraziTV again.

kraziTV upgrades its own database the first time a new version starts.
After any restart, channels carry on where the schedule says they should
be. If kraziTV was off for days and the schedule ran out, each channel
starts fresh programming from now.

## Your data

Everything kraziTV knows is in its data folder: the `/data` volume with
Docker, or `apps/server/data` from source. That is one
database holding your account, your TMDB key, the catalog, collections,
channels, and schedules. Your media files are never in it.

To back it up, stop kraziTV and copy the folder. To restore, put the folder
back and start kraziTV.

## Keep it on your home network

The channel streams have no password, so anyone who can reach kraziTV can
watch. Keep it on your home network and do not open its port to the
internet. If you know how to put it behind a reverse proxy with HTTPS, set
`PUBLIC_BASE_URL` to the proxy's `https` address.

---

**Next:** [First run](First-Run) takes you from the welcome screen to a
channel on the air.
