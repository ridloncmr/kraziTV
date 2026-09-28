# ADR-0002: Use Native Codex Project Configuration

## Status

Accepted

## Context

Codex discovers repository guidance from `AGENTS.md`, repository skills from `.agents/skills/`, and project-scoped custom agents from `.codex/agents/*.toml`. Codex project configuration lives in `.codex/config.toml` and applies to trusted projects.

kraziTV already keeps shared role behavior in `.agents/roles/`. Repeating those instructions in Codex custom-agent files would create another source of truth.

## Decision

Add a native Codex project adapter:

- Use the existing root `AGENTS.md` for repository guidance.
- Keep canonical skills in `.agents/skills/` for native Codex discovery.
- Enable project subagents in `.codex/config.toml`.
- Register one `.codex/agents/*.toml` adapter for each shared role.
- Keep each Codex adapter thin by directing it to the matching `.agents/roles/*.md` file.
- Let agents inherit the parent model and runtime permissions unless a role requires a stricter policy.
- Run the reviewer with a read-only sandbox.

## Consequences

- Codex can discover kraziTV skills and named agents without duplicating shared behavior.
- Model selection stays under the user's control and follows the active Codex session by default.
- Changes to a shared role apply to OpenCode and Codex after each harness reloads its configuration.
- Codex-specific settings remain isolated under `.codex/`.

## References

- [Custom instructions with AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md)
- [Skills](https://learn.chatgpt.com/docs/build-skills)
- [Subagents and custom agents](https://learn.chatgpt.com/docs/agent-configuration/subagents)
