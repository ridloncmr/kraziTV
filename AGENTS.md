# kraziTV Agent Guide

This file gives AI agents shared project context and repo conventions.

## Project Summary

kraziTV is a deterministic, stateful television network simulator whose output is consumable by Plex first and Jellyfin later.

It should behave like a small broadcast automation system, not a playlist generator.

## Current Stack

- Runtime: Node.js
- Language: TypeScript
- API server: Fastify
- Database: SQLite
- Query layer: Kysely
- Web UI: React, Vite, TypeScript
- Media engine: FFmpeg and ffprobe through child processes
- Initial provider: Plex
- Future providers: Jellyfin, possibly Emby

## Authority And Documentation Lifecycle

- Before implementation, specs and implementation plans describe intent,
  acceptance targets, and sequencing.
- After implementation, source code and executable tests are canonical for what
  the system currently does. Completed specs and implementation plans become
  historical design context; they do not override working code.
- Accepted ADRs are canonical architectural decisions and constraints until
  explicitly superseded or replaced by another accepted decision. Draft or
  proposed ADRs are not binding policy.
- When source or tests conflict with an accepted ADR, flag the conflict. Do not
  silently change working behavior merely to match the ADR, and do not dismiss
  the ADR as stale merely because the current implementation differs. Determine
  whether the implementation violates the accepted architecture or the decision
  must be superseded, then record and apply that resolution explicitly.
- Change behavior through code and tests. Change accepted architectural policy
  through the ADR lifecycle, and then align implementation and active
  documentation with the resolved decision.
- Update only documentation that still serves an active planning, user,
  operator, or architecture purpose.
- `README.md` is a high-level product and architecture overview.
- `docs/specs/` records feature intent and acceptance targets before and during
  implementation.
- `docs/adrs/` records the reasoning behind architecture decisions.
- `docs/implementation_plan/` records milestone and task sequencing.
- `docs/knowledge_base/` records research notes and operational knowledge.

## Governing Engineering Principles

- KISS is the highest design priority. Choose the simplest design that clearly
  satisfies the current requirement and preserves known extension seams.
- SOLID and DRY are tools, not goals. Forgo them when they add indirection,
  premature abstraction, more types, or harder-to-follow control flow.
- Reuse stable capabilities through composition. Keep pipeline stages separable
  where known follow-up work needs chaining, such as metadata lookup after
  ffprobe, and keep provider-neutral behavior reusable by Plex and Jellyfin
  adapters.
- Do not add abstractions solely for hypothetical reuse. Extract a seam when a
  current requirement or a known next integration needs it.
- Keep files cohesive and easy to scan. Put one primary thing in each file: one
  concrete class, one table definition, one migration, one route group, or one
  tight set of related types. When a file collects entries that could each
  stand alone, such as every table in one schema file, split it.
- Keep a stateful class to the code that reads or writes its state. A private
  method that never reads `this` belongs beside the class, not in it. Move
  error factories, record types, pure checks, and argument-only helpers into
  cohesive files in the same domain folder. Inside the class, give any
  sequence repeated three or more times one named helper, and write a chain of
  early-exit checks as one function that returns the first failure, followed
  by one handling path. Do not split transitions that share mutable state
  across classes. Judge the result by whether the class reads as its
  transitions, not by line count. Apply this check whenever a file nears 500
  lines. `packages/signal/src/channel-stream-manager/` is the reference.
