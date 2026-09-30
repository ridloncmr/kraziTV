# ADR-0005: Keep Project Vocabulary In A Shared Glossary

## Status

Accepted. Amends the `CLAUDE.md` rule in
[agent-infrastructure ADR-0004](0004-claude-code-native-project-adapter.md).

## Context

Project terms were defined in the `AGENTS.md` Terminology section and repeated in the `krazitv-domain` and `domain-modeling` skills. The copies were short, covered only core architecture terms, and could drift apart.

The supported harnesses load extra instruction files differently:

| Harness  | Extra instruction files                                             |
| -------- | ------------------------------------------------------------------- |
| Claude   | `@path` imports in `CLAUDE.md` load the file into every session.    |
| OpenCode | The `instructions` array in `opencode.json` loads each listed file. |
| Codex    | Loads only the `AGENTS.md` chain; no include mechanism.             |
| Copilot  | Loads `AGENTS.md`; no include mechanism for an arbitrary root file. |

## Decision

- Keep all shared vocabulary in a root `GLOSSARY.md`, readable by contributors and agents alike.
- Replace the `AGENTS.md` Terminology section with a pointer to `GLOSSARY.md`.
- Load the glossary natively where a harness supports it: `@GLOSSARY.md` in `CLAUDE.md` and `GLOSSARY.md` in the `opencode.json` `instructions` array.
- Rely on the `AGENTS.md` pointer for Codex and Copilot.
- Skills and roles point to `GLOSSARY.md` and never keep their own term lists.

## Consequences

- One file to update when vocabulary changes.
- Claude Code and OpenCode always have the glossary in context, at a small token cost.
- Codex and Copilot read the glossary only when an agent follows the pointer. The pointer in `AGENTS.md` must survive future edits.
- `CLAUDE.md` now contains two imports instead of one.
