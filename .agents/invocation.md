# Agent Invocation

Use this guide to decide which skill to use during kraziTV work.

## Quick Router

| Situation                                                                             | Use Skill            |
| ------------------------------------------------------------------------------------- | -------------------- |
| Working on scheduling, channel state, playout timelines, SignalPackager, or providers | `krazitv-domain`     |
| Naming domain concepts or updating shared vocabulary                                  | `domain-modeling`    |
| Designing packages, modules, interfaces, or refactors                                 | `codebase-design`    |
| Implementing deterministic behavior or fixing a bug with test coverage                | `tdd`                |
| Researching Plex, Jellyfin, XMLTV, M3U, FFmpeg, or external behavior                  | `research`           |
| Diagnosing a bug, stream failure, test failure, or regression                         | `diagnosing-bugs`    |
| Reviewing a diff or implementation                                                    | `code-review`        |
| Writing or updating AI-facing docs, skills, agents, or prompts                        | `writing-for-agents` |
| Turning a conversation or feature idea into a durable spec                            | `to-spec`            |
| Breaking a spec or milestone into implementation tasks                                | `to-tickets`         |
| Pausing or ending a long session                                                      | `handoff`            |

## Default Flow For New Features

1. Use `krazitv-domain` to identify affected concepts and architecture boundaries.
2. Use `domain-modeling` if new terms, names, or concepts are being introduced.
3. Use `to-spec` if the feature needs a durable product or technical spec.
4. Use `codebase-design` if the feature changes module boundaries or public interfaces.
5. Use `to-tickets` to break the work into small vertical slices.
6. Use `tdd` while implementing deterministic behavior.
7. Use `code-review` before committing or opening a PR.
8. Use `handoff` if the work will continue in another session.

## Default Flow For Bugs

1. Use `diagnosing-bugs` to reproduce, minimize, hypothesize, instrument, fix, and regression-test.
2. Use `krazitv-domain` if the bug touches scheduling, channel state, playout, or provider boundaries.
3. Use `tdd` to add the smallest failing regression test.
4. Use `code-review` before committing the fix.

## Default Flow For Research

1. Use `research` for external behavior or primary-source investigation.
2. Save durable findings in `docs/knowledge_base/`.
3. Use `to-spec` if the research changes product or technical behavior.
4. Use `domain-modeling` if the research introduces new vocabulary.

## Default Flow For AI Infrastructure

1. Use `writing-for-agents` when changing `AGENTS.md`, `.agents/skills/`, `.agents/roles/`, harness adapters, or agent-facing docs.
2. Use `code-review` to check for stale references, unclear triggers, or broken skill names.
3. Restart the affected harness after changing its config, agents, or skill discovery paths.

## Skill Invocation Rules

- Load only the skill that fits the immediate task.
- Prefer `krazitv-domain` first when the work touches product behavior.
- Prefer `research` before guessing about external systems.
- Prefer `tdd` before implementing deterministic scheduling or timeline behavior.
- Prefer `code-review` before committing meaningful code changes.
