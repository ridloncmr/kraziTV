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
- Query layer: Drizzle or Kysely, not decided yet
- Web UI: React, Vite, TypeScript
- Media engine: FFmpeg and ffprobe through child processes
- Initial provider: Plex
- Future providers: Jellyfin, possibly Emby

## Source Of Truth

- `README.md` contains the high-level product and architecture overview.
- `docs/specs/` contains feature folders, feature goals, and feature-scoped product and technical specs.
- `docs/adrs/` contains accepted architecture decisions.
- `docs/implementation_plan/` contains milestone and task sequencing.
- `docs/knowledge_base/` contains research notes and operational knowledge.

## Core Architecture Boundaries

- kraziBrain decides what plays, when it plays, and why.
- SignalPackager decides how selected media becomes a continuous stream.
- Provider adapters decide where streams and guide data are exposed.

Do not leak provider-specific assumptions into core scheduling logic.

Do not put programming or scheduling decisions inside the SignalPackager.

Do not make FFmpeg command construction part of kraziBrain.

## Development Approach

- Prefer small vertical slices with working feedback loops.
- Keep interfaces narrow and modules deep.
- Use TypeScript types to model domain boundaries explicitly.
- Prefer deterministic scheduling behavior over clever randomness.
- Add tests around scheduling, timeline, guide, and media-selection logic as soon as code exists.
- Keep docs updated when decisions, vocabulary, or scope changes.

## AI Skill Conventions

Skills are either model-invoked or user-invoked.

- Model-invoked skills may be loaded by an agent whenever the task fits. Their descriptions should include concrete trigger words.
- User-invoked skills should only run when the user explicitly asks for them. Their descriptions should be human-facing and should not imply automatic invocation.

For opencode skills:

- Each skill lives at `.opencode/skills/<skill-name>/SKILL.md`.
- The folder name and frontmatter `name` must match.
- Skill names should be short, lowercase, and hyphen-separated.
- If a skill depends on another skill, say explicitly to use that skill by name instead of relying on vague prose references.
- Keep cross-skill references minimal. Shared project rules belong here in `AGENTS.md` or in project docs.
- Use `docs/knowledge_base/skills-flow.md` to decide which skill fits common kraziTV work.

## AI Infrastructure Rules

- Keep opencode configuration in `opencode.json` unless there is a reason to move it under `.opencode/`.
- Keep project agents in `.opencode/agents/`.
- Keep project skills in `.opencode/skills/`.
- Keep AI infrastructure notes in `docs/knowledge_base/opencode-ai-infra.md`.
- After editing opencode config, agents, or skills, restart opencode.
- Do not add Claude-specific, Codex-specific, or other harness-specific files unless the project explicitly adopts that tool.
- When adapting third-party AI assets, keep attribution and license notes in durable docs.

## Documentation Rules

- Product behavior belongs in feature-scoped specs under `docs/specs/features/`.
- Architecture decisions belong in `docs/adrs/`.
- Build sequencing belongs in `docs/implementation_plan/`.
- Research and references belong in `docs/knowledge_base/`.
- Keep README readable; do not turn it into an exhaustive implementation journal.
- Docs written for agents should explain when to use them, what must never happen, what vocabulary to use, what files are authoritative, and what verification is expected.
- If a doc presents multiple choices, use a list or table instead of burying the branch in a paragraph.

## Terminology

- Schedule: What viewers see in the guide.
- Playout timeline: Everything actually transmitted by a channel.
- Channel state: The deterministic runtime state that lets viewers join a broadcast in progress.
- kraziBrain: The scheduling and playout decision engine.
- SignalPackager: The streaming and media normalization layer.
- Provider adapter: Plex/Jellyfin/Emby-specific integration layer.
