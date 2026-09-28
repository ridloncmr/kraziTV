# opencode AI Infrastructure

## Purpose

kraziTV uses project-local opencode configuration to give AI agents consistent project context, role-specific prompts, and reusable engineering skills.

## Files

- `opencode.json` - Project opencode config.
- `AGENTS.md` - Shared instructions loaded by opencode.
- `.opencode/agents/` - Project-specific subagents.
- `.opencode/skills/` - Project-specific and adapted reusable skills.

## Agents

- `architect` - Architecture, ADRs, boundaries, sequencing.
- `backend-engineer` - Fastify, SQLite, TypeScript core, scheduling logic.
- `media-engineer` - FFmpeg, ffprobe, streams, media normalization.
- `docs-maintainer` - README, specs, ADRs, implementation plans, knowledge base.
- `reviewer` - Diffs, risks, missing tests, boundary violations.
- `ai-infra-maintainer` - opencode config, agents, skills, invocation rules, and AI infrastructure docs.

## Skills

Project-specific:

- `krazitv-domain`

Adapted from Matt Pocock's public skills repo:

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

See `docs/knowledge_base/skills-flow.md` for when to use each skill.

## Attribution

Several skills are adapted from Matt Pocock's `skills` repository:

- Repository: https://github.com/mattpocock/skills
- License: MIT

The adapted files are intentionally shortened and made opencode-native for this project.

The repo's `.agents/` guidance also informed kraziTV's conventions around skill invocation, skill documentation, and AI infrastructure maintenance. Claude-specific and Codex-specific configuration was not copied because kraziTV currently uses opencode-native project files.

## Skill Invocation Conventions

Skills are classified by who should invoke them:

- Model-invoked: the agent may load the skill automatically when the task fits.
- User-invoked: the user must explicitly ask for the skill or workflow.

For opencode, descriptions are the practical trigger surface. Use concrete trigger words for model-invoked skills.

If one skill needs another, name the target skill explicitly. Do not rely on relative links or vague references.

## Operational Note

opencode loads config and skills on startup. After changing `opencode.json`, `AGENTS.md`, `.opencode/agents/`, or `.opencode/skills/`, restart opencode for changes to take effect.