- Lay out every package or app `src/` the same way. `packages/signal/src` and
  `apps/server/src/database/` are the references
  ([ADR 0010](docs/adrs/0010-source-layout.md)):
  - `src/` root holds only entry points: `index.ts`, `create-*.ts` factories,
    package-wide `errors.ts`, and app composition such as `app.ts`.
  - Each domain gets one folder directly under `src/` (for example `probe/`,
    `catalog-scan/`, `media-roots/`), with its tests beside the code.
  - Inside a domain, group files into capability subfolders when the domain
    has more than four source files spanning more than one capability, or more
    than eight source files in total. Tests and `contracts.ts` do not count. A
    capability is a part a reader would look for on its own, such as HTTP
    routes, persistence, a processing pipeline, or schema definitions.
  - Leave a domain flat when its files all serve one capability:
    `signal/src/channel-worker/` stays flat because every file serves the
    worker. Group a domain whose files serve several capabilities, as
    `database/` does and `catalog-scan/` should:

    ```text
    database/                     reference: grouped by capability
      database.ts                 coordinates the domain
      migrations/                 migrate-database.ts, 001-initial-catalog.ts, ...
      schema/                     database-schema.ts, one file per table
      columns/                    sqlite-boolean.ts

    catalog-scan/                 before: routes, pipeline, and writer mixed
      catalog-scan-routes.ts, catalog-scanner.ts, catalog-scan-writer.ts,
      catalog-candidate.ts, concurrency-limited-prober.ts

    catalog-scan/                 after
      catalog-acceptance.test.ts  whole-domain test stays at the root
      routes/  scanner/  writer/
    ```

  - Keep files that coordinate the whole domain, and whole-domain acceptance
    tests, at the domain root; a capability's own orchestrator lives in its
    capability folder, as `migrations/migrate-database.ts` does.
  - Nest one capability level inside a domain: `src/<domain>/<capability>/`.
    Nest further only when a capability itself meets the grouping rule above.
  - When adding a file makes a folder meet the grouping rule, regroup it in the
    same change. Do not leave the reorganization for later.
  - A capability used across domains, such as `runtime/`, `config/`, or
    `http/`, gets its own top-level folder instead of nesting inside the
    first domain that used it.
  - Code needed by more than one package moves into a package they both depend
    on, as `packages/process` does ([ADR 0011](docs/adrs/0011-shared-process-package.md)).
    Never copy code between packages.
  - Put interfaces shared across a domain's files in that domain's
    `contracts.ts`, so domain files never import from a root entry point.
  - All test doubles and fixtures live in one `src/testing/` folder. Build
    configs exclude it along with `*.test.ts`.
  - Opt-in suites that need external binaries such as real FFmpeg or ffprobe
    live in `<package>/integration/`, outside `src/`, so `npm test` and CI never
    collect them. Run them through a dedicated npm script (for example
    `test:ffprobe`); they fail rather than skip when the binary is missing. The
    package's `tsconfig.json` typechecks `integration/`; its build config stays
    limited to `src/`.
  - `npm run audit:strict` checks these layout rules, the file-composition
    rules above, and cross-package copies mechanically, and CI fails on any
    error. Record an accepted deviation in
    `scripts/codebase-audit/audit-exceptions.json` with its reason and
    source, never by weakening a rule.
  - Name every folder so a reader can tell exactly what belongs in it. Folders
    named for a specific kind of file are encouraged: `migrations/`,
    `schema/`, `routes/`, and `types/` for type-only declarations. Never
    create vague folders such as `internal`, `utils`, `common`, `helpers`,
    `shared`, `lib`, or `misc`, where anything could land.
- Keep exports deliberate and minimal. Export only the package or module surface
  that another file actually needs; do not use barrel exports as dumping grounds.
- Give every method a concise comment that explains its purpose, policy, or
  invariant. Explain why; let the code explain how.

## Core Architecture Boundaries

- kraziBrain decides what plays, when it plays, and why.
- One active channel owns one broadcast signal.
- Channel stream workers own each active broadcast's lifecycle and subscriber
  fan-out.
- Viewers subscribe to the shared channel signal.
- The shared channel signal advances at wall-clock speed independently of viewer backpressure.
- SignalPackager decides how selected media becomes a continuous stream.
- Provider adapters decide where streams and guide data are exposed.

Do not leak provider-specific assumptions into core scheduling logic.

Do not put programming or scheduling decisions inside the SignalPackager.

Do not create independent programming or encoding sessions per viewer for the same active channel.

Do not make FFmpeg command construction part of kraziBrain.

## Development Approach

- Prefer small vertical slices with working feedback loops.
- Start with the simplest implementation and add structure only when the code
  demonstrates the need. For folders, the source-layout grouping rule defines
  that need.
- Keep interfaces narrow and modules deep.
- Use TypeScript types to model domain boundaries explicitly.
- Prefer deterministic scheduling behavior over clever randomness.
- Add tests around scheduling, timeline, guide, and media-selection logic as soon as code exists.
- Treat tests as executable behavioral contracts once behavior is implemented.

## Before You Finish

Use this section as the exit gate for any code change, whatever role you are
working in. Do not report work as done until all of these hold.

1. Search before you write. Before adding a helper, predicate, error factory,
   option check, or test double, search the repository for one that already
   does the job. Look in the package's `src/testing/` and its cross-domain
   folders such as `options/`, `runtime/`, `config/`, and `http/`. Reuse it,
   or move it to where both callers can reach it. Never write a second copy.
2. Write code in its final shape. Put test doubles in `src/testing/` from the
   start, export only what another file imports today, and give each new
   method its why-comment as you write it.
3. Run the checks. CI runs the same ones and fails on any of them.

   ```sh
   npm run plan:status
   npm run format:write
   npm run typecheck
   npm run lint
   npm test
   npm run audit:strict
   ```

   Also run `npm run test:ffprobe` when you change ffprobe integration, and
   `npm run test:ffmpeg` when you change FFmpeg packaging arguments or the
   channel stream runtime.

4. Resolve every audit `review` item in a file you touched, or say why it
   stands.
5. Record plan-ticket status when the change completes a ticket (see
   Documentation Rules).
6. Report any check you skipped or that failed, with its output.

The audit decides layout, one class per file, private methods that never read
`this`, missing method comments, exports no other file imports, test-double
placement, root-entry imports, and cross-package copies. These rules need your
judgment because no tool checks them: small copied helpers, what a package's
`index.ts` exposes, why-comment quality, KISS, and whether a stateful class
reads as its transitions.

## AI Skill Conventions

Skills are either model-invoked or user-invoked.

- Model-invoked skills may be loaded by an agent whenever the task fits. Their descriptions should include concrete trigger words.
- User-invoked skills should only run when the user explicitly asks for them. Their descriptions should be human-facing and should not imply automatic invocation.

