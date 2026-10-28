# Contributing To kraziTV

Thanks for helping. Bug reports, ideas, and pull requests are all welcome.
For anything larger than a small fix, open an issue first so we can agree on
the approach.

## Set Up

You need Node.js 22.13 or newer, npm 10 or newer, and FFmpeg 6.1 or newer,
with `ffprobe`, on your `PATH`.

```bash
npm install
npm run dev
```

`npm run dev` starts the server at `http://127.0.0.1:3000` and the web app at
`http://127.0.0.1:5173` together, labeling each line `api` or `web`, and stops
both when either stops. `npm run dev:server` or `npm run dev:web` starts one
alone. During development the web app calls the server across origins; set
`VITE_API_BASE_URL` to point it somewhere else, and `CORS_ORIGINS` to let the
server accept it.

Settings come from environment variables or a repo-root `.env`; see
[`.env.example`](.env.example) and the
[setup guide](docs/knowledge_base/running-krazitv.md#settings).

## Before You Open A Pull Request

CI runs all of these, and fails on any of them:

```bash
npm run plan:status   # regenerate plan progress tables
npm run format:write  # Prettier
npm run typecheck
npm run lint
npm test              # every unit and integration suite
npm run audit:strict  # source layout and composition rules
```

The browser suite runs in CI too. Run it locally with
`npx playwright install chromium` once, then
`npm run test:browser --workspace @krazitv/web`. It drives Chromium against a
real server and SQLite.

These suites run only on request, and fail rather than skip when what they
need is missing:

| Command                | Run it when you change               | Needs              |
| ---------------------- | ------------------------------------ | ------------------ |
| `npm run test:ffprobe` | media probing                        | `ffprobe`          |
| `npm run test:ffmpeg`  | FFmpeg arguments or stream packaging | `ffmpeg`           |
| `npm run test:tmdb`    | the TMDB client                      | `TMDB_API_KEY` set |

## How The Code Is Organized

kraziTV keeps four responsibilities apart:

- **kraziBrain** (`packages/krazi-brain`) decides what plays, when, and why.
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
  server/       Fastify API, the built web app's host, and route wiring
  web/          React web app
packages/
  krazi-brain/  scheduling and playout decisions
  media/        file discovery, ffprobe, and TMDB lookups
  signal/       channel stream workers and FFmpeg packaging
  plex/         HDHomeRun and XMLTV formatting
  process/      child-process handling shared by media and signal
```

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
