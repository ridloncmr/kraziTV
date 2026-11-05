# Settings

kraziTV reads its settings from environment variables when it starts. With
Docker, pass them with `-e`. From source, put them in a `.env` file in the
top kraziTV folder, next to `.env.example`, which lists them all. Restart kraziTV after any
change.

Everything else, such as channels, collections, and the TMDB key, is set
in the web app and needs no restart.

**Every setting is optional.** Most homes set only two:

- `PUBLIC_BASE_URL`, so Plex and other devices can reach kraziTV. See
  [Your address](Install#your-address).
- `KRAZITV_PROGRAMMING_TIMEZONE` with Docker, so rules follow your clock.
  See [The timezone](#the-timezone).

From source, also set `HOST=0.0.0.0`. Docker already does. Leave the rest
out unless the table gives you a reason to set one.

| Setting                        | What it does                                           | What you can put                                                                                                              | If you leave it out                                                      |
| ------------------------------ | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `PUBLIC_BASE_URL`              | The address Plex and your browser use to reach kraziTV | `http://`, an address, and a port, such as `http://192.168.1.10:3000`. See [Your address](Install#your-address).              | `http://127.0.0.1:` and the port, which only this computer can reach     |
| `HOST`                         | Which devices kraziTV accepts connections from         | `0.0.0.0` for every device on your network, or `127.0.0.1` for this computer only                                             | `127.0.0.1` from source; Docker sets `0.0.0.0` for you                   |
| `PORT`                         | The port kraziTV listens on                            | A number from 1 to 65535. With Docker, change the first number of `-p` instead.                                               | `3000`                                                                   |
| `KRAZITV_PROGRAMMING_TIMEZONE` | The timezone rules and off-air times use               | A timezone name such as `America/New_York`. See [The timezone](#the-timezone).                                                | The computer's timezone, which is UTC inside Docker                      |
| `KRAZITV_DATA_DIR`             | Where kraziTV keeps its database                       | A folder path                                                                                                                 | `apps/server/data` from source; `/data` in Docker, which you should keep |
| `KRAZITV_TUNER_COUNT`          | How many channels Plex may watch at once               | A number from 1 to 64. Raise it only if your computer keeps up; see [What you need](Install#what-you-need).                   | `2`                                                                      |
| `KRAZITV_DEVICE_ID`            | The tuner ID Plex sees                                 | Eight letters or digits from 0-9 and A-F, such as `4B5A5457`. Change it only to run two copies of kraziTV on one Plex server. | `4B5A5456`                                                               |
| `FFMPEG_PATH`, `FFPROBE_PATH`  | The FFmpeg and ffprobe programs to use                 | The full path to each program, such as `/usr/local/bin/ffmpeg`                                                                | The ones on `PATH`. Docker includes them.                                |
| `FFMPEG_FONT_FILE`             | The font for the off-air and offline screens           | The full path to a `.ttf` font file                                                                                           | Arial on Windows, otherwise the system's default font                    |
| `FFPROBE_TIMEOUT_MS`           | How long scanning one file may take, in milliseconds   | A number such as `60000`. Raise it if files on a slow network share fail to scan.                                             | `30000`, which is 30 seconds                                             |
| `FFPROBE_CONCURRENCY`          | How many files are scanned at once                     | A number from 1 to 32. Lower it if scans slow down a network share.                                                           | `4`                                                                      |
| `CORS_ORIGINS`                 | Only for people developing kraziTV                     | Leave it alone                                                                                                                | `http://127.0.0.1:5173`                                                  |

kraziTV refuses to start when a setting has a value it cannot use, such as
`PORT=abc` or a misspelled timezone. Its log names the setting and what is
wrong with it. With Docker, read the log with `docker logs krazitv`.

## The timezone

Rules say "8 PM" and off-air screens say "Programming resumes at 8:00 PM"
in the programming timezone. Set `KRAZITV_PROGRAMMING_TIMEZONE` to your
timezone's name:

| Where you are                   | Put                   |
| ------------------------------- | --------------------- |
| US Eastern                      | `America/New_York`    |
| US Central                      | `America/Chicago`     |
| US Mountain                     | `America/Denver`      |
| Arizona (no daylight saving)    | `America/Phoenix`     |
| US Pacific                      | `America/Los_Angeles` |
| Alaska                          | `America/Anchorage`   |
| Hawaii                          | `Pacific/Honolulu`    |
| Canada, Eastern                 | `America/Toronto`     |
| Canada, Pacific                 | `America/Vancouver`   |
| UK and Ireland                  | `Europe/London`       |
| Central Europe                  | `Europe/Berlin`       |
| Australia, Sydney and Melbourne | `Australia/Sydney`    |

Anywhere else, pick the biggest city in your timezone from the
[full list](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones).
Use the name, not an offset such as `-05:00`: names follow daylight saving
and offsets do not, so kraziTV refuses offsets.

You can leave it out when kraziTV runs from source on a computer set to your
local time; kraziTV uses the computer's timezone. Docker containers run on
UTC, so with Docker always set it. When it is left out on UTC, kraziTV's
log warns you. The dialog that creates or edits a rule names the timezone
in use, so you can check it there.

The Program Guide, on the other hand, shows times in your browser's
timezone. If the two differ, guide times and on-screen times will not
match.

## The address

Every address kraziTV gives Plex is built on `PUBLIC_BASE_URL`, and
kraziTV only accepts changes from a browser at that address. Open it there.
If you open kraziTV at another address, the logon screen links you to the
right one. Plex Setup warns you when the address is one only this computer
can reach. [Your address](Install#your-address) shows what to put for your
setup and how to find it.

---

**Next:** [Troubleshooting](Troubleshooting).
