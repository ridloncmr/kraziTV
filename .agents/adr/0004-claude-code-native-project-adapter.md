# ADR-0004: Use Native Claude Code Project Configuration

## Status

Accepted

## Context

Claude Code reads project instructions from `CLAUDE.md` and, on recent versions, from `AGENTS.md` when no `CLAUDE.md` or `CLAUDE.local.md` exists. It discovers project subagents from `.claude/agents/*.md`.

Claude Code discovers project skills only from `.claude/skills/<name>/SKILL.md`. It does not read `.agents/skills/`, and it has no setting for extra skill directories. The available ways to expose the canonical skills are:

| Option                                     | Drawback                                                                                                                            |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Symlink each skill folder                  | Unreliable on Windows checkouts; rejected by the portability rules in `.agents/README.md`.                                          |
| Package `.agents/skills/` as a repo plugin | Namespaces every skill (`krazitv:tdd`), requires marketplace and trust setup, and plugins declared in settings skip cloud sessions. |
| Full generated copies                      | Duplicates skill bodies in a second tree.                                                                                           |
| Generated thin adapters                    | Duplicates only frontmatter, which a sync script can regenerate and CI can verify.                                                  |

## Decision

Add a native Claude Code project adapter:

- Add a root `CLAUDE.md` that only imports `@AGENTS.md`. The import works on every Claude Code version and keeps `AGENTS.md` loaded when a contributor adds a personal `CLAUDE.local.md`.
- Register one `.claude/agents/*.md` adapter for each shared role, directing it to the matching `.agents/roles/*.md` file.
- Let agents inherit the parent model, tools, and permission mode unless a role requires a stricter policy.
- Deny the reviewer the `Edit`, `Write`, and `NotebookEdit` tools. Keep `Bash` so it can inspect diffs.
- Generate one `.claude/skills/<name>/SKILL.md` thin adapter per canonical skill with `.claude/sync-skills.mjs`. Each adapter copies the canonical frontmatter verbatim and points to the canonical `SKILL.md` for its body.
- Verify adapters with `npm run agents:check` in CI. Regenerate them with `npm run agents:sync`.
- Ignore personal `.claude/settings.local.json` and `CLAUDE.local.md` files.

## Consequences

- Claude Code can discover kraziTV skills and named agents without duplicating skill or role bodies.
- Adding, renaming, removing, or changing the frontmatter of a skill requires running `npm run agents:sync`. CI fails when this is forgotten.
- Skills load in two steps: the adapter, then the canonical file it points to.
- Claude-only skills may still be hand-written in `.claude/skills/`. The sync script never removes adapters it did not generate.

## References

- [Memory and AGENTS.md](https://code.claude.com/docs/en/memory)
- [Skills](https://code.claude.com/docs/en/skills)
- [Subagents](https://code.claude.com/docs/en/sub-agents)
