# AI Agent Infrastructure

## Purpose

kraziTV keeps project knowledge and repeatable workflows independent of any one AI harness. Framework-specific files should discover or adapt the shared content, not become a second source of truth.

## Shared Files

- `AGENTS.md` - Repository-wide instructions and architecture boundaries.
- `GLOSSARY.md` - Canonical project vocabulary, loaded or referenced by every harness.
- `.agents/README.md` - This guide to shared AI infrastructure.
- `.agents/skills/` - Canonical skills in the portable Agent Skills `SKILL.md` format.
- `.agents/roles/` - Harness-neutral role instructions.
- `.agents/invocation.md` - Router for choosing a skill.
- `.agents/adr/` - Decisions about agent infrastructure and harness support.

Do not copy these files into a harness-specific directory. Configure the harness to discover them or add a thin adapter that points to them.

## Harness Support

| Harness  | Repository instructions         | Glossary                                    | Skills                                                      | Named roles                                        |
| -------- | ------------------------------- | ------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------- |
| OpenCode | `AGENTS.md` via config          | Always loaded via `opencode.json`           | `.agents/skills/` via `opencode.json`                       | `.opencode/agents/` adapters load `.agents/roles/` |
| Codex    | `AGENTS.md`                     | Read on demand from the `AGENTS.md` pointer | `.agents/skills/` via native discovery                      | `.codex/agents/` adapters load `.agents/roles/`    |
| Copilot  | `AGENTS.md`                     | Read on demand from the `AGENTS.md` pointer | `.agents/skills/` via native discovery                      | `.github/agents/` adapters load `.agents/roles/`   |
| Claude   | `CLAUDE.md` imports `AGENTS.md` | Always loaded via `@GLOSSARY.md` import     | `.claude/skills/` generated adapters load `.agents/skills/` | `.claude/agents/` adapters load `.agents/roles/`   |

OpenCode, Codex, GitHub Copilot, and Claude Code use the shared instructions, glossary, skills, and roles. Their subagent metadata and permission models remain isolated in harness-specific adapters.

Codex and Copilot have no include mechanism for extra instruction files, so they rely on the `## Glossary` pointer in `AGENTS.md`. Keep that pointer when editing `AGENTS.md`. Never paste glossary terms into `AGENTS.md`, a skill, a role, or an adapter.

When another harness is adopted, add only the entry point and adapter files it requires. Record its discovery behavior and limitations in this table.

## Roles

- `architect` - Architecture, ADRs, boundaries, and sequencing.
- `backend-engineer` - Fastify, SQLite, TypeScript core, and scheduling logic.
- `media-engineer` - FFmpeg, ffprobe, streams, and media normalization.
- `docs-maintainer` - README, specs, ADRs, implementation plans, and knowledge base.
- `reviewer` - Diffs, risks, missing tests, and boundary violations.
- `ai-infra-maintainer` - Shared guidance, skills, roles, adapters, and infrastructure docs.

The body of each role belongs in `.agents/roles/`. A harness adapter may add frontmatter, permissions, tool access, hooks, or invocation metadata, but should point to the shared role instead of repeating it.

### Codex Adapter

Codex support uses only native project surfaces:

- `AGENTS.md` supplies persistent repository guidance.
- `.agents/skills/` supplies repo-scoped skills through native discovery.
- `.codex/config.toml` enables project subagents and sets their concurrency limit.
- `.codex/agents/*.toml` registers project-scoped custom agents that load the shared role instructions.

Codex project configuration applies only when the repository is trusted. Start a new Codex session after changing `AGENTS.md`, skill metadata, `.codex/config.toml`, or custom agent files.

Official Codex references:

