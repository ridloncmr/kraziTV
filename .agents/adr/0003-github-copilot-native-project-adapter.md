# ADR-0003: Use Native GitHub Copilot Repository Configuration

## Status

Accepted

## Context

GitHub Copilot recognizes root `AGENTS.md` files, project skills under `.agents/skills/`, and repository custom agents under `.github/agents/`.

kraziTV already keeps shared role behavior in `.agents/roles/`. Repeating repository guidance, skills, or complete role instructions under `.github/` would create drift.

## Decision

Add a native GitHub Copilot repository adapter:

- Use the existing root `AGENTS.md` for repository guidance.
- Keep canonical skills in `.agents/skills/` for native Copilot discovery.
- Register one `.github/agents/*.agent.md` adapter for each shared role.
- Set `include-custom-instructions: true` so delegated custom agents receive repository instructions.
- Keep each Copilot adapter thin by directing it to the matching `.agents/roles/*.md` file.
- Let agents inherit the active Copilot model and available tools unless a role requires a stricter policy.
- Limit the reviewer to the `read` and `search` tool aliases.
- Do not add `.github/copilot-instructions.md` while `AGENTS.md` remains sufficient; reserve it for genuinely Copilot-specific repository-wide rules.

## Consequences

- Copilot can discover kraziTV skills and named agents without duplicating shared behavior.
- Shared role changes apply across OpenCode, Codex, and Copilot after each harness reloads its configuration.
- Copilot-specific agent metadata remains isolated under `.github/agents/`.
- A future Copilot-only rule can be added without changing the shared `AGENTS.md` contract.

## References

- [Repository custom instructions](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-custom-instructions)
- [Agent skills](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/add-skills)
- [Custom agents](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/create-custom-agents)
- [Custom agent configuration](https://docs.github.com/en/copilot/reference/custom-agents-configuration)
