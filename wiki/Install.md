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
  ghcr.io/ridloncmr/krazitv:v0.9.0-rc.3
```

Most people change only three things: the media folder, the address, and
the timezone. Here is every part of the command:

| Part                                    | Needed?                      | What to put                                                                                                                         | If you leave it out                                                    |
| --------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `-p 3000:3000`                          | Yes                          | Keep it. To use another port, change the first number only, such as `-p 8080:3000`.                                                 | Nothing can reach kraziTV.                                             |
| `-v krazitv-data:/data`                 | Yes                          | Keep it, or replace `krazitv-data` with a folder. See [Your data](#your-data).                                                      | Everything is lost when the container is removed.                      |
| `-v /path/to/your/media:/media:ro`      | Yes, one per drive or folder | Each folder holding movies or shows. kraziTV in Docker sees only what you list here. See [Your media folders](#your-media-folders). | kraziTV has no media to play.                                          |
| `-e PUBLIC_BASE_URL=...`                | Usually                      | This computer's address on your network. See [Your address](#your-address).                                                         | Only Plex and browsers on this computer can use kraziTV.               |
| `-e KRAZITV_PROGRAMMING_TIMEZONE=...`   | Recommended                  | Your timezone, such as `America/Chicago`. [Settings](Settings#the-timezone) lists the common ones.                                  | kraziTV uses UTC, so a rule for 8 PM fires at 8 PM UTC, not your 8 PM. |
| `ghcr.io/ridloncmr/krazitv:v0.9.0-rc.3` | Yes                          | The version to run. The [releases page](https://github.com/ridloncmr/kraziTV/releases) lists every one.                             |                                                                        |

You can also add `--restart unless-stopped` after `-d` so kraziTV starts
again when the computer restarts. Without it, run `docker start krazitv`
after a reboot.

Then open your `PUBLIC_BASE_URL` in a browser. You will see the welcome
screen.

A pre-release such as `v0.9.0-rc.1` has to be named exactly; once a full
release is out, `ghcr.io/ridloncmr/krazitv:latest` always gets the newest
one.

### Your address

`PUBLIC_BASE_URL` is the address Plex, TVs, phones, and browsers use to
reach kraziTV. kraziTV hands it to Plex, and only accepts changes from a
browser at that address. Pick the row that matches your setup:

| Your setup                                                                          | Put                                                       |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Plex runs on another computer, or you open kraziTV from another device (most homes) | `http://` + this computer's network address + `:3000`     |
| Plex runs in Docker, even on this same computer                                     | `http://` + this computer's network address + `:3000`     |
| Plex is installed directly on this computer, and you only browse from it            | Leave the line out. kraziTV uses `http://127.0.0.1:3000`. |
| You put kraziTV behind a reverse proxy with HTTPS                                   | The proxy's address, such as `https://tv.example.com`     |

If you are not sure, use the network address. It works in every setup
except the reverse proxy one.

**Find this computer's network address.** Run this on the computer kraziTV
runs on, not inside the container:

| On      | Run                      | Look for                                                      |
| ------- | ------------------------ | ------------------------------------------------------------- |
| Linux   | `hostname -I`            | The first address, such as `192.168.1.10`                     |
| macOS   | `ipconfig getifaddr en0` | The address it prints. If it prints nothing, try `en1`.       |
| Windows | `ipconfig`               | **IPv4 Address** under the adapter you use, Ethernet or Wi-Fi |

Your router's admin page also lists it, under connected devices. A home
network address usually starts with `192.168.` or `10.`. Do not use an
address starting with `127.`, which only this computer can reach, or
`172.17.`, which is Docker's own internal network.

Then write it as `http://` + the address + `:` + the port. With
`-p 3000:3000` the port is `3000`, so `192.168.1.10` becomes
`http://192.168.1.10:3000`. With `-p 8080:3000` it is
`http://192.168.1.10:8080`. Leave off any slash or path at the end.

**Keep the address from changing.** Most routers hand out addresses that
can change after a restart. If this computer's address changes, Plex loses
kraziTV until you update `PUBLIC_BASE_URL` and add the tuner again. In your
router's settings, give this computer a fixed address; routers call it a
DHCP reservation, reserved IP, or static lease.

A name such as `http://mediaserver.local:3000` also works, but only if
every device, including the Plex server, can look it up. The number is the
safe choice.

**Check it.** Open the address in a browser on another device, such as
your phone on home Wi-Fi. If kraziTV's logon or welcome screen appears, the
address is right. Plex Setup in kraziTV also warns you when the address is
one only this computer can reach.

### Your media folders

In Docker, kraziTV can see only the folders you hand it with `-v`; the rest
of your computer is invisible to it. Each `-v` line has two sides:

- **Left:** the folder on this computer, such as `/mnt/movies` or
  `/home/you/Videos`.
- **Right:** where kraziTV sees it, always starting with `/media`. This is
  what you pick in [Media Library](Media-Library) under **Add media root…**.

`:ro` makes it read-only; kraziTV never changes your files.

**Media on more than one drive or folder?** Add one `-v` line for each,
giving each its own name under `/media`:

```bash
  -v /mnt/drive1/TV:/media/drive1-tv:ro \
  -v /mnt/drive2/Movies:/media/drive2-movies:ro \
```

In Media Library, add each one as its own media root (`/media/drive1-tv`,
then `/media/drive2-movies`), or add `/media` once to cover them all, but
not both: overlapping roots catalog the same files twice. A
folder you leave out of the command never shows up in **Browse…**. To add a
drive later, add its `-v` line and run the `docker run` command again; see
[Updating](#updating). Your channels and catalog are kept.

If all your drives sit under one folder, such as `/mnt`, one line covers
them all: `-v /mnt:/media:ro`. Every folder under `/mnt` then appears under
`/media`.

On Windows with Docker Desktop, write the folder like
`C:\Users\you\Videos:/media/videos:ro`, and a second drive like
`D:\Movies:/media/movies:ro`.

From source, kraziTV sees every folder on the computer, so there is nothing
to set up here: browse to each drive in Media Library.

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

Before starting, edit `.env` and set these lines:

```bash
HOST=0.0.0.0
PUBLIC_BASE_URL=http://192.168.1.10:3000
```

- **`HOST=0.0.0.0`** lets other devices reach kraziTV. Leave it at
  `127.0.0.1` only if Plex and your browser are on this computer.
- **`PUBLIC_BASE_URL`** is this computer's network address, worked out the
  same way as for Docker. See [Your address](#your-address).
- **`KRAZITV_PROGRAMMING_TIMEZONE`** can usually be left out: kraziTV uses
  this computer's timezone. Set it only if the computer's clock is not on
  your local time.

kraziTV serves everything on one port, by default 3000. Open
`PUBLIC_BASE_URL` in a browser.

[Settings](Settings) lists every setting, what it accepts, and what
happens when you leave it out.

## Updating

With Docker, pull the new version, remove the old container, and run the
same `docker run` command again with the new tag. Your data is in the
volume, so nothing is lost:

```bash
docker pull ghcr.io/ridloncmr/krazitv:v0.9.0-rc.3
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

With Docker, `-v krazitv-data:/data` keeps it in a volume Docker manages.
To keep it in a normal folder instead, put that folder before `:/data`,
such as `-v /opt/krazitv:/data`. kraziTV runs inside the container as user
1000, so that folder must be writable by user 1000, for example after
`sudo chown 1000 /opt/krazitv`.

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