- [Custom instructions with AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md)
- [Skills](https://learn.chatgpt.com/docs/build-skills)
- [Subagents and custom agents](https://learn.chatgpt.com/docs/agent-configuration/subagents)

### GitHub Copilot Adapter

GitHub Copilot support uses its native repository surfaces:

- `AGENTS.md` supplies shared repository guidance.
- `.agents/skills/` supplies project skills through native discovery.
- `.github/agents/*.agent.md` registers repository custom agents that load the shared role instructions.
- `include-custom-instructions: true` ensures custom agents spawned as subagents receive repository instructions.

The reviewer exposes only Copilot's `read` and `search` tool aliases. Other agents inherit the tools and model available in the active Copilot environment.

Official GitHub Copilot references:

- [Repository custom instructions](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-custom-instructions)
- [Agent skills](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/add-skills)
- [Custom agents](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/create-custom-agents)
- [Custom agent configuration](https://docs.github.com/en/copilot/reference/custom-agents-configuration)

### Claude Code Adapter

Claude Code support uses its native project surfaces:

- `CLAUDE.md` imports `AGENTS.md` and `GLOSSARY.md` and adds nothing else (ADR-0005).
- `.claude/agents/*.md` registers project subagents that load the shared role instructions.
- `.claude/skills/*/SKILL.md` registers thin skill adapters generated by `.claude/sync-skills.mjs`.

Claude Code discovers skills only under `.claude/skills/`. Each generated adapter copies the canonical frontmatter and points to `.agents/skills/<name>/SKILL.md`. Never edit the adapters by hand:

- Run `npm run agents:sync` after adding, renaming, removing, or changing the frontmatter of a skill.
- CI runs `npm run agents:check` and fails when adapters drift.

The reviewer cannot use `Edit`, `Write`, or `NotebookEdit`. Other agents inherit the active session's model, tools, and permission mode.

Official Claude Code references:

- [Memory and AGENTS.md](https://code.claude.com/docs/en/memory)
- [Skills](https://code.claude.com/docs/en/skills)
- [Subagents](https://code.claude.com/docs/en/sub-agents)

## Skills

Project-specific:

- `krazitv-domain`
- `codebase-audit` (user-invoked; runs `npm run audit`, then the judgment checklist)

Adapted from Matt Pocock's public skills repository:

- `domain-modeling`
- `codebase-design`
- `tdd`
- `research`
- `code-review`
- `diagnosing-bugs`
- `writing-for-agents`
- `handoff`
- `to-spec`
- `to-tickets`

Skills are classified by who should invoke them:

- Model-invoked skills may load automatically when the task matches their description.
- User-invoked skills run only when the user explicitly requests the skill or workflow.

The `name` and `description` frontmatter fields are the discovery surface. Use concrete trigger words, keep folder and skill names identical, and name dependencies explicitly.

## Portability Rules

1. Keep shared repository policy in `AGENTS.md`.
2. Keep reusable workflows in `.agents/skills/`.
3. Keep reusable role behavior in `.agents/roles/`.
4. Keep permissions, hooks, model selection, and tool configuration in harness adapters.
5. Prefer configurable discovery paths over symlinks.
6. Do not use generated copies unless a harness requires a fixed path and cannot load or reference the canonical files.
7. If generated copies become necessary, provide a deterministic sync script and a verification check that detects drift.

Product and system architecture decisions stay in `docs/adrs/`. Only decisions about AI harnesses, skills, roles, and agent operations belong in `.agents/adr/`.

Symlinks are not the default because Git, Windows, containers, and sandboxed harnesses do not all treat them consistently.

## Attribution

Several skills are adapted from Matt Pocock's `skills` repository:

- Repository: https://github.com/mattpocock/skills
- License: MIT
- Complete upstream notice: [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md)

The adapted files are intentionally shortened for this project while retaining
inline attribution and license metadata. The complete upstream copyright and
permission notice is retained in the repository-level third-party notices file.

The skills follow the open Agent Skills structure: https://agentskills.io

## Operational Notes

- Restart OpenCode after changing `opencode.json`, `.opencode/agents/`, or its skill discovery path.
- Start a new Codex session after changing project guidance, skill discovery metadata, or `.codex/` configuration.
- Start a new Copilot session after changing repository instructions, skills, or `.github/agents/` profiles.
- Run `npm run agents:sync` after changing skill frontmatter. Start a new Claude Code session after changing `CLAUDE.md` or `.claude/agents/`; skill adapter changes load live.
- Explicitly request a skill by name while testing discovery. This separates a discovery failure from a model choosing not to invoke an available skill.
- Review skill scripts and instructions as privileged code before enabling them in a harness with network or write access.