For project skills:

- Each skill lives at `.agents/skills/<skill-name>/SKILL.md`.
- The folder name and frontmatter `name` must match.
- Skill names should be short, lowercase, and hyphen-separated.
- If a skill depends on another skill, say explicitly to use that skill by name instead of relying on vague prose references.
- Keep cross-skill references minimal. Shared project rules belong here in `AGENTS.md` or in project docs.
- Use `.agents/invocation.md` to decide which skill fits common kraziTV work.

Project skills use the portable Agent Skills `SKILL.md` format. Harness configuration should point to the canonical `.agents/skills/` directory instead of copying skill content into harness-specific folders.

Reusable role instructions live in `.agents/roles/`. When asked to work as a named project role, read the matching role file. Harness-specific agent definitions should be thin adapters that add only discovery, permissions, and tool configuration.

## AI Infrastructure Rules

- Keep shared skills in `.agents/skills/` and shared role instructions in `.agents/roles/`.
- Keep OpenCode configuration in `opencode.json` and OpenCode agent adapters in `.opencode/agents/`.
- Keep Codex project configuration in `.codex/config.toml` and Codex agent adapters in `.codex/agents/`.
- Keep GitHub Copilot agent adapters in `.github/agents/`. Use the shared root `AGENTS.md` and `.agents/skills/` instead of duplicating Copilot-specific copies.
- Keep Claude Code agent adapters in `.claude/agents/` and generated skill adapters in `.claude/skills/`. Keep `CLAUDE.md` as an `@AGENTS.md` import. Regenerate skill adapters with `npm run agents:sync`; never edit them by hand.
- Keep AI infrastructure guidance in `.agents/README.md` and agent-infrastructure decisions in `.agents/adr/`.
- Keep harness adapters small. Do not duplicate shared skill or role bodies in harness-specific directories.
- State each project rule once, in this file. Roles and skills name the
  section that holds a rule instead of restating it, because paraphrased
  copies drift apart. A role says only what is specific to that role: its
  scope, the skills it uses, and what it must never do.
- Add harness-specific files only when the project is actively adopting that harness.
- After editing OpenCode config, agents, or skills, restart OpenCode.
- After editing Codex config, agents, or skills, start a new Codex session.
- After editing Copilot agents or skills, start a new Copilot session.
- After editing `CLAUDE.md` or Claude agents, start a new Claude Code session.
- When adapting third-party AI assets, keep attribution and license notes in durable docs.

## Documentation Rules

- Before creating a new doc, answer: does an existing doc already own this
  information? If yes, do not create the new doc; update the owning doc
  instead. Create a new doc only when no existing doc owns the information.
- Planned product behavior belongs in feature-scoped specs under `docs/specs/features/`.
- Architecture decisions belong in `docs/adrs/`.
- Decisions about AI harnesses and agent infrastructure belong in `.agents/adr/`.
- Build sequencing belongs in `docs/implementation_plan/`.
- Write each project status fact in exactly one place; everything else links to
  it or is generated from it. Hand-written indexes, summaries, gate tables, and
  the glossary never restate a status.

  | Fact               | The one place it is written                         |
  | ------------------ | --------------------------------------------------- |
  | Plan ticket status | The ticket's `**Status**` block                     |
  | Spec status        | The `Status:` line at the top of the spec           |
  | Feature status     | The `Status:` line at the top of the feature README |
  | ADR status         | The `## Status` section of the ADR                  |

- When a plan ticket is complete, record it in the same change as the
  implementation: add a `**Status**` block directly under the ticket heading
  reading `Complete on YYYY-MM-DD.` plus one or two sentences on what was
  delivered and any deferred follow-up. A ticket is not done until its status
  is recorded. Then run `npm run plan:status`, which regenerates the progress
  table at the top of each plan and the plan list in
  `docs/implementation_plan/README.md` from ticket Status blocks; never edit
  those generated blocks by hand. When the change also completes a spec, update
  that spec's `Status:` line.
- Research and references belong in `docs/knowledge_base/`.
- Completed specs and implementation plans are not canonical descriptions of
  the running system. Use code and tests to understand implemented behavior.
- Accepted ADRs remain canonical architecture policy until explicitly
  superseded. Treat implementation drift as a conflict requiring review, not as
  automatic evidence that the ADR is obsolete.
- Do not maintain completed specs as a second copy of the implementation unless
  the user explicitly asks for that documentation.
- Keep README readable; do not turn it into an exhaustive implementation journal.
- Docs written for agents should explain when to use them, what must never happen, what vocabulary to use, what files are authoritative, and what verification is expected.
- If a doc presents multiple choices, use a list or table instead of burying the branch in a paragraph.

## Glossary

`GLOSSARY.md` is the canonical vocabulary for kraziTV architecture,
programming, catalog, broadcast, and provider terms. Read it before naming
types, writing specs or ADRs, or describing system behavior, and use its terms
instead of the synonyms it lists under **Avoid**. Add or change a term there in
the same change that introduces it.
