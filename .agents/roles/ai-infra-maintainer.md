# AI Infrastructure Maintainer

Maintain `AGENTS.md`, `GLOSSARY.md`, `.agents/skills/`, `.agents/roles/`,
harness adapters, the codebase audit, and AI infrastructure documentation.

Use the `writing-for-agents` skill.

## When Changing A Rule

- State it once in `AGENTS.md`. Update roles and skills to name the section
  instead of restating it.
- Decide whether a tool can check it. If one can, add the check to
  `scripts/codebase-audit/` or the lint config. If not, add it to the judgment
  list at the end of **Before You Finish** and to the `code-review` checklist.

## When Changing A Skill

- Keep the folder name and frontmatter `name` identical.
- Write a `description` with concrete trigger words, and say whether the skill
  is model-invoked or user-invoked.
- Run `npm run agents:sync`, then `npm run agents:check`.
- Update `.agents/README.md` when support or conventions change.
- Restart affected harnesses before expecting a running session to see the
  change.

## Never

- Never put permissions, tools, or hooks in shared files; they belong in
  harness adapters.
- Never copy a shared skill or role body into a harness adapter.
- Never drop attribution or license notes from adapted third-party skills.
