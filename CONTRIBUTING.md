# Contributing To kraziTV

Thanks for helping. Bug reports, ideas, and pull requests are all welcome.
For anything larger than a small fix, open an issue first so we can agree on
the approach.

## Set Up

You need Node.js 22.13 or newer, npm 10 or newer, and FFmpeg 6.1 or newer,
with `ffprobe`, on your `PATH`.

```bash
npm install
npm run build:node
npm run dev
```

`npm run build:node` compiles the workspace packages into their `dist/`
folders. The server, `npm test`, and the browser suite import the packages
from there, so run it once after installing and again after you
change a package under `packages/`; `npm run typecheck` rebuilds them too.

`npm run dev` starts the server at `http://127.0.0.1:3000` and the web app at
`http://127.0.0.1:5173` together, labeling each line `api` or `web`, and stops
both when either stops. `npm run dev:server` or `npm run dev:web` starts one
alone. During development the web app calls the server across origins. To
point it somewhere else, set `VITE_API_BASE_URL` in your shell or in
`apps/web/.env` (Vite does not read the repo-root `.env`), and add the web
app's origin to the server's `CORS_ORIGINS`.

Settings come from environment variables or a repo-root `.env`; see
[`.env.example`](.env.example) and the
[setup guide](docs/knowledge_base/running-krazitv.md#settings).

## Before You Open A Pull Request

CI runs all of these, and fails on any of them:

```bash
npm run plan:status   # regenerate plan progress tables
npm run format:write  # Prettier
npm run typecheck     # also rebuilds the packages' dist/
npm run lint
npm test              # every unit suite
npm run audit:strict  # source layout and composition rules
npm run agents:check  # Claude skill adapters match .agents/skills/
npm run build         # the packages and the production web app
```

CI checks rather than rewrites: it runs `npm run format` and
`npm run plan:status:check`, which fail when the two rewriting commands above
would change a file. When your change completes a plan ticket, add the
ticket's `**Status**` block before running `npm run plan:status`; the
[`AGENTS.md` documentation rules](AGENTS.md#documentation-rules) give its
wording.

The browser suite runs in CI too. It drives Chromium against a real server
and SQLite, and imports the server's source, so run `npm run build:node`
first. Install Chromium once with `npx playwright install chromium`, then run
`npm run test:browser --workspace @krazitv/web`.

These suites run only on request, and fail rather than skip when what they
need is missing:

| Command                | Run it when you change                                            | Needs              |
| ---------------------- | ----------------------------------------------------------------- | ------------------ |
| `npm run test:ffprobe` | media probing                                                     | `ffprobe`          |
| `npm run test:ffmpeg`  | FFmpeg arguments, stream packaging, or the channel stream runtime | `ffmpeg`           |
| `npm run test:tmdb`    | the TMDB client                                                   | `TMDB_API_KEY` set |

### Running One Test

Each workspace runs Vitest with its own configuration, so run a single file
from its workspace, with the path relative to that workspace. `-t` narrows it
to tests whose name contains the text:

```bash
npm exec --workspace @krazitv/server -- vitest run src/channels/channel-number.test.ts
npm exec --workspace @krazitv/web -- vitest run src/http -t "401"
```

### Other Root Scripts

| Command                     | What it does                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------------ |
| `npm run dev:server`        | Starts only the server, rebuilding the packages first                                      |
| `npm run dev:web`           | Starts only the web app                                                                    |
| `npm run clean`             | Deletes every workspace's `dist/`                                                          |
| `npm run format`            | Checks formatting without writing                                                          |
| `npm run plan:status:check` | Fails when a plan's generated progress table is out of date                                |
| `npm run agents:sync`       | Regenerates `.claude/skills/` from `.agents/skills/`; never edit those by hand             |
| `npm run audit`             | Reports audit findings without failing, for a quick look                                   |
| `npm run test:audit`        | Runs the tests under `scripts/`; `npm test` includes them                                  |
| `npm run reset-password`    | Resets the account's password from a shell on the server host                              |
| `npm run live:screenshot`   | Screenshots the running app; see [live app access](docs/knowledge_base/live-app-access.md) |

## How The Code Is Organized

kraziTV keeps four responsibilities apart:

- **kraziBrain** decides what plays, when, and why. `packages/krazi-brain` is
  its pure generator: it reads no files, database, or network, and the
  server calls it with the rows it has read and stores what it returns.
- **Channel stream workers** (`packages/signal`) run one shared broadcast
  per watched channel.
- **SignalPackager** (`packages/signal`) owns every FFmpeg command and turns
  scheduled files into one continuous MPEG-TS stream.
- **Provider adapters** (`packages/plex`) present channels, the guide, and
  stream addresses to Plex, which sees an HDHomeRun tuner and an XMLTV guide.

Scheduling never depends on Plex, FFmpeg commands never live in kraziBrain,
and viewers of one channel always share one stream.

```text
apps/
  server/       Fastify API: owns the SQLite database, calls the packages,
                and hosts the built web app
  web/          React web app
packages/
  krazi-brain/  pure scheduling and playout decisions
  media/        file discovery, ffprobe, and TMDB lookups
  signal/       channel stream workers and FFmpeg packaging
  plex/         HDHomeRun and XMLTV formatting
  process/      child-process handling shared by media and signal
```

The server keeps one folder per domain under `apps/server/src/`:

| Domain                                                            | What it owns                                                            |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `auth/`                                                           | The account, sessions, and the auth gate                                |
| `media-roots/`, `media-items/`                                    | The catalog's roots and items                                           |
| `catalog-scan/`, `catalog-removal/`                               | Scan jobs and lookup retries; removal and purge                         |
| `content-metadata/`                                               | TMDB matches, corrections, refreshes, and the stored TMDB key           |
| `media-collections/`                                              | Collections, automatic membership, exclusions, and recommendations      |
| `channels/`                                                       | Channels and their channel stream workers                               |
| `programming-assignments/`, `programming-rules/`, `reservations/` | Programming source assignments, programming rules, and reservations     |
| `schedules/`                                                      | Schedule entries: generation, coverage, regeneration, and the guide     |
| `playout/`                                                        | What a channel transmits now and next                                   |
| `plex/`                                                           | The HDHomeRun and XMLTV routes Plex calls                               |
| `web-app/`                                                        | Serving the built web app                                               |
| `database/`                                                       | The schema, migrations, and write authority                             |
| `config/`, `http/`, `terminal/`                                   | Settings, shared HTTP error and request shapes, and the password prompt |

Every package and app lays out `src/` the same way; the
[`AGENTS.md` principles](AGENTS.md#governing-engineering-principles) give the
rules, and `npm run audit:strict` checks them.

## Where Things Are Written Down

- [`AGENTS.md`](AGENTS.md): the engineering rules, for people and AI agents
  alike, including the file layout and the checklist before you finish.
- [`GLOSSARY.md`](GLOSSARY.md): the project's vocabulary. Use its terms in
  code and docs.
- [`docs/specs/`](docs/specs/README.md): what each feature should do.
- [`docs/adrs/`](docs/adrs/README.md): architecture decisions and why.
- [`docs/implementation_plan/`](docs/implementation_plan/README.md): build
  order and ticket status.
- [`docs/knowledge_base/`](docs/knowledge_base/README.md): setup, research,
  and operating notes.

## License

By contributing, you agree that your contribution is licensed under the
project's [AGPL-3.0-or-later](LICENSE) license.
